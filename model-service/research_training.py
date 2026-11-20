"""Research-only image classifier training; never used by the online API."""

import argparse
import csv
import hashlib
import json
import random
import sys
from datetime import date
from pathlib import Path
from urllib.parse import urlparse

SPLITS = ("train", "validation", "test")
REQUIRED_COLUMNS = {"image_path", "label", "subject_id", "split"}
PLACEHOLDERS = {"", "unknown", "none", "tbd", "replace_me", "n/a"}
CLINICAL_CLASSES = ("Healthy", "Benign", "OPMD", "Suspicious Oral Lesions")


def _require_text(manifest: dict, key: str) -> str:
    value = manifest.get(key)
    if not isinstance(value, str) or value.strip().lower() in PLACEHOLDERS:
        raise ValueError(f"Dataset manifest requires a real {key} value.")
    return value.strip()


def validate_manifest(path: Path) -> dict:
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError("Could not read dataset-manifest.json.") from error

    if not isinstance(manifest, dict) or manifest.get("purpose") != "research_only":
        raise ValueError("Dataset manifest purpose must be exactly 'research_only'.")
    if manifest.get("subjectIdsPseudonymous") is not True:
        raise ValueError("Dataset manifest must confirm that subject IDs are pseudonymous.")
    if manifest.get("imageModality") != "smartphone_clinical_photo":
        raise ValueError(
            "The clinical-photo trainer accepts only smartphone_clinical_photo datasets."
        )
    for key in (
        "datasetName",
        "sourceUrl",
        "license",
        "licenseUrl",
        "rightsReviewedBy",
        "rightsReviewDate",
        "accessBasis",
        "labelSource",
        "labelDefinition",
    ):
        _require_text(manifest, key)

    for key in ("sourceUrl", "licenseUrl"):
        parsed = urlparse(manifest[key])
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError(f"Dataset manifest {key} must be an http(s) URL.")
    try:
        date.fromisoformat(manifest["rightsReviewDate"])
    except ValueError as error:
        raise ValueError("rightsReviewDate must use YYYY-MM-DD.") from error

    classes = manifest.get("classes")
    if (
        not isinstance(classes, list)
        or any(not isinstance(item, str) or not item.strip() for item in classes)
        or set(item.strip() for item in classes) != set(CLINICAL_CLASSES)
        or len(classes) != len(CLINICAL_CLASSES)
    ):
        raise ValueError(
            "Clinical-photo training requires the four verified categories: "
            + ", ".join(CLINICAL_CLASSES)
            + "."
        )
    manifest["classes"] = list(CLINICAL_CLASSES)
    return manifest


