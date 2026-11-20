import argparse
import csv
import hashlib
import random
import sys
import warnings
from collections import Counter, defaultdict
from pathlib import Path

from PIL import Image, UnidentifiedImageError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from training.model import load_config

SPLIT_NAMES = ("train", "val", "test")
SPLIT_FRACTIONS = (0.70, 0.15, 0.15)
SUPPORTED_IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}
GROUP_COLUMNS = ("subject_id", "patient_id", "source_id", "group_id")
MINIMUM_IMAGES_PER_CLASS = 100
SOURCE_CLASS_NAMES = {
    "benign_lesions": "benign",
    "malignant_lesions": "malignant",
}


def _readable_image(path: Path) -> bool:
    try:
        with Image.open(path) as image:
            image.verify()
        with Image.open(path) as image:
            image.convert("RGB").load()
    except (OSError, ValueError, UnidentifiedImageError, Image.DecompressionBombError):
        return False
    return True


def _collect_folder_records(input_dir: Path, classes: list[str]) -> list[dict]:
    records = []
    for class_dir in sorted(path for path in input_dir.iterdir() if path.is_dir()):
        label = SOURCE_CLASS_NAMES.get(class_dir.name, class_dir.name)
        if class_dir.name.startswith("augmented_"):
            warnings.warn(f"Ignoring augmented class folder: {class_dir.name}")
            continue
        if label not in classes:
            raise ValueError(
                f"Unknown class folder {class_dir.name!r}. Expected source classes "
                f"benign_lesions and malignant_lesions (mapped to {', '.join(classes)})."
            )
        for path in sorted(class_dir.rglob("*")):
            if path.is_file() and path.suffix.lower() in SUPPORTED_IMAGE_SUFFIXES:
                records.append({"path": path.resolve(), "label": label, "group_id": None})
    if not records:
        raise ValueError("No supported images were found in class subfolders.")
    return records


