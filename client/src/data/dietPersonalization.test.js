import test from 'node:test';
import assert from 'node:assert/strict';
import guidance from './dietGuidance.json' with { type: 'json' };
import en from '../i18n/locales/en.json' with { type: 'json' };
import te from '../i18n/locales/te.json' with { type: 'json' };
import {
  createDailyMealPlan,
  getDailyStorageKey,
  getMealIdeas,
  getReminderStorageKey,
  getStageGuidance,
} from './dietPersonalization.js';

test('meal ideas are regional and respect vegetarian preference', () => {
  const vegetarianAndhraMeals = getMealIdeas({ region: 'andhra', vegetarian: true });
  assert.ok(vegetarianAndhraMeals.length > 0);
  assert.ok(vegetarianAndhraMeals.every((meal) => meal.vegetarian));
  assert.ok(vegetarianAndhraMeals.every((meal) => meal.regions.includes('andhra')));

  const nonVegetarianEastMeals = getMealIdeas({ region: 'east', vegetarian: false });
  assert.ok(nonVegetarianEastMeals.length > 0);
  assert.ok(nonVegetarianEastMeals.some((meal) => !meal.vegetarian));
});

test('stage personalization falls back safely and creates one suggestion per meal type', () => {
  assert.equal(getStageGuidance('unknown').titleKey, getStageGuidance('prevention').titleKey);
  const plan = createDailyMealPlan(getMealIdeas({ region: 'andhra', vegetarian: true }));
  assert.deepEqual(Object.keys(plan), ['breakfast', 'lunch', 'dinner', 'snack']);
  assert.ok(plan.breakfast && plan.lunch && plan.dinner && plan.snack);
});

test('daily tracker and reminder storage are patient-scoped', () => {
  assert.match(getDailyStorageKey('patient-1', '2026-11-11'), /patient-1/);
  assert.notEqual(getReminderStorageKey('patient-1'), getReminderStorageKey('patient-2'));
});

test('all diet content keys are translated in English and Telugu', () => {
  const keys = [
    ...Object.values(guidance.stages).flatMap((stage) => [stage.titleKey, ...stage.tipKeys]),
    ...guidance.foodsToEat.map(({ key }) => `diet.foods.${key}.title`),
    ...guidance.foodsToEat.map(({ key }) => `diet.foods.${key}.description`),
    ...guidance.foodsToAvoid.map(({ key }) => `diet.foods.${key}.title`),
    ...guidance.foodsToAvoid.map(({ key }) => `diet.foods.${key}.description`),
    ...guidance.mealIdeas.flatMap((meal) => [meal.titleKey, meal.descriptionKey]),
  ];
  for (const locale of [en, te]) {
    for (const key of keys) {
      const value = key.split('.').reduce((current, part) => current?.[part], locale);
      assert.equal(typeof value, 'string', `${key} should be translated`);
    }
  }
});
