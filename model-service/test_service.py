import unittest
from unittest.mock import patch

from fastapi import HTTPException
from PIL import Image
import torch

from app import TrainedPredictionRequest, health, predict_trained_classifier


class ModelServiceAvailabilityTests(unittest.TestCase):
    def test_health_reports_classifier_as_not_ready_without_checkpoint(self):
        with patch("app.trained_classifier", None), patch("app.trained_classifier_config", None):
            result = health()

        self.assertEqual(result["classifierModel"]["status"], "not_ready")
        self.assertFalse(result["model_loaded"])
        self.assertEqual(result["classifierModel"]["classes"], [])

    def test_predict_returns_explicit_unavailable_error_without_checkpoint(self):
        payload = TrainedPredictionRequest(
            imageBase64="eA==",
            mimeType="image/jpeg",
            region="tongue",
        )
        with (
            patch("app.API_TOKEN", "test-token"),
            patch("app.trained_classifier", None),
            patch("app.trained_classifier_config", None),
            patch("app.trained_preprocess", None),
        ):
            with self.assertRaises(HTTPException) as result:
                predict_trained_classifier(payload, "Bearer test-token")

        self.assertEqual(result.exception.status_code, 503)
        self.assertEqual(result.exception.detail["code"], "MODEL_NOT_CONFIGURED")
        self.assertIn("trained model weights", result.exception.detail["message"])

    def test_predict_uses_two_class_probabilities_and_conservative_malignant_risk(self):
        payload = TrainedPredictionRequest(
            imageBase64="eA==",
            mimeType="image/jpeg",
            region="tongue",
        )
        config = {
            "classes": ["benign", "malignant"],
            "minimum_confidence": 0.65,
            "risk_thresholds": {
                "meaningful_malignant_probability": 0.2,
                "high_malignant_probability": 0.65,
            },
        }
        with (
            patch("app.API_TOKEN", "test-token"),
            patch("app.trained_classifier", lambda image: torch.tensor([[0.0, 2.0]])),
            patch("app.trained_classifier_config", config),
            patch("app.trained_preprocess", lambda image: torch.zeros((3, 224, 224))),
            patch("app.trained_model_version", "test-version"),
            patch("app.decode_image", return_value=Image.new("RGB", (800, 600))),
            patch(
                "app.inspect_image_quality",
                return_value={"adequate": True, "reasons": []},
            ),
        ):
            result = predict_trained_classifier(payload, "Bearer test-token")

        self.assertEqual(result["status"], "classified")
        self.assertEqual(result["predictedClass"], "malignant")
        self.assertEqual(result["riskLevel"], "high")
        self.assertEqual(set(result["classProbabilities"]), {"benign", "malignant"})

    def test_predict_returns_inconclusive_for_poor_quality_without_inference(self):
        payload = TrainedPredictionRequest(
            imageBase64="eA==",
            mimeType="image/jpeg",
            region="tongue",
        )
        with (
            patch("app.API_TOKEN", "test-token"),
            patch("app.trained_classifier", side_effect=AssertionError("inference must not run")),
            patch(
                "app.trained_classifier_config",
                {"classes": ["benign", "malignant"], "minimum_confidence": 0.65},
            ),
            patch("app.trained_preprocess", lambda image: torch.zeros((3, 224, 224))),
            patch("app.trained_model_version", "test-version"),
            patch("app.decode_image", return_value=Image.new("RGB", (800, 600))),
            patch(
                "app.inspect_image_quality",
                return_value={"adequate": False, "reasons": ["blur"]},
            ),
        ):
            result = predict_trained_classifier(payload, "Bearer test-token")

        self.assertEqual(result["status"], "inconclusive")
        self.assertEqual(result["predictedClass"], None)
        self.assertEqual(result["reasons"], ["blur"])


if __name__ == "__main__":
    unittest.main()
