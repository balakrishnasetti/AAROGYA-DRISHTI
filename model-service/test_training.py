import csv
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from training.metrics import classification_metrics
from training.train import validate_dataset

CLASSES = ["benign", "healthy", "opmd", "suspicious_oral_lesion"]


class TrainingMetricsTests(unittest.TestCase):
    def test_computes_confusion_sensitivity_specificity_and_auc(self):
        result = classification_metrics(
            [0, 0, 1, 1],
            [[0.9, 0.1], [0.2, 0.8], [0.1, 0.9], [0.2, 0.8]],
            ["benign", "healthy"],
        )

        self.assertEqual(result["confusionMatrix"], [[1, 1], [0, 2]])
        self.assertEqual(result["accuracy"], 0.75)
        self.assertEqual(result["perClass"]["benign"]["sensitivity"], 0.5)
        self.assertEqual(result["perClass"]["healthy"]["specificity"], 0.5)
        self.assertEqual(result["macroAuc"], 0.875)

    def test_returns_null_auc_if_test_split_has_only_one_class(self):
        result = classification_metrics([0, 0], [[0.9, 0.1], [0.8, 0.2]], ["a", "b"])
        self.assertIsNone(result["macroAuc"])


class DatasetValidationTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        rows = []
        for split_index, split in enumerate(("train", "val", "test")):
            for class_index, name in enumerate(CLASSES):
                image_path = Path(split) / name / f"{split}-{name}.png"
                target = self.root / image_path
                target.parent.mkdir(parents=True, exist_ok=True)
                Image.new(
                    "RGB",
                    (32, 32),
                    (class_index * 30 + 20, split_index * 20 + 40, 90),
                ).save(target)
                rows.append((image_path.as_posix(), f"subject-{split}-{name}"))
        with (self.root / "subjects.csv").open("w", encoding="utf-8", newline="") as file:
            writer = csv.writer(file)
            writer.writerow(["image_path", "subject_id"])
            writer.writerows(rows)

    def tearDown(self):
        self.temporary_directory.cleanup()

    def test_validates_all_splits_and_patient_separation(self):
        result = validate_dataset(self.root, CLASSES)
        self.assertEqual(set(result), {"train", "val", "test"})

    def test_rejects_patient_overlap_between_splits(self):
        subjects_path = self.root / "subjects.csv"
        lines = subjects_path.read_text(encoding="utf-8").splitlines()
        fields = lines[1].split(",")
        val_line = next(index for index, line in enumerate(lines) if line.startswith("val/"))
        val_fields = lines[val_line].split(",")
        lines[val_line] = f"{val_fields[0]},{fields[1]}"
        subjects_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

        with self.assertRaisesRegex(ValueError, "patient appears in more than one"):
            validate_dataset(self.root, CLASSES)


if __name__ == "__main__":
    unittest.main()
