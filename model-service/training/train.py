import argparse
import json
import random
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import torch
from torch.utils.data import DataLoader, WeightedRandomSampler
from torchvision import datasets, transforms

if __package__:
    from .metrics import classification_metrics
    from .model import create_model, load_config
    from .train_data import validate_dataset
else:
    from metrics import classification_metrics
    from model import create_model, load_config
    from train_data import validate_dataset

SPLITS = ("train", "val", "test")
MALIGNANT_CLASS = "malignant"


def _evaluate(model, loader, device, classes):
    model.eval()
    actual = []
    probabilities = []
    with torch.inference_mode():
        for images, labels in loader:
            logits = model(images.to(device))
            probabilities.extend(torch.softmax(logits, dim=1).cpu().tolist())
            actual.extend(labels.tolist())
    return classification_metrics(actual, probabilities, classes)


def _dataset_counts(datasets_by_split):
    result = {}
    for split in SPLITS:
        counts = Counter(index for _, index in datasets_by_split[split].samples)
        result[split] = {
            class_name: counts[index]
            for index, class_name in enumerate(datasets_by_split[split].classes)
        }
    return result


def _set_frozen_phase(model):
    for parameter in model.features.parameters():
        parameter.requires_grad = False
    for parameter in model.classifier.parameters():
        parameter.requires_grad = True


def _set_fine_tune_phase(model):
    for parameter in model.features.parameters():
        parameter.requires_grad = False
    for block in model.features[-2:]:
        for parameter in block.parameters():
            parameter.requires_grad = True
    for parameter in model.classifier.parameters():
        parameter.requires_grad = True


