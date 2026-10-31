// Persistencia local de los datos del usuario.

const KEY = 'nutrilog:v1';

export function defaultState() {
  return {
    profile: {
      sex: 'female',
      age: 30,
      heightCm: 165,
      weightKg: 65,
      activity: 'light',
      goal: 'maintain',
      customKcal: null,
    },
    entries: [], // { id, date, meal, name, brand, grams, per100 }
    recentFoods: [], // { key, name, brand, per100, serving }
    weights: [], // { date, kg }
    water: {}, // { 'YYYY-MM-DD': ml }
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    return mergeState(JSON.parse(raw));
  } catch {
    return defaultState();
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

// Completa campos que falten (datos antiguos o importados).
export function mergeState(data) {
  const base = defaultState();
  if (!data || typeof data !== 'object') return base;
  return {
    profile: { ...base.profile, ...(data.profile || {}) },
    entries: Array.isArray(data.entries) ? data.entries : [],
    recentFoods: Array.isArray(data.recentFoods) ? data.recentFoods : [],
    weights: Array.isArray(data.weights) ? data.weights : [],
    water: data.water && typeof data.water === 'object' ? data.water : {},
  };
}

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function rememberFood(state, food, max = 30) {
  const key = food.code || `${food.name}|${food.brand || ''}`.toLowerCase();
  const rest = state.recentFoods.filter((f) => f.key !== key);
  state.recentFoods = [{ ...food, key }, ...rest].slice(0, max);
}

export function setWeight(state, date, kg) {
  state.weights = state.weights.filter((w) => w.date !== date);
  state.weights.push({ date, kg });
  state.weights.sort((a, b) => a.date.localeCompare(b.date));
}
