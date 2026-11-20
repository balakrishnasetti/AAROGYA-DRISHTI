import argparse
import json
import random
from pathlib import Path

import matplotlib
import numpy as np
import torch
from sklearn.metrics import auc, confusion_matrix, precision_recall_fscore_support, roc_curve
from torch.utils.data import DataLoader
from torchvision import datasets, transforms

matplotlib.use("Agg")
import matplotlib.pyplot as plt

if __package__:
    from .model import create_model, load_config
else:
    from model import create_model, load_config

MALIGNANT_CLASS = "malignant"


def wilson_interval(successes: int, total: int, z: float = 1.96):
    if total == 0:
        return None
    proportion = successes / total
    denominator = 1 + z * z / total
    center = (proportion + z * z / (2 * total)) / denominator
    margin = z * (
        proportion * (1 - proportion) / total + z * z / (4 * total * total)
    ) ** 0.5 / denominator
    return [max(0.0, center - margin), min(1.0, center + margin)]


def bootstrap_auc_interval(actual, scores, iterations=2000, seed=42):
    if not actual or len(set(actual)) < 2:
        return None
    rng = random.Random(seed)
    values = []
    length = len(actual)
    for _ in range(iterations):
        indexes = [rng.randrange(length) for _ in range(length)]
        labels = [actual[index] for index in indexes]
        if len(set(labels)) < 2:
            continue
        false_positive, true_positive, _ = roc_curve(
            labels, [scores[index] for index in indexes]
        )
        values.append(float(auc(false_positive, true_positive)))
    if not values:
        return None
    return [float(np.percentile(values, 2.5)), float(np.percentile(values, 97.5))]


def evaluate(dataset_root: Path, model_path: Path, metadata_path: Path, batch_size: int, output_dir: Path):
    metadata = load_config(metadata_path)
    classes = metadata.get("class_names", metadata["classes"])
    if classes != ["benign", MALIGNANT_CLASS]:
        raise ValueError("The saved metadata must define classes in benign, malignant order.")
    test_root = dataset_root.resolve(strict=True) / "test"
    test_data = datasets.ImageFolder(
        test_root,
        transform=transforms.Compose(
            [
                transforms.Resize((metadata["input_size"], metadata["input_size"])),
                transforms.ToTensor(),
                transforms.Normalize(
                    mean=metadata["normalization"]["mean"],
                    std=metadata["normalization"]["std"],
                ),
            ]
        ),
    )
    if test_data.classes != classes:
        raise ValueError("Test class folders must exactly match model_meta.json.")
    if not test_data.samples:
        raise ValueError("The test split contains no images.")
    loader = DataLoader(test_data, batch_size=batch_size, shuffle=False, num_workers=0)

    model = create_model(len(classes))
    model.load_state_dict(
        torch.load(model_path, map_location="cpu", weights_only=True), strict=True
    )
    model.eval()
    actual = []
    probabilities = []
    with torch.inference_mode():
        for images, labels in loader:
            probabilities.extend(torch.softmax(model(images), dim=1).tolist())
            actual.extend(labels.tolist())

    malignant_index = classes.index(MALIGNANT_CLASS)
    malignant_actual = [int(label == malignant_index) for label in actual]
    malignant_scores = [row[malignant_index] for row in probabilities]
    predicted = [int(max(range(len(row)), key=row.__getitem__)) for row in probabilities]
    matrix = confusion_matrix(actual, predicted, labels=list(range(len(classes))))
    true_positive = int(matrix[malignant_index, malignant_index])
    false_negative = int(matrix[malignant_index].sum() - true_positive)
    false_positive = int(matrix[:, malignant_index].sum() - true_positive)
    true_negative = int(matrix.sum() - true_positive - false_negative - false_positive)
    precision, recall, f1, _ = precision_recall_fscore_support(
        malignant_actual,
        [int(label == malignant_index) for label in predicted],
        labels=[1],
        average=None,
        zero_division=0,
    )
    accuracy_count = int((np.asarray(actual) == np.asarray(predicted)).sum())
    malignant_auc = None
    if len(set(malignant_actual)) == 2:
        false_positive_rate, true_positive_rate, _ = roc_curve(
            malignant_actual, malignant_scores
        )
        malignant_auc = float(auc(false_positive_rate, true_positive_rate))

    output_dir.mkdir(parents=True, exist_ok=True)
    confusion_path = output_dir / "confusion_matrix.png"
    figure, axis = plt.subplots(figsize=(6, 5))
    image = axis.imshow(matrix, interpolation="nearest", cmap="Blues")
    figure.colorbar(image, ax=axis)
    axis.set(
        xticks=range(len(classes)),
        yticks=range(len(classes)),
        xticklabels=classes,
        yticklabels=classes,
        xlabel="Predicted class",
        ylabel="True class",
        title="Held-out test confusion matrix",
    )
    for row in range(len(classes)):
        for column in range(len(classes)):
            axis.text(column, row, str(matrix[row, column]), ha="center", va="center")
    figure.tight_layout()
    figure.savefig(confusion_path, dpi=160)
    plt.close(figure)

    malignant_support = true_positive + false_negative
    negative_support = true_negative + false_positive
    result = {
        "test_image_count": len(actual),
        "class_counts": {
            class_name: sum(label == index for label in actual)
            for index, class_name in enumerate(classes)
        },
        "accuracy": accuracy_count / len(actual),
        "accuracy_95_ci_wilson": wilson_interval(accuracy_count, len(actual)),
        "malignant_sensitivity": true_positive / malignant_support if malignant_support else None,
        "malignant_sensitivity_95_ci_wilson": wilson_interval(
            true_positive, malignant_support
        ),
        "malignant_specificity": true_negative / negative_support if negative_support else None,
        "malignant_specificity_95_ci_wilson": wilson_interval(
            true_negative, negative_support
        ),
        "malignant_precision": float(precision[0]),
        "malignant_recall": float(recall[0]),
        "malignant_f1": float(f1[0]),
        "malignant_auc": malignant_auc,
        "malignant_auc_95_ci_bootstrap": bootstrap_auc_interval(
            malignant_actual, malignant_scores
        ),
        "confusion_matrix_labels": classes,
        "confusion_matrix": matrix.tolist(),
        "confusion_matrix_png": str(confusion_path.resolve()),
    }
    return result


def parse_args():
    parser = argparse.ArgumentParser(description="Evaluate the held-out test split once.")
    parser.add_argument("--dataset-root", type=Path, default=Path(__file__).parents[1] / "data")
    parser.add_argument("--model-path", type=Path)
    parser.add_argument("--metadata", type=Path, default=Path(__file__).parents[1] / "models" / "model_meta.json")
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--output-dir", type=Path, default=Path(__file__).parents[1] / "evaluation")
    args = parser.parse_args()
    if args.batch_size < 1:
        parser.error("batch size must be positive.")
    return args


if __name__ == "__main__":
    arguments = parse_args()
    metadata_path = arguments.metadata.resolve(strict=True)
    metadata = load_config(metadata_path)
    model_path = arguments.model_path or Path(metadata["model_path"])
    if not model_path.is_absolute():
        model_path = (metadata_path.parent / model_path).resolve()
    print(
        "WARNING: this dataset has only about 300 images and the test split is small. "
        "Metrics are highly uncertain; 95% confidence intervals are shown. This is not "
        "clinical validation."
    )
    print(
        json.dumps(
            evaluate(
                arguments.dataset_root,
                model_path,
                metadata_path,
                arguments.batch_size,
                arguments.output_dir,
            ),
            indent=2,
        )
    )
