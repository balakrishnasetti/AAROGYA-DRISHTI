import numpy as np
from PIL import Image

MIN_LONG_EDGE = 640
MIN_SHORT_EDGE = 480
MAX_PIXELS = 40_000_000


def inspect_image_quality(image: Image.Image) -> dict:
    width, height = image.size
    reasons = []
    if (
        max(width, height) < MIN_LONG_EDGE
        or min(width, height) < MIN_SHORT_EDGE
        or width * height > MAX_PIXELS
    ):
        reasons.append("resolution")

    gray = np.asarray(image.convert("L"), dtype=np.float32)
    if min(gray.shape) < 3:
        reasons.append("resolution")
        return {"adequate": False, "reasons": sorted(set(reasons)), "width": width, "height": height}

    center = gray[1:-1, 1:-1]
    laplacian = (
        gray[1:-1, :-2]
        + gray[1:-1, 2:]
        + gray[:-2, 1:-1]
        + gray[2:, 1:-1]
        - 4 * center
    )
    blur_score = float(np.var(laplacian))
    brightness = float(np.mean(gray))
    dark_ratio = float(np.mean(gray < 30))
    glare_ratio = float(np.mean(gray > 240))

    if blur_score < 35:
        reasons.append("blur")
    if brightness < 35 or dark_ratio > 0.6:
        reasons.append("too_dark")
    if brightness > 220 or glare_ratio > 0.2:
        reasons.append("glare")

    return {
        "adequate": not reasons,
        "reasons": sorted(set(reasons)),
        "width": width,
        "height": height,
        "blurScore": blur_score,
        "brightness": brightness,
        "darkRatio": dark_ratio,
        "glareRatio": glare_ratio,
    }


def oral_cavity_probability(model, preprocess, image: Image.Image) -> float:
    import torch

    with torch.inference_mode():
        probabilities = torch.softmax(model(preprocess(image).unsqueeze(0)), dim=1)[0]
    return float(probabilities[0].item())
