def _binary_auc(actual: list[int], scores: list[float]) -> float | None:
    positives = sum(actual)
    negatives = len(actual) - positives
    if not positives or not negatives:
        return None

    ordered = sorted(zip(scores, actual))
    positive_ranks = 0.0
    index = 0
    while index < len(ordered):
        end = index + 1
        while end < len(ordered) and ordered[end][0] == ordered[index][0]:
            end += 1
        average_rank = ((index + 1) + end) / 2
        positive_ranks += average_rank * sum(label for _, label in ordered[index:end])
        index = end

    return (positive_ranks - positives * (positives + 1) / 2) / (positives * negatives)


def classification_metrics(actual: list[int], probabilities: list[list[float]], classes: list[str]):
    if not actual or len(actual) != len(probabilities):
        raise ValueError("Evaluation requires equally sized, non-empty predictions and labels.")
    if any(len(row) != len(classes) for row in probabilities):
        raise ValueError("Every probability row must include all configured classes.")
    if any(label < 0 or label >= len(classes) for label in actual):
        raise ValueError("An evaluation label is outside the configured class range.")

    predicted = [max(range(len(row)), key=row.__getitem__) for row in probabilities]
    confusion = [[0 for _ in classes] for _ in classes]
    for target, output in zip(actual, predicted):
        confusion[target][output] += 1

    per_class = {}
    aucs = []
    for index, name in enumerate(classes):
        true_positive = confusion[index][index]
        false_negative = sum(confusion[index]) - true_positive
        false_positive = sum(row[index] for row in confusion) - true_positive
        true_negative = len(actual) - true_positive - false_negative - false_positive
        support = true_positive + false_negative
        precision = true_positive / (true_positive + false_positive) if true_positive + false_positive else 0
        sensitivity = true_positive / support if support else 0
        specificity = (
            true_negative / (true_negative + false_positive)
            if true_negative + false_positive
            else 0
        )
        auc = _binary_auc(
            [int(label == index) for label in actual],
            [row[index] for row in probabilities],
        )
        per_class[name] = {
            "support": support,
            "precision": precision,
            "sensitivity": sensitivity,
            "specificity": specificity,
            "f1": 2 * precision * sensitivity / (precision + sensitivity)
            if precision + sensitivity
            else 0,
            "auc": auc,
        }
        if auc is not None:
            aucs.append(auc)

    return {
        "sampleCount": len(actual),
        "accuracy": sum(confusion[index][index] for index in range(len(classes))) / len(actual),
        "macroSensitivity": sum(item["sensitivity"] for item in per_class.values())
        / len(classes),
        "macroSpecificity": sum(item["specificity"] for item in per_class.values())
        / len(classes),
        "macroAuc": sum(aucs) / len(aucs) if aucs else None,
        "perClass": per_class,
        "confusionMatrix": confusion,
    }
