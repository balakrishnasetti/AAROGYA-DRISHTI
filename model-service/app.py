import base64
import hashlib
import hmac
import io
import json
import logging
import os
from pathlib import Path
from typing import Annotated

import torch
from fastapi import FastAPI, Header, HTTPException
from PIL import Image, ImageFile, UnidentifiedImageError
from pydantic import BaseModel, ConfigDict, Field
from torchvision import transforms

from classification import FINDINGS, classify, create_classifier
from explainability import gradcam_overlay
from quality import inspect_image_quality, oral_cavity_probability
from segmentation import segment_region
from training.model import load_config, load_trained_model
from uncertainty import decision_for_prediction

logger = logging.getLogger("uvicorn.error")
logger.setLevel(logging.INFO)
MODEL_VERSION = os.getenv("ORAL_MODEL_VERSION", "")
API_TOKEN = os.getenv("MODEL_API_TOKEN", "")
MANIFEST_PATH = os.getenv("ORAL_MODEL_MANIFEST", "")
SEGMENTATION_WEIGHTS = Path(os.getenv("ORAL_SEGMENTATION_WEIGHTS", ""))
CLASSIFIER_WEIGHTS = Path(os.getenv("ORAL_CLASSIFIER_WEIGHTS", ""))
ORAL_DETECTOR_WEIGHTS = Path(os.getenv("ORAL_DETECTOR_WEIGHTS", ""))
TRAINING_CONFIG_PATH = Path(
    os.getenv("MODEL_CONFIG_PATH", Path(__file__).parent / "training" / "config.json")
)
MODEL_META_PATH = Path(
    os.getenv("MODEL_META_PATH", Path(__file__).parent / "models" / "model_meta.json")
)
MAX_IMAGE_BYTES = 1_000_000
Image.MAX_IMAGE_PIXELS = 40_000_000
ImageFile.LOAD_TRUNCATED_IMAGES = False

app = FastAPI(title="Aarogya Drishti Oral Screening Model", version="2")
segmentation_model = None
classifier = None
oral_detector = None
manifest = None
trained_classifier = None
trained_classifier_config = None
trained_preprocess = None
trained_model_version = None
preprocess = transforms.Compose(
    [
        transforms.Resize((224, 224)),
        transforms.ToTensor(),
        transforms.Normalize(mean=(0.485, 0.456, 0.406), std=(0.229, 0.224, 0.225)),
    ]
)


class PredictionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    imageBase64: str = Field(min_length=1, max_length=1_400_000)
    mimeType: str = Field(pattern=r"^image/(jpeg|png|webp)$")
    region: str = Field(min_length=1, max_length=80)


class TrainedPredictionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    imageBase64: str = Field(min_length=1, max_length=1_400_000)
    mimeType: str = Field(pattern=r"^image/(jpeg|png|webp)$")
    region: str = Field(default="oral_cavity", min_length=1, max_length=80)


def load_manifest() -> dict:
    if not MANIFEST_PATH:
        raise RuntimeError("ORAL_MODEL_MANIFEST is not configured.")
    try:
        with Path(MANIFEST_PATH).open("r", encoding="utf-8") as manifest_file:
            data = json.load(manifest_file)
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError("The oral model manifest could not be read.") from error

    calibration = data.get("calibration", {})
    if (
        data.get("modelVersion") != MODEL_VERSION
        or calibration.get("method") != "temperature_scaling"
        or not calibration.get("validationDataset")
        or not calibration.get("calibrationDataset")
        or not 0 < float(calibration.get("temperature", 0)) <= 100
        or not 0 < float(calibration.get("confidenceThreshold", 0)) <= 1
        or not 0 < float(calibration.get("oralDetectionThreshold", 0)) <= 1
    ):
        raise RuntimeError("The model version or calibration evidence is incomplete.")

    artifacts = data.get("artifactSha256", {})
    for name, path in (
        ("segmentation", SEGMENTATION_WEIGHTS),
        ("classifier", CLASSIFIER_WEIGHTS),
        ("oralDetector", ORAL_DETECTOR_WEIGHTS),
    ):
        if not path.is_file() or not artifacts.get(name):
            raise RuntimeError(f"The {name} model artifact is missing.")
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if not hmac.compare_digest(digest, artifacts[name]):
            raise RuntimeError(f"The {name} artifact does not match the model manifest.")
    return data


def load_models():
    global segmentation_model, classifier, oral_detector, manifest
    if not MODEL_VERSION or not API_TOKEN:
        return
    manifest = load_manifest()
    segmentation_model = torch.jit.load(str(SEGMENTATION_WEIGHTS), map_location="cpu")
    segmentation_model.eval()

    classifier = create_classifier()
    classifier.load_state_dict(
        torch.load(CLASSIFIER_WEIGHTS, map_location="cpu", weights_only=True), strict=True
    )
    classifier.eval()

    oral_detector = create_classifier()
    oral_detector.fc = torch.nn.Linear(oral_detector.fc.in_features, 2)
    oral_detector.load_state_dict(
        torch.load(ORAL_DETECTOR_WEIGHTS, map_location="cpu", weights_only=True), strict=True
    )
    oral_detector.eval()


