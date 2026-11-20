import numpy as np
import torch
import torch.nn.functional as functional
from PIL import Image
from torchvision import transforms


def segment_region(model, image: Image.Image) -> dict:
    source = image.resize((256, 256), Image.Resampling.BILINEAR)
    tensor = transforms.ToTensor()(source).unsqueeze(0)
    with torch.inference_mode():
        logits = model(tensor)
    if isinstance(logits, (tuple, list)):
        logits = logits[0]
    if isinstance(logits, dict):
        logits = logits.get("out")
    if logits is None or logits.ndim != 4 or logits.shape[1] != 1:
        raise RuntimeError("The segmentation model must return one foreground mask.")

    mask = functional.interpolate(
        torch.sigmoid(logits), size=(256, 256), mode="bilinear", align_corners=False
    )[0, 0].cpu().numpy()
    binary = mask >= 0.5
    area_ratio = float(binary.mean())
    if area_ratio < 0.002 or area_ratio > 0.6:
        return {"ambiguous": True, "areaRatio": area_ratio}

    ys, xs = np.where(binary)
    x_scale = image.width / 256
    y_scale = image.height / 256
    bounds = (
        max(0, int(xs.min() * x_scale)),
        max(0, int(ys.min() * y_scale)),
        min(image.width, int((xs.max() + 1) * x_scale)),
        min(image.height, int((ys.max() + 1) * y_scale)),
    )
    mask_image = Image.fromarray((binary * 255).astype(np.uint8)).resize(
        image.size, Image.Resampling.NEAREST
    )
    return {
        "ambiguous": False,
        "areaRatio": area_ratio,
        "bounds": bounds,
        "mask": mask_image,
    }
