import json
from pathlib import Path

import torch
from torchvision import models
from torchvision.transforms import Compose, Normalize, Resize, ToTensor


def load_config(config_path: Path) -> dict:
    config = json.loads(config_path.read_text(encoding="utf-8"))
    if config.get("architecture") != "efficientnet_b0":
        raise ValueError("The oral image model must use efficientnet_b0.")
    classes = config.get("classes")
    if (
        not isinstance(classes, list)
        or len(classes) < 2
        or any(not isinstance(name, str) or not name for name in classes)
        or len(set(classes)) != len(classes)
    ):
        raise ValueError("The model configuration must include at least two class labels.")
    if config.get("input_size") != 224:
        raise ValueError("The model input size must match training (224 pixels).")
    normalization = config.get("normalization")
    if (
        not isinstance(normalization, dict)
        or len(normalization.get("mean", [])) != 3
        or len(normalization.get("std", [])) != 3
        or any(float(value) <= 0 for value in normalization["std"])
    ):
        raise ValueError("The model configuration must include valid RGB normalization values.")
    return config


def create_model(class_count: int, pretrained: bool = False):
    weights = models.EfficientNet_B0_Weights.IMAGENET1K_V1 if pretrained else None
    model = models.efficientnet_b0(weights=weights)
    model.classifier[1] = torch.nn.Linear(model.classifier[1].in_features, class_count)
    return model


def create_preprocess(config: dict):
    normalization = config["normalization"]
    return Compose(
        [
            Resize((config["input_size"], config["input_size"])),
            ToTensor(),
            Normalize(mean=normalization["mean"], std=normalization["std"]),
        ]
    )


def load_trained_model(model_path: Path, config_path: Path):
    config = load_config(config_path)
    model = create_model(len(config["classes"]))
    model.load_state_dict(
        torch.load(model_path, map_location="cpu", weights_only=True),
        strict=True,
    )
    model.eval()
    return model, config, create_preprocess(config)