def load_dataset(dataset_root: Path) -> tuple[dict, list[dict], dict]:
    root = dataset_root.resolve(strict=True)
    manifest = validate_manifest(root / "dataset-manifest.json")
    labels_path = root / "labels.csv"
    try:
        labels_file = labels_path.open("r", encoding="utf-8-sig", newline="")
    except OSError as error:
        raise ValueError("Could not read labels.csv.") from error

    samples = []
    seen_paths = set()
    subject_splits = {}
    split_labels = {split: set() for split in SPLITS}
    split_subjects = {split: set() for split in SPLITS}
    content_hash_splits = {}

    with labels_file:
        reader = csv.DictReader(labels_file)
        if not reader.fieldnames or not REQUIRED_COLUMNS.issubset(reader.fieldnames):
            raise ValueError("labels.csv must include image_path, label, subject_id, and split.")

        for row_number, row in enumerate(reader, start=2):
            relative_path = (row.get("image_path") or "").strip()
            label = (row.get("label") or "").strip()
            subject_id = (row.get("subject_id") or "").strip()
            split = (row.get("split") or "").strip()
            if not relative_path or not label or not subject_id or split not in SPLITS:
                raise ValueError(f"labels.csv row {row_number} has a missing or invalid field.")
            if label not in manifest["classes"]:
                raise ValueError(f"labels.csv row {row_number} uses an undeclared label.")

            relative = Path(relative_path)
            if relative.is_absolute() or relative.drive or ".." in relative.parts:
                raise ValueError(f"labels.csv row {row_number} image_path must stay inside the dataset.")
            image_path = (root / relative).resolve(strict=True)
            if root not in image_path.parents or not image_path.is_file():
                raise ValueError(f"labels.csv row {row_number} image_path is not a dataset file.")
            if image_path.suffix.lower() not in {".jpg", ".jpeg", ".png"}:
                raise ValueError(f"labels.csv row {row_number} must reference a JPEG or PNG.")
            if relative_path in seen_paths:
                raise ValueError(f"labels.csv row {row_number} duplicates an image_path.")
            seen_paths.add(relative_path)

            previous_split = subject_splits.setdefault(subject_id, split)
            if previous_split != split:
                raise ValueError("A subject_id appears in more than one dataset split.")

            image_hash = hashlib.sha256()
            with image_path.open("rb") as image_file:
                for chunk in iter(lambda: image_file.read(1024 * 1024), b""):
                    image_hash.update(chunk)
            digest = image_hash.hexdigest()
            previous_content_split = content_hash_splits.setdefault(digest, split)
            if previous_content_split != split:
                raise ValueError("Identical image content appears across dataset splits.")

            samples.append(
                {"path": image_path, "label": label, "subject_id": subject_id, "split": split}
            )
            split_labels[split].add(label)
            split_subjects[split].add(subject_id)

    if not samples:
        raise ValueError("labels.csv contains no labeled images.")
    if set(split for split in SPLITS if split_subjects[split]) != set(SPLITS):
        raise ValueError("Dataset must provide train, validation, and test subjects.")
    missing = {
        split: sorted(set(manifest["classes"]) - split_labels[split])
        for split in SPLITS
    }
    if any(missing.values()):
        raise ValueError("Every declared class must occur in every split.")

    summary = {
        split: {
            "images": sum(sample["split"] == split for sample in samples),
            "subjects": len(split_subjects[split]),
        }
        for split in SPLITS
    }
    return manifest, samples, summary


def classification_metrics(actual: list[int], predicted: list[int], class_names: list[str]) -> dict:
    if not actual or len(actual) != len(predicted):
        raise ValueError("Metrics require equally sized, non-empty actual and predicted labels.")
    if any(index < 0 or index >= len(class_names) for index in actual + predicted):
        raise ValueError("Metrics contain a class index outside class_names.")

    matrix = [[0 for _ in class_names] for _ in class_names]
    for target, output in zip(actual, predicted):
        matrix[target][output] += 1

    per_class = {}
    f1_scores = []
    sensitivities = []
    specificities = []
    for index, name in enumerate(class_names):
        true_positive = matrix[index][index]
        support = sum(matrix[index])
        predicted_count = sum(row[index] for row in matrix)
        false_negative = support - true_positive
        false_positive = predicted_count - true_positive
        true_negative = len(actual) - true_positive - false_negative - false_positive
        precision = true_positive / predicted_count if predicted_count else 0.0
        recall = true_positive / support if support else 0.0
        specificity = (
            true_negative / (true_negative + false_positive)
            if true_negative + false_positive
            else 0.0
        )
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        per_class[name] = {
            "support": support,
            "precision": precision,
            "recall": recall,
            "sensitivity": recall,
            "specificity": specificity,
            "f1": f1,
        }
        f1_scores.append(f1)
        sensitivities.append(recall)
        specificities.append(specificity)

    return {
        "sampleCount": len(actual),
        "accuracy": sum(matrix[index][index] for index in range(len(class_names))) / len(actual),
        "macroPrecision": sum(row["precision"] for row in per_class.values())
        / len(class_names),
        "macroRecall": sum(row["recall"] for row in per_class.values()) / len(class_names),
        "macroF1": sum(f1_scores) / len(class_names),
        "macroSensitivity": sum(sensitivities) / len(class_names),
        "macroSpecificity": sum(specificities) / len(class_names),
        "perClass": per_class,
        "confusionMatrix": matrix,
    }


