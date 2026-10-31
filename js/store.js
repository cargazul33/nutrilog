// Persistencia local de los datos del usuario.

import { sanitizeFasting } from './fasting.js';

const KEY = 'nutrilog:v1';
const DAY = 24 * 3600 * 1000;
export const BACKUP_EVERY_DAYS = 30;
export const BACKUP_SNOOZE_DAYS = 7;

export function defaultProfile() {
  return {
    sex: 'female',
    age: 30,
    heightCm: 165,
    weightKg: 65,
    activity: 'light',
    goal: 'maintain',
    customKcal: null,
  };
}

export function defaultMeta() {
  return {
    lastExport: null, // marca de tiempo de la última copia exportada
    backupSnoozeUntil: null, // recordatorio de copia pospuesto hasta esta marca
    profileSaved: false, // el usuario guardó su perfil al menos una vez
    profileNoticeDismissed: false, // cerró el aviso de perfil de ejemplo
  };
}

export function defaultState() {
  return {
    profile: defaultProfile(),
    entries: [], // { id, date, meal, name, brand, grams, per100 }
    recentFoods: [], // { key, name, brand, per100, serving }
    customFoods: [], // { id, key, name, brand, per100, serving }
    weights: [], // { date, kg }
    water: {}, // { 'YYYY-MM-DD': ml }
    fasting: sanitizeFasting(null), // { current, history, lastGoal }
    settings: { fastNotify: false },
    meta: defaultMeta(),
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

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const isObj = (o) => Boolean(o) && typeof o === 'object' && !Array.isArray(o);

// Valores por 100 g siempre numéricos (evita NaN en pantalla con datos viejos o importados).
function cleanPer100(p) {
  const n = (v) => (isNum(Number(v)) && Number(v) >= 0 ? Number(v) : 0);
  return { kcal: n(p?.kcal), protein: n(p?.protein), carbs: n(p?.carbs), fat: n(p?.fat) };
}

const validFood = (f) => isObj(f) && typeof f.name === 'string' && f.name.trim() !== '' && isObj(f.per100);

// Completa campos que falten (datos antiguos o importados) sin perder lo existente.
export function mergeState(data) {
  const base = defaultState();
  if (!isObj(data)) return base;
  const arr = (v) => (Array.isArray(v) ? v : []);
  return {
    profile: { ...base.profile, ...(isObj(data.profile) ? data.profile : {}) },
    entries: arr(data.entries)
      .filter((e) => validFood(e) && typeof e.date === 'string' && isNum(Number(e.grams)) && Number(e.grams) > 0)
      .map((e) => ({ ...e, grams: Number(e.grams), brand: e.brand || '', per100: cleanPer100(e.per100) })),
    recentFoods: arr(data.recentFoods).filter(validFood).map((f) => ({ ...f, per100: cleanPer100(f.per100) })),
    customFoods: arr(data.customFoods).filter((f) => validFood(f) && f.id)
      .map((f) => ({ ...f, key: `custom:${f.id}`, brand: f.brand || '', per100: cleanPer100(f.per100) })),
    weights: arr(data.weights).filter((w) => isObj(w) && typeof w.date === 'string' && isNum(w.kg)),
    water: isObj(data.water) ? data.water : {},
    fasting: sanitizeFasting(data.fasting),
    settings: { fastNotify: data.settings?.fastNotify === true },
    meta: {
      ...base.meta,
      lastExport: isNum(data.meta?.lastExport) ? data.meta.lastExport : null,
      backupSnoozeUntil: isNum(data.meta?.backupSnoozeUntil) ? data.meta.backupSnoozeUntil : null,
      profileSaved: data.meta?.profileSaved === true,
      profileNoticeDismissed: data.meta?.profileNoticeDismissed === true,
    },
  };
}

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function foodKey(food) {
  return food.key || food.code || `${food.name}|${food.brand || ''}`.toLowerCase();
}

export function rememberFood(state, food, max = 30) {
  const key = foodKey(food);
  const rest = state.recentFoods.filter((f) => f.key !== key);
  state.recentFoods = [{ ...food, key }, ...rest].slice(0, max);
}

export function setWeight(state, date, kg) {
  state.weights = state.weights.filter((w) => w.date !== date);
  state.weights.push({ date, kg });
  state.weights.sort((a, b) => a.date.localeCompare(b.date));
}

/* ---------- Alimentos propios ---------- */

export function addCustomFood(state, { name, brand = '', per100, serving = 100 }, id) {
  const clean = String(name || '').trim();
  if (!clean) throw new Error('El alimento necesita un nombre');
  const food = {
    id,
    key: `custom:${id}`,
    name: clean,
    brand: String(brand || '').trim(),
    per100: cleanPer100(per100),
    serving: isNum(serving) && serving > 0 ? serving : 100,
    custom: true,
  };
  state.customFoods = [food, ...state.customFoods];
  return food;
}

// Borra el alimento propio y su rastro en recientes (las entradas del diario se conservan).
export function deleteCustomFood(state, id) {
  const key = `custom:${id}`;
  state.customFoods = state.customFoods.filter((f) => f.id !== id);
  state.recentFoods = state.recentFoods.filter((f) => f.key !== key);
}

// Búsqueda local: primero los alimentos propios, luego recientes que no lo sean.
export function searchLocal(state, query = '') {
  const q = query.trim().toLowerCase();
  const match = (f) => !q || `${f.name} ${f.brand || ''}`.toLowerCase().includes(q);
  const customKeys = new Set(state.customFoods.map((f) => f.key));
  return {
    custom: state.customFoods.filter(match),
    recent: state.recentFoods.filter((f) => !customKeys.has(f.key) && !f.key?.startsWith('custom:') && match(f)),
  };
}

/* ---------- Avisos ---------- */

const hasData = (state) =>
  state.entries.length > 0 || state.weights.length > 0 || state.fasting.history.length > 0 ||
  state.customFoods.length > 0;

// Recordatorio de copia: hay datos y nunca se exportó o pasaron más de 30 días; respeta el aplazamiento.
export function backupReminderDue(state, now) {
  if (!hasData(state)) return false;
  if (state.meta.backupSnoozeUntil && now < state.meta.backupSnoozeUntil) return false;
  return !state.meta.lastExport || now - state.meta.lastExport > BACKUP_EVERY_DAYS * DAY;
}

export function snoozeBackupReminder(state, now) {
  state.meta.backupSnoozeUntil = now + BACKUP_SNOOZE_DAYS * DAY;
}

export function markExported(state, now) {
  state.meta.lastExport = now;
  state.meta.backupSnoozeUntil = null;
}

export function isDefaultProfile(profile) {
  const d = defaultProfile();
  return Object.keys(d).every((k) => profile[k] === d[k]);
}

// Aviso de perfil de ejemplo: desaparece para siempre al guardar el perfil, cambiarlo o cerrarlo.
export function profileNoticeDue(state) {
  return !state.meta.profileNoticeDismissed && !state.meta.profileSaved && isDefaultProfile(state.profile);
}