def _collect_csv_records(csv_path: Path, classes: list[str]) -> list[dict]:
    records = []
    with csv_path.open("r", encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        if not reader.fieldnames or not {"filename", "label"}.issubset(reader.fieldnames):
            raise ValueError("The CSV must include filename,label columns.")
        group_column = next((name for name in GROUP_COLUMNS if name in reader.fieldnames), None)
        for row_number, row in enumerate(reader, start=2):
            filename = (row.get("filename") or "").strip()
            label = (row.get("label") or "").strip()
            if not filename or not label:
                warnings.warn(f"CSV row {row_number} has an empty filename or label; skipping.")
                continue
            if label not in classes:
                raise ValueError(
                    f"CSV row {row_number} has unknown class {label!r}. "
                    f"Expected: {', '.join(classes)}."
                )
            path = Path(filename)
            if not path.is_absolute():
                path = csv_path.parent / path
            if path.suffix.lower() not in SUPPORTED_IMAGE_SUFFIXES:
                warnings.warn(f"Unsupported image format at CSV row {row_number}: {path}")
                continue
            group_id = (row.get(group_column) or "").strip() if group_column else ""
            records.append(
                {
                    "path": path.resolve(),
                    "label": label,
                    "group_id": group_id or None,
                }
            )
    if not records:
        raise ValueError("The CSV did not contain any supported image rows.")
    return records


def collect_records(input_path: Path, classes: list[str]) -> tuple[list[dict], list[Path], int]:
    if input_path.is_file():
        records = _collect_csv_records(input_path, classes)
    elif input_path.is_dir():
        records = _collect_folder_records(input_path, classes)
    else:
        raise FileNotFoundError(f"Dataset input does not exist: {input_path}")

    valid_records = []
    corrupt_paths = []
    seen_hashes = {}
    duplicate_count = 0
    for record in records:
        path = record["path"]
        if not path.is_file() or not _readable_image(path):
            corrupt_paths.append(path)
            continue
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        previous = seen_hashes.get(digest)
        if previous:
            if previous["label"] != record["label"]:
                raise ValueError(
                    f"Exact duplicate images have conflicting labels: "
                    f"{previous['path']} ({previous['label']}) and {path} ({record['label']})."
                )
            duplicate_count += 1
            continue
        record["digest"] = digest
        seen_hashes[digest] = record
        valid_records.append(record)

    if corrupt_paths:
        print(f"Corrupt or unreadable images skipped ({len(corrupt_paths)}):")
        for path in corrupt_paths:
            print(f"  {path}")
    print(f"Exact duplicate images skipped: {duplicate_count}")
    if not valid_records:
        raise ValueError("No readable, unique images remain after validation.")
    return valid_records, corrupt_paths, duplicate_count


def assign_splits(records: list[dict], classes: list[str], seed: int) -> dict[str, str]:
    group_records = defaultdict(list)
    for index, record in enumerate(records):
        group = record["group_id"] or f"image:{record['digest']}"
        group_records[group].append(index)

    class_indices = {name: index for index, name in enumerate(classes)}
    group_vectors = {}
    class_group_counts = Counter()
    class_totals = Counter(record["label"] for record in records)
    for group, indices in group_records.items():
        vector = [0] * len(classes)
        for index in indices:
            vector[class_indices[records[index]["label"]]] += 1
        group_vectors[group] = vector
        for index, count in enumerate(vector):
            if count:
                class_group_counts[classes[index]] += 1

    insufficient = [
        name for name in classes if class_group_counts[name] < len(SPLIT_NAMES)
    ]
    if insufficient:
        raise ValueError(
            "Cannot place every class in train/val/test without splitting a patient/source. "
            f"Fewer than three independent groups for: {', '.join(insufficient)}."
        )

    targets = [
        [class_totals[name] * fraction for name in classes]
        for fraction in SPLIT_FRACTIONS
    ]
    rng = random.Random(seed)
    best_assignment = None
    best_score = float("inf")

    for _ in range(512):
        groups = list(group_vectors)
        rng.shuffle(groups)
        groups.sort(key=lambda group: -sum(group_vectors[group]))
        counts = [[0] * len(classes) for _ in SPLIT_NAMES]
        assignment = {}
        for group in groups:
            vector = group_vectors[group]
            candidate_scores = []
            for split_index in range(len(SPLIT_NAMES)):
                counts[split_index] = [
                    counts[split_index][class_index] + vector[class_index]
                    for class_index in range(len(classes))
                ]
                score = 0.0
                for current_split in range(len(SPLIT_NAMES)):
                    for class_index in range(len(classes)):
                        target = max(targets[current_split][class_index], 1.0)
                        delta = (
                            counts[current_split][class_index]
                            - targets[current_split][class_index]
                        ) / target
                        score += delta * delta
                candidate_scores.append(score)
                counts[split_index] = [
                    counts[split_index][class_index] - vector[class_index]
                    for class_index in range(len(classes))
                ]
            chosen = min(range(len(SPLIT_NAMES)), key=candidate_scores.__getitem__)
            counts[chosen] = [
                counts[chosen][class_index] + vector[class_index]
                for class_index in range(len(classes))
            ]
            assignment[group] = SPLIT_NAMES[chosen]

        if any(counts[split][class_index] == 0 for split in range(3) for class_index in range(len(classes))):
            continue
        score = sum(
            (
                (counts[split][class_index] - targets[split][class_index])
                / max(targets[split][class_index], 1.0)
            )
            ** 2
            for split in range(len(SPLIT_NAMES))
            for class_index in range(len(classes))
        )
        if score < best_score:
            best_assignment = assignment
            best_score = score

    if best_assignment is None:
        raise ValueError(
            "Unable to create all three splits while keeping patient/source groups together. "
            "Check that each class has enough independent patients or sources."
        )
    return best_assignment


def prepare_dataset(input_path: Path, output_dir: Path, config_path: Path, seed: int = 42):
    config = load_config(config_path)
    classes = config["classes"]
    records, _, _ = collect_records(input_path.resolve(), classes)
    group_assignment = assign_splits(records, classes, seed)

    output_dir = output_dir.resolve()
    existing_images = [
        path
        for split in SPLIT_NAMES
        for path in (output_dir / split).rglob("*")
        if path.is_file() and path.suffix.lower() in SUPPORTED_IMAGE_SUFFIXES
    ] if output_dir.exists() else []
    if existing_images:
        raise FileExistsError(
            f"Output already contains prepared images: {output_dir}. "
            "Choose a new --output directory to avoid overwriting data."
        )
    for split in SPLIT_NAMES:
        split_dir = output_dir / split
        if not split_dir.is_dir():
            continue
        for class_dir in split_dir.iterdir():
            if not class_dir.is_dir() or class_dir.name in classes:
                continue
            contents = list(class_dir.iterdir())
            if contents and all(path.is_file() and path.name == ".gitkeep" for path in contents):
                for placeholder in contents:
                    placeholder.unlink()
                class_dir.rmdir()
            elif contents:
                raise FileExistsError(
                    f"Unexpected class folder contains user files: {class_dir}. "
                    "Move or back up its contents before preparing this two-class dataset."
                )
            else:
                class_dir.rmdir()

    count_by_split = {split: Counter() for split in SPLIT_NAMES}
    subjects_rows = []
    for record in records:
        group = record["group_id"] or f"image:{record['digest']}"
        split = group_assignment[group]
        label = record["label"]
        filename = f"{record['digest'][:16]}{record['path'].suffix.lower()}"
        relative_path = Path(split) / label / filename
        destination = output_dir / relative_path
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(record["path"].read_bytes())
        count_by_split[split][label] += 1
        subjects_rows.append(
            {
                "image_path": relative_path.as_posix(),
                "subject_id": record["group_id"] or group,
            }
        )

    with (output_dir / "subjects.csv").open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=("image_path", "subject_id"))
        writer.writeheader()
        writer.writerows(subjects_rows)

    print("Image counts by split and class:")
    print(f"{'split':<8}" + "".join(f"{name:>30}" for name in classes) + f"{'total':>10}")
    for split in SPLIT_NAMES:
        counts = count_by_split[split]
        print(
            f"{split:<8}"
            + "".join(f"{counts[name]:>30}" for name in classes)
            + f"{sum(counts.values()):>10}"
        )
    totals = Counter(record["label"] for record in records)
    print(
        f"{'all':<8}"
        + "".join(f"{totals[name]:>30}" for name in classes)
        + f"{len(records):>10}"
    )
    for name in classes:
        if totals[name] < MINIMUM_IMAGES_PER_CLASS:
            warnings.warn(
                f"{name} has {totals[name]} images; at least "
                f"{MINIMUM_IMAGES_PER_CLASS} are recommended."
            )
    if len(classes) == 2 and set(classes) == {"benign", "malignant"}:
        warnings.warn(
            "This dataset is small and has only two classes (benign, malignant); "
            "it has no healthy/normal class and cannot classify normal mouths."
        )
    nonzero_counts = [totals[name] for name in classes if totals[name]]
    if len(nonzero_counts) > 1 and max(nonzero_counts) / min(nonzero_counts) >= 3:
        warnings.warn("Class imbalance is heavy (largest class is at least 3x the smallest).")
    print(f"Prepared dataset written to: {output_dir}")
    if not any(record["group_id"] for record in records):
        print(
            "No patient/source IDs were provided; images were split independently. "
            "This does not prevent patient leakage."
        )


def parse_args():
    parser = argparse.ArgumentParser(
        description="Validate, deduplicate, and split a labelled oral-photo dataset."
    )
    parser.add_argument(
        "--input",
        required=True,
        type=Path,
        help="Use original_data class folders only, or a CSV with filename,label and optional patient/source ID.",
    )
    parser.add_argument("--output", type=Path, default=Path(__file__).parents[1] / "data")
    parser.add_argument(
        "--config",
        type=Path,
        default=Path(__file__).parents[1] / "training" / "config.json",
    )
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args()


if __name__ == "__main__":
    arguments = parse_args()
    prepare_dataset(arguments.input, arguments.output, arguments.config, arguments.seed)