def load_trained_classifier():
    global trained_classifier, trained_classifier_config, trained_preprocess, trained_model_version
    try:
        config = load_config(TRAINING_CONFIG_PATH)
        configured_path = os.getenv("MODEL_PATH")
        model_path = Path(configured_path) if configured_path else Path(config["model_path"])
        if not model_path.is_absolute():
            model_path = (TRAINING_CONFIG_PATH.parent / model_path).resolve()
        if not model_path.is_file() or not MODEL_META_PATH.is_file():
            logger.warning(
                "Oral classifier unavailable: weights=%s metadata=%s (PyTorch EfficientNetB0, classes=%s).",
                model_path,
                MODEL_META_PATH,
                config["classes"],
            )
            return
        if config["classes"] != ["benign", "malignant"]:
            raise ValueError("The classifier configuration must define benign, malignant classes.")
        model, metadata, preprocess = load_trained_model(model_path, MODEL_META_PATH)
        if metadata["classes"] != config["classes"]:
            raise ValueError("Model metadata class order does not match training/config.json.")
        trained_classifier = model
        trained_preprocess = preprocess
        trained_classifier_config = {**config, **metadata}
        trained_model_version = hashlib.sha256(model_path.read_bytes()).hexdigest()[:16]
        logger.info(
            "Loaded oral classifier: path=%s metadata=%s framework=PyTorch architecture=%s classes=%s",
            model_path,
            MODEL_META_PATH,
            config["architecture"],
            config["classes"],
        )
    except (OSError, ValueError, RuntimeError, KeyError) as error:
        logger.exception("Could not load oral classifier from %s: %s", TRAINING_CONFIG_PATH, error)


@app.on_event("startup")
def startup():
    load_trained_classifier()
    load_models()


def is_legacy_ready() -> bool:
    return all((segmentation_model, classifier, oral_detector, manifest))


def is_ready() -> bool:
    return is_legacy_ready() or trained_classifier is not None


@app.get("/health")
def health():
    return {
        "status": "ready" if is_ready() else "not_ready",
        "model_loaded": trained_classifier is not None,
        "modelVersion": manifest.get("modelVersion") if manifest else trained_model_version,
        "classifierModel": {
            "status": "ready" if trained_classifier is not None else "not_ready",
            "model_loaded": trained_classifier is not None,
            "version": trained_model_version,
            "architecture": trained_classifier_config.get("architecture")
            if trained_classifier_config
            else "efficientnet_b0",
            "classes": trained_classifier_config.get("classes", [])
            if trained_classifier_config
            else [],
        },
    }


def require_authorized(authorization: str | None):
    expected = f"Bearer {API_TOKEN}"
    if not API_TOKEN or not hmac.compare_digest(authorization or "", expected):
        raise HTTPException(status_code=401, detail={"code": "UNAUTHORIZED"})


def require_ready():
    if not is_legacy_ready():
        raise HTTPException(
            status_code=503,
            detail={
                "code": "MODEL_NOT_CONFIGURED",
                "message": "A versioned model with calibration evidence is not configured.",
            },
        )


@app.post("/predict")
def predict_trained_classifier(
    payload: TrainedPredictionRequest,
    authorization: Annotated[str | None, Header()] = None,
):
    require_authorized(authorization)
    if trained_classifier is None or trained_classifier_config is None or trained_preprocess is None:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "MODEL_NOT_CONFIGURED",
                "message": "AI analysis is not available yet because trained model weights are not installed.",
            },
        )

    image = decode_image(payload)
    quality = inspect_image_quality(image)
    base_result = {
        "modelVersion": trained_model_version,
        "status": "inconclusive",
        "predictedClass": None,
        "confidence": None,
        "confidenceCalibrated": False,
        "classProbabilities": {},
        "riskLevel": "unclear",
        "imageQuality": "adequate" if quality["adequate"] else "inadequate",
        "reasons": quality["reasons"],
        "disclaimer": "This is an AI screening aid and not a medical diagnosis. Please consult a qualified doctor.",
    }
    if not quality["adequate"]:
        return base_result

    with torch.inference_mode():
        probabilities = torch.softmax(
            trained_classifier(trained_preprocess(image).unsqueeze(0)), dim=1
        )[0].tolist()
    classes = trained_classifier_config["classes"]
    predicted_index = max(range(len(probabilities)), key=probabilities.__getitem__)
    confidence = float(probabilities[predicted_index])
    class_probabilities = dict(zip(classes, map(float, probabilities), strict=True))
    minimum_confidence = float(trained_classifier_config["minimum_confidence"])
    if confidence < minimum_confidence:
        return {**base_result, "reasons": ["low_confidence"]}

    predicted_class = classes[predicted_index]
    thresholds = trained_classifier_config["risk_thresholds"]
    malignant_probability = class_probabilities["malignant"]
    if malignant_probability >= float(thresholds["high_malignant_probability"]):
        risk_level = "high"
    elif malignant_probability >= float(thresholds["meaningful_malignant_probability"]):
        risk_level = "moderate"
    else:
        risk_level = "low"
    return {
        **base_result,
        "status": "classified",
        "predictedClass": predicted_class,
        "confidence": confidence,
        "classProbabilities": class_probabilities,
        "riskLevel": risk_level,
        "reasons": [],
    }


