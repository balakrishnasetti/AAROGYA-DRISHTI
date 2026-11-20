import csv
import json
import tempfile
import unittest
from pathlib import Path

from research_training import CLINICAL_CLASSES, classification_metrics, load_dataset


class ResearchDatasetTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.manifest = {
            "purpose": "research_only",
            "subjectIdsPseudonymous": True,
            "imageModality": "smartphone_clinical_photo",
            "datasetName": "Licensed research dataset",
            "sourceUrl": "https://example.org/dataset",
            "license": "CC BY 4.0",
            "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
            "rightsReviewedBy": "Research lead",
            "rightsReviewDate": "2026-01-15",
            "accessBasis": "Dataset terms reviewed for research use",
            "labelSource": "Independent specialist review",
            "labelDefinition": "Predefined image-level research categories",
            "classes": list(CLINICAL_CLASSES),
        }
        (self.root / "dataset-manifest.json").write_text(
            json.dumps(self.manifest), encoding="utf-8"
        )
        self.rows = [
            (
                f"{split}-{index}.jpg",
                label,
                f"subject-{split}-{index}",
                split,
                f"{split}-{index}".encode(),
            )
            for split in ("train", "validation", "test")
            for index, label in enumerate(CLINICAL_CLASSES)
        ]
        with (self.root / "labels.csv").open("w", encoding="utf-8", newline="") as file:
            writer = csv.writer(file)
            writer.writerow(["image_path", "label", "subject_id", "split"])
            for image_name, label, subject_id, split, content in self.rows:
                (self.root / image_name).write_bytes(content)
                writer.writerow([image_name, label, subject_id, split])

    def tearDown(self):
        self.temporary_directory.cleanup()

    def test_loads_dataset_and_returns_only_aggregate_split_counts(self):
        manifest, samples, summary = load_dataset(self.root)

        self.assertEqual(manifest["classes"], list(CLINICAL_CLASSES))
        self.assertEqual(len(samples), 12)
        self.assertEqual(summary["train"], {"images": 4, "subjects": 4})
        self.assertEqual(summary["validation"], {"images": 4, "subjects": 4})
        self.assertEqual(summary["test"], {"images": 4, "subjects": 4})

    def test_rejects_dataset_without_explicit_research_purpose(self):
        self.manifest["purpose"] = "clinical"
        (self.root / "dataset-manifest.json").write_text(
            json.dumps(self.manifest), encoding="utf-8"
        )

        with self.assertRaisesRegex(ValueError, "research_only"):
            load_dataset(self.root)

    def test_rejects_subject_overlap_between_splits(self):
        image_name, label, _, split, content = self.rows[-1]
        self.rows[-1] = (image_name, label, "subject-train-0", split, content)
        self._write_rows()

        with self.assertRaisesRegex(ValueError, "subject_id appears in more than one"):
            load_dataset(self.root)

    def test_rejects_identical_image_content_across_splits(self):
        image_name, label, subject_id, split, _ = self.rows[-1]
        self.rows[-1] = (image_name, label, subject_id, split, self.rows[0][4])
        self._write_rows()

        with self.assertRaisesRegex(ValueError, "Identical image content"):
            load_dataset(self.root)

    def test_rejects_path_traversal(self):
        _, label, subject_id, split, content = self.rows[0]
        self.rows[0] = ("../outside.jpg", label, subject_id, split, content)
        self._write_rows(create_images=False)

        with self.assertRaisesRegex(ValueError, "must stay inside"):
            load_dataset(self.root)

    def test_rejects_missing_license_review(self):
        self.manifest["rightsReviewedBy"] = "TBD"
        (self.root / "dataset-manifest.json").write_text(
            json.dumps(self.manifest), encoding="utf-8"
        )

        with self.assertRaisesRegex(ValueError, "rightsReviewedBy"):
            load_dataset(self.root)

    def test_rejects_histopathology_in_the_clinical_photo_trainer(self):
        self.manifest["imageModality"] = "histopathology"
        (self.root / "dataset-manifest.json").write_text(
            json.dumps(self.manifest), encoding="utf-8"
        )

        with self.assertRaisesRegex(ValueError, "smartphone_clinical_photo"):
            load_dataset(self.root)

    def _write_rows(self, create_images=True):
        with (self.root / "labels.csv").open("w", encoding="utf-8", newline="") as file:
            writer = csv.writer(file)
            writer.writerow(["image_path", "label", "subject_id", "split"])
            for image_name, label, subject_id, split, content in self.rows:
                if create_images and not image_name.startswith(".."):
                    (self.root / image_name).write_bytes(content)
                writer.writerow([image_name, label, subject_id, split])


class ResearchMetricTests(unittest.TestCase):
    def test_computes_aggregate_metrics_without_clinical_interpretation(self):
        result = classification_metrics([0, 0, 1, 1], [0, 1, 1, 1], ["a", "b"])

        self.assertEqual(result["sampleCount"], 4)
        self.assertEqual(result["confusionMatrix"], [[1, 1], [0, 2]])
        self.assertEqual(result["accuracy"], 0.75)
        self.assertEqual(result["perClass"]["a"]["sensitivity"], 0.5)
        self.assertEqual(result["perClass"]["a"]["specificity"], 1.0)
        self.assertEqual(result["perClass"]["a"]["support"], 2)
        self.assertEqual(result["perClass"]["b"]["recall"], 1.0)
        self.assertEqual(result["perClass"]["b"]["specificity"], 0.5)
        self.assertEqual(result["macroSpecificity"], 0.75)

    def test_rejects_empty_or_out_of_range_metrics(self):
        with self.assertRaisesRegex(ValueError, "equally sized, non-empty"):
            classification_metrics([], [], ["a", "b"])
        with self.assertRaisesRegex(ValueError, "outside class_names"):
            classification_metrics([2], [0], ["a", "b"])


if __name__ == "__main__":
    unittest.main()
