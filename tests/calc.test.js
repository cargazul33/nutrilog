import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bmr, dailyCalories, macroTargets, scaleNutrients, sumNutrients, addDays, toISODate, bmi,
} from '../js/calc.js';
import { normalizeProduct } from '../js/off.js';
import { defaultState, mergeState, rememberFood, setWeight } from '../js/store.js';

const profile = { sex: 'male', age: 30, heightCm: 180, weightKg: 80, activity: 'moderate', goal: 'maintain' };

test('bmr usa Mifflin-St Jeor', () => {
  assert.equal(bmr(profile), 1780);
  assert.equal(bmr({ ...profile, sex: 'female' }), 1614);
});

test('dailyCalories aplica actividad, objetivo y mínimo', () => {
  assert.equal(dailyCalories(profile), Math.round(1780 * 1.55));
  assert.equal(dailyCalories({ ...profile, goal: 'lose' }), Math.round(1780 * 1.55 - 500));
  assert.equal(dailyCalories({ sex: 'female', age: 90, heightCm: 140, weightKg: 35, activity: 'sedentary', goal: 'lose' }), 1200);
});

test('macroTargets reparte 25/50/25', () => {
  assert.deepEqual(macroTargets(2000), { protein: 125, carbs: 250, fat: 56 });
});

test('scaleNutrients y sumNutrients', () => {
  const per100 = { kcal: 200, protein: 10, carbs: 20, fat: 5 };
  assert.deepEqual(scaleNutrients(per100, 50), { kcal: 100, protein: 5, carbs: 10, fat: 2.5 });
  const total = sumNutrients([{ per100, grams: 50 }, { per100, grams: 150 }]);
  assert.deepEqual(total, { kcal: 400, protein: 20, carbs: 40, fat: 10 });
});

test('fechas locales', () => {
  assert.equal(toISODate(new Date(2026, 0, 5)), '2026-01-05');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
});

test('bmi', () => {
  assert.equal(bmi(80, 180), 24.7);
});

test('normalizeProduct convierte datos de Open Food Facts', () => {
  const food = normalizeProduct({
    code: '123', product_name: 'Yogur', brands: 'Marca A, Marca B', serving_quantity: '125',
    nutriments: { 'energy-kcal_100g': 61, proteins_100g: 3.5, carbohydrates_100g: 4.7, fat_100g: 3.2 },
  });
  assert.deepEqual(food, {
    code: '123', name: 'Yogur', brand: 'Marca A',
    per100: { kcal: 61, protein: 3.5, carbs: 4.7, fat: 3.2 }, serving: 125,
  });
  // Solo kJ: se convierte a kcal
  assert.equal(normalizeProduct({ product_name: 'X', nutriments: { energy_100g: 418.4 } }).per100.kcal, 100);
  // Sin nombre o sin energía se descarta
  assert.equal(normalizeProduct({ product_name: '', nutriments: { 'energy-kcal_100g': 10 } }), null);
  assert.equal(normalizeProduct({ product_name: 'Agua', nutriments: {} }), null);
});

test('store: mergeState, rememberFood y setWeight', () => {
  assert.deepEqual(mergeState(null), defaultState());
  const s = mergeState({ profile: { age: 40 }, entries: 'mal' });
  assert.equal(s.profile.age, 40);
  assert.equal(s.profile.sex, 'female');
  assert.deepEqual(s.entries, []);

  rememberFood(s, { name: 'Pan', per100: { kcal: 250 } });
  rememberFood(s, { name: 'Leche', per100: { kcal: 60 } });
  rememberFood(s, { name: 'Pan', per100: { kcal: 250 } });
  assert.deepEqual(s.recentFoods.map((f) => f.name), ['Pan', 'Leche']);

  setWeight(s, '2026-01-02', 70);
  setWeight(s, '2026-01-01', 71);
  setWeight(s, '2026-01-02', 69.5);
  assert.deepEqual(s.weights, [{ date: '2026-01-01', kg: 71 }, { date: '2026-01-02', kg: 69.5 }]);
});
