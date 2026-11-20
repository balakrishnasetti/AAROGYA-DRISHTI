import csv
import hashlib
import warnings
from pathlib import Path

from torchvision import datasets

SPLITS = ("train", "val", "test")
RECOMMENDED_IMAGES_PER_CLASS = 100


def validate_dataset(root: Path, classes: list[str]):
    root = root.resolve(strict=True)
    datasets_by_split = {}
    subject_to_split = {}
    image_splits = {}
    subject_counts = {name: set() for name in classes}

    for split in SPLITS:
        split_root = root / split
        if not split_root.is_dir():
            raise ValueError(f"Dataset is missing the {split}/ directory.")
        image_dataset = datasets.ImageFolder(split_root)
        if image_dataset.classes != classes:
            raise ValueError(
                f"{split}/ class folders must exactly match config.json: {', '.join(classes)}."
            )
        if not image_dataset.samples:
            raise ValueError(f"{split}/ contains no images.")
        if {class_index for _, class_index in image_dataset.samples} != set(range(len(classes))):
            raise ValueError(f"Every class must contain images in {split}/.")
        datasets_by_split[split] = image_dataset
        for image_path, _ in image_dataset.samples:
            digest = hashlib.sha256(Path(image_path).read_bytes()).hexdigest()
            previous_split = image_splits.setdefault(digest, split)
            if previous_split != split:
                raise ValueError("Identical image content appears across dataset splits.")

    subjects_file = root / "subjects.csv"
    if not subjects_file.is_file():
        raise ValueError("subjects.csv is required to verify patient/source separation.")
    with subjects_file.open("r", encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        if not reader.fieldnames or not {"image_path", "subject_id"}.issubset(reader.fieldnames):
            raise ValueError("subjects.csv must include image_path,subject_id columns.")
        subjects_by_image = {}
        for row_number, row in enumerate(reader, start=2):
            relative = (row.get("image_path") or "").strip().replace("\\", "/")
            subject_id = (row.get("subject_id") or "").strip()
            if not relative or not subject_id or subject_id.lower() in {"unknown", "tbd", "none"}:
                raise ValueError(f"subjects.csv row {row_number} has a missing subject ID.")
            image_path = (root / relative).resolve(strict=True)
            if root not in image_path.parents or not image_path.is_file():
                raise ValueError(
                    f"subjects.csv row {row_number} references a path outside the dataset."
                )
            if relative in subjects_by_image:
                raise ValueError(f"subjects.csv row {row_number} duplicates an image path.")
            subjects_by_image[relative] = subject_id

    for split, image_dataset in datasets_by_split.items():
        for image_path, class_index in image_dataset.samples:
            relative = Path(image_path).resolve().relative_to(root).as_posix()
            subject_id = subjects_by_image.get(relative)
            if not subject_id:
                raise ValueError(f"subjects.csv is missing {relative}.")
            previous_split = subject_to_split.setdefault(subject_id, split)
            if previous_split != split:
                raise ValueError("A patient appears in more than one dataset split.")
            subject_counts[classes[class_index]].add(subject_id)
    if len(subjects_by_image) != sum(len(item.samples) for item in datasets_by_split.values()):
        raise ValueError("subjects.csv contains image paths that are not in the dataset.")

    for class_name in classes:
        image_count = sum(
            class_index == classes.index(class_name)
            for image_dataset in datasets_by_split.values()
            for _, class_index in image_dataset.samples
        )
        if image_count < RECOMMENDED_IMAGES_PER_CLASS:
            warnings.warn(
                f"{class_name}: {image_count} images found; at least "
                f"{RECOMMENDED_IMAGES_PER_CLASS} are recommended for research."
            )
    return datasets_by_split
