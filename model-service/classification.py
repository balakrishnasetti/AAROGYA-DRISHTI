import torch
from torchvision import models

FINDINGS = (
    "white_patch",
    "red_patch",
    "ulcer_like_area",
    "raised_area",
    "no_visible_finding",
)


def create_classifier():
    model = models.resnet18(weights=None)
    model.fc = torch.nn.Linear(model.fc.in_features, len(FINDINGS))
    return model


def classify(model, preprocess, image, temperature: float) -> dict:
    if temperature <= 0:
        raise ValueError("The calibration temperature must be positive.")
    with torch.inference_mode():
        logits = model(preprocess(image).unsqueeze(0)) / temperature
        probabilities = torch.softmax(logits, dim=1)[0]
    values = [float(value) for value in probabilities.tolist()]
    index = max(range(len(values)), key=values.__getitem__)
    return {
        "finding": FINDINGS[index],
        "confidence": values[index],
        "probabilities": dict(zip(FINDINGS, values, strict=True)),
    }