def _train(manifest: dict, samples: list[dict], summary: dict, args) -> dict:
    try:
        import torch
        from PIL import Image, UnidentifiedImageError
        from torch import nn
        from torch.utils.data import DataLoader, Dataset
        from torchvision import models
        from torchvision import transforms
    except ImportError as error:
        raise RuntimeError(
            "Training dependencies are missing. Install model-service/requirements.txt "
            "in a dedicated research environment."
        ) from error

    class LabeledImages(Dataset):
        def __init__(self, split: str):
            self.rows = [sample for sample in samples if sample["split"] == split]
            transform_steps = (
                [
                    transforms.RandomResizedCrop(
                        224, scale=(0.85, 1.0), ratio=(0.95, 1.05)
                    ),
                    transforms.RandomHorizontalFlip(p=0.5),
                    transforms.RandomRotation(degrees=8),
                    transforms.ColorJitter(
                        brightness=0.12, contrast=0.12, saturation=0.08
                    ),
                ]
                if split == "train"
                else [transforms.Resize((224, 224))]
            )
            transform_steps.extend(
                [
                    transforms.ToTensor(),
                    transforms.Normalize(
                        mean=(0.485, 0.456, 0.406),
                        std=(0.229, 0.224, 0.225),
                    ),
                ]
            )
            self.transform = transforms.Compose(transform_steps)

        def __len__(self):
            return len(self.rows)

        def __getitem__(self, index):
            sample = self.rows[index]
            try:
                with Image.open(sample["path"]) as source:
                    image = source.convert("RGB")
            except (OSError, UnidentifiedImageError) as error:
                raise ValueError("A labeled dataset image could not be decoded.") from error
            return self.transform(image), manifest["classes"].index(sample["label"])

    random.seed(args.seed)
    torch.manual_seed(args.seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(args.seed)
    device = torch.device(args.device)
    if device.type == "cuda" and not torch.cuda.is_available():
        raise ValueError("CUDA was requested but is not available.")

    loaders = {
        split: DataLoader(
            LabeledImages(split),
            batch_size=args.batch_size,
            shuffle=split == "train",
            num_workers=0,
        )
        for split in SPLITS
    }
    model = models.efficientnet_b0(
        weights=models.EfficientNet_B0_Weights.IMAGENET1K_V1
    )
    model.classifier[1] = nn.Linear(
        model.classifier[1].in_features, len(manifest["classes"])
    )
    model.to(device)
    criterion = nn.CrossEntropyLoss()
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate)
    best_accuracy = -1.0
    best_validation_loss = float("inf")
    best_state = None
    history = []

    def run_epoch(loader, training: bool):
        model.train(training)
        loss_total = 0.0
        count = 0
        actual = []
        predicted = []
        context = torch.enable_grad() if training else torch.inference_mode()
        with context:
            for images, labels in loader:
                images, labels = images.to(device), labels.to(device)
                if training:
                    optimizer.zero_grad(set_to_none=True)
                logits = model(images)
                loss = criterion(logits, labels)
                if training:
                    loss.backward()
                    optimizer.step()
                batch_size = labels.size(0)
                count += batch_size
                loss_total += loss.item() * batch_size
                actual.extend(labels.cpu().tolist())
                predicted.extend(logits.argmax(dim=1).cpu().tolist())
        return loss_total / count, classification_metrics(
            actual, predicted, manifest["classes"]
        )

    for epoch in range(1, args.epochs + 1):
        train_loss, train_metrics = run_epoch(loaders["train"], training=True)
        validation_loss, validation_metrics = run_epoch(loaders["validation"], training=False)
        history.append(
            {
                "epoch": epoch,
                "trainLoss": train_loss,
                "trainAccuracy": train_metrics["accuracy"],
                "validationLoss": validation_loss,
                "validationAccuracy": validation_metrics["accuracy"],
            }
        )
        if (
            validation_metrics["accuracy"] > best_accuracy
            or (
                validation_metrics["accuracy"] == best_accuracy
                and validation_loss < best_validation_loss
            )
        ):
            best_accuracy = validation_metrics["accuracy"]
            best_validation_loss = validation_loss
            best_state = {
                name: value.detach().cpu().clone()
                for name, value in model.state_dict().items()
            }

    if best_state is None:
        raise RuntimeError("Training did not produce a validation checkpoint.")
    model.load_state_dict(best_state)
    model.to(device)
    _, test_metrics = run_epoch(loaders["test"], training=False)

    output_dir = args.output_dir.resolve()
    if output_dir == args.dataset_root.resolve() or args.dataset_root.resolve() in output_dir.parents:
        raise ValueError("Research outputs must be outside the input dataset directory.")
    output_dir.mkdir(parents=True, exist_ok=True)
    checkpoint_path = output_dir / "research-only-checkpoint.pt"
    report_path = output_dir / "research-report.json"
    if checkpoint_path.exists() or report_path.exists():
        raise FileExistsError("Research outputs already exist; choose a new output directory.")
    torch.save(
        {
            "purpose": "research_only_not_for_clinical_use",
            "datasetName": manifest["datasetName"],
            "classNames": manifest["classes"],
            "architecture": "EfficientNetB0",
            "pretrainedWeights": "IMAGENET1K_V1",
            "stateDict": best_state,
            "trainingArguments": {
                "epochs": args.epochs,
                "batchSize": args.batch_size,
                "learningRate": args.learning_rate,
                "seed": args.seed,
                "device": str(device),
            },
        },
        checkpoint_path,
    )
    report = {
        "purpose": "research_only_not_for_clinical_use",
        "patientDiagnosisAvailable": False,
        "dataset": {
            "name": manifest["datasetName"],
            "imageModality": manifest["imageModality"],
            "sourceUrl": manifest["sourceUrl"],
            "license": manifest["license"],
            "licenseUrl": manifest["licenseUrl"],
            "rightsReviewedBy": manifest["rightsReviewedBy"],
            "rightsReviewDate": manifest["rightsReviewDate"],
            "accessBasis": manifest["accessBasis"],
            "labelSource": manifest["labelSource"],
            "labelDefinition": manifest["labelDefinition"],
            "classes": manifest["classes"],
        },
        "splitSummary": summary,
        "trainingHistory": history,
        "model": {
            "architecture": "EfficientNetB0",
            "pretrainedWeights": "IMAGENET1K_V1",
        },
        "heldOutTestMetrics": test_metrics,
        "limitations": [
            "Research metrics do not establish clinical validity or patient-level accuracy.",
            "The held-out test set must remain untouched until the analysis is finalized.",
            "This checkpoint is not an approved or calibrated clinical model.",
            "No patient photo or individual diagnosis is produced by this workflow.",
        ],
        "checkpointFile": checkpoint_path.name,
    }
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


