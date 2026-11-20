def decision_for_prediction(
    *,
    image_adequate: bool,
    oral_probability: float,
    oral_threshold: float,
    segmentation_ambiguous: bool,
    confidence: float,
    confidence_threshold: float,
) -> str:
    if (
        not image_adequate
        or oral_probability < oral_threshold
        or segmentation_ambiguous
        or confidence < confidence_threshold
    ):
        return "unclear"
    return "classified"
