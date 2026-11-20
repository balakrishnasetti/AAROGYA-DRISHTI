import numpy as np
import torch
import torch.nn.functional as functional
from PIL import Image, ImageFilter


def gradcam_overlay(classifier, preprocess, image: Image.Image, class_index: int) -> Image.Image:
    captured = {}
    target_layer = classifier.layer4[-1]
    forward_hook = target_layer.register_forward_hook(
        lambda _module, _inputs, output: captured.update(activations=output)
    )
    backward_hook = target_layer.register_full_backward_hook(
        lambda _module, _grad_input, grad_output: captured.update(gradients=grad_output[0])
    )
    try:
        classifier.zero_grad(set_to_none=True)
        logits = classifier(preprocess(image).unsqueeze(0))
        logits[0, class_index].backward()
        activations = captured["activations"].detach()
        gradients = captured["gradients"].detach()
        weights = gradients.mean(dim=(2, 3), keepdim=True)
        cam = torch.relu((weights * activations).sum(dim=1, keepdim=True))
        cam = functional.interpolate(
            cam, size=(image.height, image.width), mode="bilinear", align_corners=False
        )[0, 0]
        cam = cam.cpu().numpy()
        cam = (cam - cam.min()) / (cam.max() - cam.min() + 1e-8)
        heat = np.zeros((image.height, image.width, 3), dtype=np.uint8)
        heat[:, :, 0] = (255 * cam).astype(np.uint8)
        heat[:, :, 1] = (180 * np.maximum(0, 1 - np.abs(cam - 0.5) * 2)).astype(np.uint8)
        return Image.blend(image.convert("RGB"), Image.fromarray(heat), 0.42).filter(
            ImageFilter.GaussianBlur(radius=1)
        )
    finally:
        forward_hook.remove()
        backward_hook.remove()