def _parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description="Validate or train an offline, research-only oral-image classifier."
    )
    parser.add_argument("--dataset-root", required=True, type=Path)
    parser.add_argument("--output-dir", type=Path, default=Path("research-output"))
    parser.add_argument("--validate-only", action="store_true")
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--learning-rate", type=float, default=0.0001)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    args = parser.parse_args(argv)
    if args.epochs < 1 or args.batch_size < 1 or args.learning_rate <= 0:
        parser.error("epochs, batch-size, and learning-rate must be positive.")
    return args


def main(argv=None) -> int:
    args = _parse_args(argv)
    try:
        manifest, samples, summary = load_dataset(args.dataset_root)
        if args.validate_only:
            print(
                json.dumps(
                    {
                        "purpose": "research_only",
                        "datasetName": manifest["datasetName"],
                        "license": manifest["license"],
                        "classes": manifest["classes"],
                        "splitSummary": summary,
                        "patientDiagnosisAvailable": False,
                    },
                    indent=2,
                )
            )
            return 0
        report = _train(manifest, samples, summary, args)
        print(
            json.dumps(
                {
                    "purpose": report["purpose"],
                    "reportFile": str(args.output_dir / "research-report.json"),
                    "checkpointFile": str(args.output_dir / "research-only-checkpoint.pt"),
                    "patientDiagnosisAvailable": False,
                },
                indent=2,
            )
        )
        return 0
    except (OSError, ValueError, RuntimeError) as error:
        print(f"Research training stopped: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
