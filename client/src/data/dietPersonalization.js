import guidance from './dietGuidance.json' with { type: 'json' };

export const DIET_STAGES = Object.keys(guidance.stages);
export const DIET_REGIONS = guidance.regions;

export function getMealIdeas({ region, vegetarian }) {
  return guidance.mealIdeas.filter((meal) =>
    (vegetarian ? meal.vegetarian : true) && meal.regions.includes(region),
  );
}

export function getStageGuidance(stage) {
  return guidance.stages[stage] || guidance.stages.prevention;
}

export function createDailyMealPlan(meals) {
  return Object.fromEntries(
    ['breakfast', 'lunch', 'dinner', 'snack'].map((mealType) => [
      mealType,
      meals.find((meal) => meal.mealType === mealType)?.id || '',
    ]),
  );
}

export function getDailyStorageKey(patientId, date) {
  return `aarogya.diet.${patientId}.${date}`;
}

export function getReminderStorageKey(patientId) {
  return `aarogya.diet.reminders.${patientId}`;
}