def train(args):
    config_path = args.config.resolve()
    config = load_config(config_path)
    if config["classes"] != ["benign", "malignant"]:
        raise ValueError("This dataset pipeline supports exactly benign and malignant classes.")

    dataset_root = args.dataset_root.resolve(strict=True)
    datasets_by_split = validate_dataset(dataset_root, config["classes"])
    counts_by_split = _dataset_counts(datasets_by_split)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if args.device == "cuda" and device.type != "cuda":
        raise ValueError("CUDA was requested but is not available.")
    if args.device == "cpu":
        device = torch.device("cpu")

    random.seed(args.seed)
    torch.manual_seed(args.seed)
    if device.type == "cuda":
        torch.cuda.manual_seed_all(args.seed)

    size = config["input_size"]
    normalization = config["normalization"]
    common = [
        transforms.ToTensor(),
        transforms.Normalize(mean=normalization["mean"], std=normalization["std"]),
    ]
    datasets_by_split["train"].transform = transforms.Compose(
        [
            transforms.RandomResizedCrop(size, scale=(0.8, 1.0), ratio=(0.9, 1.1)),
            transforms.RandomHorizontalFlip(),
            transforms.RandomRotation(8),
            transforms.ColorJitter(brightness=0.15, contrast=0.12, saturation=0.1),
            *common,
        ]
    )
    for split in ("val", "test"):
        datasets_by_split[split].transform = transforms.Compose(
            [transforms.Resize((size, size)), *common]
        )

    train_dataset = datasets_by_split["train"]
    train_counts = Counter(label for _, label in train_dataset.samples)
    class_weights = torch.tensor(
        [
            len(train_dataset.samples) / (len(config["classes"]) * train_counts[index])
            for index in range(len(config["classes"]))
        ],
        dtype=torch.float32,
        device=device,
    )
    sample_weights = [1.0 / train_counts[label] for _, label in train_dataset.samples]
    train_loader = DataLoader(
        train_dataset,
        batch_size=args.batch_size,
        sampler=WeightedRandomSampler(sample_weights, len(sample_weights), replacement=True),
        num_workers=0,
    )
    validation_loader = DataLoader(
        datasets_by_split["val"], batch_size=args.batch_size, shuffle=False, num_workers=0
    )

    model = create_model(len(config["classes"]), pretrained=not args.no_pretrained).to(device)
    _set_frozen_phase(model)
    optimizer = torch.optim.AdamW(
        (parameter for parameter in model.parameters() if parameter.requires_grad),
        lr=args.learning_rate,
    )
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
        optimizer, mode="max", factor=0.5, patience=2, min_lr=1e-7
    )
    criterion = torch.nn.CrossEntropyLoss(weight=class_weights)
    malignant_index = config["classes"].index(MALIGNANT_CLASS)
    best_score = float("-inf")
    best_state = None
    best_metrics = None
    epochs_without_improvement = 0
    output_path = Path(config["model_path"])
    if not output_path.is_absolute():
        output_path = (config_path.parent / output_path).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    for epoch in range(1, args.epochs + 1):
        if epoch == args.freeze_epochs + 1:
            _set_fine_tune_phase(model)
            optimizer.add_param_group(
                {
                    "params": [
                        parameter
                        for parameter in model.features[-2:].parameters()
                        if parameter.requires_grad
                    ],
                    "lr": args.learning_rate / 10,
                }
            )
            print("Fine-tuning the final EfficientNet-B0 feature blocks.", flush=True)

        model.train()
        if epoch <= args.freeze_epochs:
            model.features.eval()
        for images, labels in train_loader:
            images, labels = images.to(device), labels.to(device)
            optimizer.zero_grad(set_to_none=True)
            loss = criterion(model(images), labels)
            loss.backward()
            optimizer.step()

        validation = _evaluate(model, validation_loader, device, config["classes"])
        malignant_metrics = validation["perClass"][MALIGNANT_CLASS]
        validation_auc = malignant_metrics["auc"]
        score = (
            validation_auc
            if validation_auc is not None
            else malignant_metrics["sensitivity"]
        )
        scheduler.step(score)
        print(
            json.dumps(
                {
                    "epoch": epoch,
                    "validationAucMalignant": validation_auc,
                    "validationSensitivityMalignant": malignant_metrics["sensitivity"],
                    "validationLossMetric": "best malignant AUC, fallback sensitivity",
                    "selectionScore": score,
                    "learningRates": [group["lr"] for group in optimizer.param_groups],
                }
            ),
            flush=True,
        )
        if score > best_score:
            best_score = score
            best_metrics = validation
            best_state = {
                key: value.detach().cpu().clone()
                for key, value in model.state_dict().items()
            }
            epochs_without_improvement = 0
            temporary_path = output_path.with_suffix(output_path.suffix + ".tmp")
            torch.save(best_state, temporary_path)
            temporary_path.replace(output_path)
        else:
            epochs_without_improvement += 1
            if epochs_without_improvement >= args.patience:
                print(f"Early stopping after {epoch} epochs.", flush=True)
                break

    if best_state is None or best_metrics is None:
        raise RuntimeError("Training did not produce a validation checkpoint.")

    metadata = {
        "architecture": config["architecture"],
        "framework": "PyTorch",
        "class_names": config["classes"],
        "classes": config["classes"],
        "input_size": config["input_size"],
        "normalization": config["normalization"],
        "training_date_utc": datetime.now(timezone.utc).isoformat(),
        "dataset_counts_per_split": counts_by_split,
        "validation_metrics": best_metrics,
        "dataset_source": config["dataset_source"],
        "dataset_license": config["dataset_license"],
        "pretrained_on_imagenet": not args.no_pretrained,
        "model_path": str(output_path),
    }
    metadata_path = output_path.with_name("model_meta.json")
    temporary_metadata_path = metadata_path.with_suffix(".json.tmp")
    temporary_metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    temporary_metadata_path.replace(metadata_path)
    print(f"Saved best validation checkpoint to: {output_path}")
    print(f"Saved model metadata to: {metadata_path}")
    print(
        "Test data was not used for checkpoint selection; run evaluate.py once for the "
        "held-out test metrics."
    )
    print(
        "This 323-image, two-class research dataset has no normal class and is not "
        "clinically validated."
    )


def parse_args():
    parser = argparse.ArgumentParser(
        description="Train the two-class oral-photo research classifier."
    )
    parser.add_argument("--dataset-root", type=Path, default=Path(__file__).parents[1] / "data")
    parser.add_argument("--config", type=Path, default=Path(__file__).with_name("config.json"))
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--freeze-epochs", type=int, default=3)
    parser.add_argument("--patience", type=int, default=6)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--learning-rate", type=float, default=0.0001)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--device", choices=("auto", "cpu", "cuda"), default="auto")
    parser.add_argument("--no-pretrained", action="store_true")
    args = parser.parse_args()
    if min(args.epochs, args.patience, args.batch_size) < 1:
        parser.error("epochs, patience, and batch size must be positive.")
    if not 0 <= args.freeze_epochs < args.epochs or args.learning_rate <= 0:
        parser.error("freeze epochs must be in [0, epochs), and learning rate must be positive.")
    return args


if __name__ == "__main__":
    train(parse_args())
