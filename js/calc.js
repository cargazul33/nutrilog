// Cálculos puros de nutrición (sin acceso a DOM ni almacenamiento).

export const MEALS = [
  { id: 'breakfast', name: 'Desayuno' },
  { id: 'lunch', name: 'Almuerzo' },
  { id: 'dinner', name: 'Cena' },
  { id: 'snacks', name: 'Snacks' },
];

export const ACTIVITY = {
  sedentary: { factor: 1.2, label: 'Sedentario' },
  light: { factor: 1.375, label: 'Ligero (1-3 días/sem)' },
  moderate: { factor: 1.55, label: 'Moderado (3-5 días/sem)' },
  active: { factor: 1.725, label: 'Activo (6-7 días/sem)' },
  very: { factor: 1.9, label: 'Muy activo' },
};

export const GOALS = {
  lose: { delta: -500, label: 'Perder peso' },
  maintain: { delta: 0, label: 'Mantener peso' },
  gain: { delta: 300, label: 'Ganar peso' },
};

export const MACRO_SPLIT = { protein: 0.25, carbs: 0.5, fat: 0.25 };
const KCAL_PER_GRAM = { protein: 4, carbs: 4, fat: 9 };
const MIN_KCAL = 1200;

// Metabolismo basal (Mifflin-St Jeor).
export function bmr({ sex, weightKg, heightCm, age }) {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === 'female' ? base - 161 : base + 5;
}

export function dailyCalories(profile) {
  const activity = ACTIVITY[profile.activity] ?? ACTIVITY.sedentary;
  const goal = GOALS[profile.goal] ?? GOALS.maintain;
  const kcal = bmr(profile) * activity.factor + goal.delta;
  return Math.max(MIN_KCAL, Math.round(kcal));
}

export function macroTargets(kcal, split = MACRO_SPLIT) {
  const grams = {};
  for (const key of Object.keys(KCAL_PER_GRAM)) {
    grams[key] = Math.round((kcal * split[key]) / KCAL_PER_GRAM[key]);
  }
  return grams;
}

const round1 = (n) => Math.round(n * 10) / 10;

// Convierte valores por 100 g a la cantidad indicada.
export function scaleNutrients(per100, grams) {
  const f = grams / 100;
  return {
    kcal: Math.round((per100.kcal || 0) * f),
    protein: round1((per100.protein || 0) * f),
    carbs: round1((per100.carbs || 0) * f),
    fat: round1((per100.fat || 0) * f),
  };
}

export function sumNutrients(items) {
  const total = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  for (const item of items) {
    const n = scaleNutrients(item.per100, item.grams);
    total.kcal += n.kcal;
    total.protein += n.protein;
    total.carbs += n.carbs;
    total.fat += n.fat;
  }
  total.protein = round1(total.protein);
  total.carbs = round1(total.carbs);
  total.fat = round1(total.fat);
  return total;
}

// Fechas locales en formato YYYY-MM-DD.
export function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  return toISODate(new Date(y, m - 1, d + days));
}

export function bmi(weightKg, heightCm) {
  const h = heightCm / 100;
  return h > 0 ? round1(weightKg / (h * h)) : 0;
}
