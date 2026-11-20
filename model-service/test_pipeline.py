import unittest

import numpy as np
from PIL import Image

from quality import inspect_image_quality
from uncertainty import decision_for_prediction


class ImageValidationTests(unittest.TestCase):
    def test_rejects_resolution_below_minimum(self):
        result = inspect_image_quality(Image.new("RGB", (320, 240), (120, 80, 80)))
        self.assertFalse(result["adequate"])
        self.assertIn("resolution", result["reasons"])

    def test_accepts_minimum_resolution_in_portrait_orientation(self):
        image = Image.new("RGB", (480, 640), (120, 80, 80))
        result = inspect_image_quality(image)
        self.assertNotIn("resolution", result["reasons"])

    def test_rejects_dark_photos_with_retake_reason(self):
        result = inspect_image_quality(Image.new("RGB", (640, 480), (0, 0, 0)))
        self.assertFalse(result["adequate"])
        self.assertIn("too_dark", result["reasons"])

    def test_accepts_clear_evenly_lit_synthetic_pattern(self):
        rows, columns = np.indices((480, 640))
        gray = np.where((rows // 8 + columns // 8) % 2, 170, 80).astype(np.uint8)
        image = Image.fromarray(np.stack((gray, gray, gray), axis=2), mode="RGB")
        result = inspect_image_quality(image)
        self.assertTrue(result["adequate"])
        self.assertEqual(result["reasons"], [])


class UncertaintyGateTests(unittest.TestCase):
    def test_confidence_below_calibrated_threshold_is_unclear(self):
        result = decision_for_prediction(
            image_adequate=True,
            oral_probability=0.99,
            oral_threshold=0.9,
            segmentation_ambiguous=False,
            confidence=0.72,
            confidence_threshold=0.8,
        )
        self.assertEqual(result, "unclear")

    def test_ambiguous_segmentation_is_unclear(self):
        result = decision_for_prediction(
            image_adequate=True,
            oral_probability=0.99,
            oral_threshold=0.9,
            segmentation_ambiguous=True,
            confidence=0.99,
            confidence_threshold=0.8,
        )
        self.assertEqual(result, "unclear")


if __name__ == "__main__":
    unittest.main()