def decode_image(payload: PredictionRequest) -> Image.Image:
    try:
        encoded = base64.b64decode(payload.imageBase64, validate=True)
        if not encoded or len(encoded) > MAX_IMAGE_BYTES:
            raise ValueError("invalid image length")
        image = Image.open(io.BytesIO(encoded))
        expected_format = {
            "image/jpeg": "JPEG",
            "image/png": "PNG",
            "image/webp": "WEBP",
        }[payload.mimeType]
        if (
            image.format != expected_format
            or image.width * image.height > 40_000_000
            or image.width > 10_000
            or image.height > 10_000
        ):
            raise ValueError("image format or dimensions invalid")
        image.load()
        return image.convert("RGB")
    except (ValueError, OSError, UnidentifiedImageError, Image.DecompressionBombError) as error:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "IMAGE_INVALID",
                "message": "Upload a valid JPEG, PNG, or WebP image.",
            },
        ) from error


def evaluate_image(image: Image.Image) -> tuple[dict, float]:
    quality = inspect_image_quality(image)
    if not quality["adequate"]:
        return quality, 0.0
    probability = oral_cavity_probability(oral_detector, preprocess, image)
    return quality, probability


def encode_png(image: Image.Image) -> str:
    output = io.BytesIO()
    image.save(output, format="PNG", optimize=True)
    return base64.b64encode(output.getvalue()).decode("ascii")


@app.post("/v1/oral-screenings/validate")
def validate_photo(
    payload: PredictionRequest,
    authorization: Annotated[str | None, Header()] = None,
):
    require_authorized(authorization)
    require_ready()
    image = decode_image(payload)
    quality, oral_probability = evaluate_image(image)
    oral_threshold = manifest["calibration"]["oralDetectionThreshold"]
    oral_detected = quality["adequate"] and oral_probability >= oral_threshold
    return {
        "accepted": oral_detected,
        "imageQuality": "adequate" if oral_detected else "inadequate",
        "reasons": quality["reasons"] if not quality["adequate"] else (
            [] if oral_detected else ["not_oral"]
        ),
        "width": quality["width"],
        "height": quality["height"],
        "metrics": {
            key: quality[key]
            for key in ("blurScore", "brightness", "darkRatio", "glareRatio")
            if key in quality
        },
    }


@app.post("/v1/oral-screenings/predict")
def predict(
    payload: PredictionRequest,
    authorization: Annotated[str | None, Header()] = None,
):
    require_authorized(authorization)
    require_ready()
    image = decode_image(payload)
    quality, oral_probability = evaluate_image(image)
    if not quality["adequate"]:
        raise HTTPException(
            status_code=422,
            detail={"code": "IMAGE_QUALITY_POOR", "reasons": quality["reasons"]},
        )
    if oral_probability < manifest["calibration"]["oralDetectionThreshold"]:
        raise HTTPException(
            status_code=422,
            detail={"code": "ORAL_CAVITY_NOT_DETECTED", "reasons": ["not_oral"]},
        )

    segmentation = segment_region(segmentation_model, image)
    if segmentation["ambiguous"]:
        return {
            "modelVersion": manifest["modelVersion"],
            "status": "unclear",
            "finding": None,
            "confidence": None,
            "probabilities": {},
            "heatmapBase64": "",
            "imageQuality": "uncertain",
            "uncertaintyReason": "segmentation_ambiguous",
        }

    bounds = segmentation["bounds"]
    crop = image.crop(bounds)
    prediction = classify(
        classifier,
        preprocess,
        crop,
        manifest["calibration"]["temperature"],
    )
    decision = "unclear" if decision_for_prediction(
        image_adequate=quality["adequate"],
        oral_probability=oral_probability,
        oral_threshold=manifest["calibration"]["oralDetectionThreshold"],
        segmentation_ambiguous=segmentation["ambiguous"],
        confidence=prediction["confidence"],
        confidence_threshold=manifest["calibration"]["confidenceThreshold"],
    ) == "unclear" else "classified"

    heatmap = gradcam_overlay(
        classifier,
        preprocess,
        crop,
        FINDINGS.index(prediction["finding"]),
    )
    image.paste(heatmap, bounds[:2])
    return {
        "modelVersion": manifest["modelVersion"],
        "status": decision,
        "finding": prediction["finding"] if decision == "classified" else None,
        "confidence": prediction["confidence"],
        "probabilities": prediction["probabilities"],
        "heatmapBase64": encode_png(image) if decision == "classified" else "",
        "imageQuality": "adequate" if decision == "classified" else "uncertain",
        "uncertaintyReason": None if decision == "classified" else "low_confidence",
    }
