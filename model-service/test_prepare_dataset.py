import tempfile
import unittest
from pathlib import Path

from PIL import Image
from torchvision.datasets import ImageFolder

from scripts.prepare_dataset import prepare_dataset


class PrepareOralDatasetTests(unittest.TestCase):
    def test_maps_source_labels_validates_and_splits_originals_only(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "original_data"
            for class_name, base_color in (("benign_lesions", 40), ("malignant_lesions", 140)):
                class_dir = source / class_name
                class_dir.mkdir(parents=True)
                for index in range(12):
                    Image.new(
                        "RGB",
                        (48, 48),
                        (base_color, (index * 13 + base_color) % 255, index + 10),
                    ).save(class_dir / f"{index}.jpg")
            benign_dir = source / "benign_lesions"
            (benign_dir / "corrupt.jpg").write_bytes(b"not an image")
            (benign_dir / "duplicate.jpg").write_bytes((benign_dir / "0.jpg").read_bytes())

            output = root / "prepared"
            for split in ("train", "val", "test"):
                for class_name in (
                    "benign",
                    "malignant",
                    "healthy",
                    "opmd",
                    "suspicious_oral_lesion",
                ):
                    placeholder = output / split / class_name / ".gitkeep"
                    placeholder.parent.mkdir(parents=True, exist_ok=True)
                    placeholder.touch()

            config = Path(__file__).parent / "training" / "config.json"
            prepare_dataset(source, output, config, seed=42)

            self.assertFalse((output / "train" / "healthy").exists())
            self.assertFalse((output / "val" / "opmd").exists())
            self.assertEqual((output / "subjects.csv").is_file(), True)
            for split in ("train", "val", "test"):
                dataset = ImageFolder(output / split)
                self.assertEqual(dataset.classes, ["benign", "malignant"])
                self.assertTrue(all(Path(path).suffix == ".jpg" for path, _ in dataset.samples))
            total = sum(
                len(ImageFolder(output / split).samples) for split in ("train", "val", "test")
            )
            self.assertEqual(total, 24)

    def test_refuses_to_overwrite_a_prepared_dataset(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "original_data"
            for class_name, base_color in (
                ("benign_lesions", (40, 60, 80)),
                ("malignant_lesions", (40, 160, 80)),
            ):
                class_dir = source / class_name
                class_dir.mkdir(parents=True)
                for index in range(12):
                    Image.new(
                        "RGB",
                        (20, 20),
                        (base_color[0] + index * 8, base_color[1], base_color[2]),
                    ).save(
                        class_dir / f"{index}.jpg"
                    )
            output = root / "prepared"
            config = Path(__file__).parent / "training" / "config.json"
            prepare_dataset(source, output, config, seed=7)
            with self.assertRaises(FileExistsError):
                prepare_dataset(source, output, config, seed=7)


if __name__ == "__main__":
    unittest.main()
