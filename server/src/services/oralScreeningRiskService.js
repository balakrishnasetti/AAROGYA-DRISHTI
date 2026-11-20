const findingRiskWeights = {
  white_patch: 1,
  red_patch: 1,
  ulcer_like_area: 1,
  raised_area: 1,
  no_visible_finding: 0,
};

function answerValue(answers, questionKey) {
  const item = answers.find((answer) => answer.questionKey === questionKey);
  return item && !item.skipped ? item.answer : null;
}

export function calculateOralScreeningRisk({ finding, probabilities, answers = [] }) {
  const factors = [];
  let questionnairePoints = 0;

  const age = Number(answerValue(answers, 'age'));
  if (Number.isFinite(age) && age >= 40) {
    questionnairePoints += 5;
    factors.push('age_40_or_over_reported');
  }

  if (answerValue(answers, 'family_history') === true) {
    questionnairePoints += 5;
    factors.push('family_history_reported');
  }

  const tobacco = answerValue(answers, 'tobacco_type');
  if (['smoked', 'chewed', 'both'].includes(tobacco)) {
    questionnairePoints += 10;
    factors.push('tobacco_reported');
  }

  if (answerValue(answers, 'betel_nut') === true) {
    questionnairePoints += 10;
    factors.push('betel_or_areca_reported');
  }

  if (answerValue(answers, 'alcohol') === true) {
    questionnairePoints += 5;
    factors.push('alcohol_reported');
  }

  const symptoms = answerValue(answers, 'symptoms');
  const duration = answerValue(answers, 'symptom_duration');
  if (
    Array.isArray(symptoms) &&
    symptoms.includes('non_healing_ulcer') &&
    ['2_4_weeks', '1_3_months', 'gt_3_months'].includes(duration)
  ) {
    questionnairePoints += 15;
    factors.push('ulcer_reported_over_two_weeks');
  }

  const visualProbability = Object.entries(probabilities).reduce(
    (total, [label, probability]) =>
      total + probability * (findingRiskWeights[label] || 0),
    0,
  );
  const score = Math.min(100, Math.round(visualProbability * 50 + questionnairePoints));
  const riskCategory =
    score >= 55 ? 'high' : score >= 20 ? 'moderate' : 'low';
  const minimumVisualCategory = finding === 'no_visible_finding' ? 'low' : 'moderate';
  const categoryRank = { low: 0, moderate: 1, high: 2 };
  const combinedCategory =
    categoryRank[riskCategory] >= categoryRank[minimumVisualCategory]
      ? riskCategory
      : minimumVisualCategory;

  return {
    score,
    questionnairePoints,
    riskCategory: combinedCategory,
    factors,
    scoringVersion: 'prototype-v2',
  };
}
