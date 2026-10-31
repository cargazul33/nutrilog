import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultState, mergeState, addCustomFood, deleteCustomFood, searchLocal, rememberFood,
  backupReminderDue, snoozeBackupReminder, markExported, profileNoticeDue, isDefaultProfile,
} from '../js/store.js';

const DAY = 24 * 3600 * 1000;
const per100 = { kcal: 120, protein: 8, carbs: 10, fat: 5 };

test('alimento propio: crear con datos limpios', () => {
  const s = defaultState();
  const f = addCustomFood(s, { name: '  Tarta de la abuela ', brand: ' Casa ', per100: { kcal: '300', protein: 6, carbs: 'x', fat: -2 } }, 'a1');
  assert.deepEqual(f, {
    id: 'a1', key: 'custom:a1', name: 'Tarta de la abuela', brand: 'Casa',
    per100: { kcal: 300, protein: 6, carbs: 0, fat: 0 }, serving: 100, custom: true,
  });
  assert.equal(s.customFoods.length, 1);
  assert.throws(() => addCustomFood(s, { name: '   ', per100 }, 'a2'));
});

test('alimento propio: aparece primero en la búsqueda local y no se duplica en recientes', () => {
  const s = defaultState();
  rememberFood(s, { name: 'Yogur natural', brand: 'Marca', per100 });
  const mine = addCustomFood(s, { name: 'Yogur casero', per100 }, 'y1');
  rememberFood(s, mine); // usado en el diario
  const all = searchLocal(s, '');
  assert.deepEqual(all.custom.map((f) => f.name), ['Yogur casero']);
  assert.deepEqual(all.recent.map((f) => f.name), ['Yogur natural']);
  const q = searchLocal(s, 'CASERO');
  assert.deepEqual(q.custom.map((f) => f.id), ['y1']);
  assert.deepEqual(q.recent, []);
  assert.deepEqual(searchLocal(s, 'marca').recent.map((f) => f.name), ['Yogur natural']);
});

test('alimento propio: borrar lo quita de Mis alimentos y de recientes, no del diario', () => {
  const s = defaultState();
  const f = addCustomFood(s, { name: 'Pan casero', per100 }, 'p1');
  rememberFood(s, f);
  s.entries.push({ id: 'e', date: '2026-01-01', meal: 'lunch', name: f.name, grams: 50, per100: f.per100 });
  deleteCustomFood(s, 'p1');
  assert.deepEqual(s.customFoods, []);
  assert.deepEqual(s.recentFoods, []);
  assert.equal(s.entries.length, 1);
});

test('migración: estado antiguo conserva todo y recibe los bloques nuevos', () => {
  const old = {
    profile: { age: 41, sex: 'male', heightCm: 180, weightKg: 85, activity: 'moderate', goal: 'lose', customKcal: null },
    entries: [{ id: '1', date: '2026-01-01', meal: 'lunch', name: 'Pan', brand: '', grams: 50, per100 }],
    recentFoods: [{ key: 'pan|', name: 'Pan', per100 }],
    weights: [{ date: '2026-01-01', kg: 85 }],
    water: { '2026-01-01': 750 },
    fasting: { current: { start: 5, goalHours: 16, protocol: '16:8' }, history: [] },
  };
  const s = mergeState(JSON.parse(JSON.stringify(old)));
  assert.deepEqual(s.profile, old.profile);
  assert.deepEqual(s.entries, old.entries);
  assert.deepEqual(s.recentFoods, old.recentFoods);
  assert.deepEqual(s.weights, old.weights);
  assert.deepEqual(s.water, old.water);
  assert.equal(s.fasting.current.start, 5);
  assert.deepEqual(s.customFoods, []);
  assert.deepEqual(s.settings, { fastNotify: false });
  assert.deepEqual(s.meta, defaultState().meta);
});

test('migración: descarta datos rotos que mostrarían NaN o undefined', () => {
  const s = mergeState({
    entries: [
      { id: 'ok', date: '2026-01-01', meal: 'lunch', name: 'Arroz', grams: '80', per100: { kcal: '130' } },
      { id: 'sin-per100', date: '2026-01-01', name: 'X', grams: 10 },
      { id: 'sin-nombre', date: '2026-01-01', grams: 10, per100 },
      { id: 'gramos-mal', date: '2026-01-01', name: 'Y', grams: 'mucho', per100 },
      null,
    ],
    recentFoods: [{ name: 'Z' }, 'texto'],
    customFoods: [{ id: 'c', name: 'Mío', per100: { kcal: 50 } }, { name: 'sin id', per100 }],
    weights: [{ date: '2026-01-01', kg: 'setenta' }, { date: '2026-01-02', kg: 70 }],
    settings: { fastNotify: 'sí' },
    meta: { lastExport: 'ayer', profileSaved: true },
  });
  assert.deepEqual(s.entries.map((e) => e.id), ['ok']);
  assert.deepEqual(s.entries[0].per100, { kcal: 130, protein: 0, carbs: 0, fat: 0 });
  assert.equal(s.entries[0].grams, 80);
  assert.deepEqual(s.recentFoods, []);
  assert.deepEqual(s.customFoods.map((f) => f.key), ['custom:c']);
  assert.deepEqual(s.weights, [{ date: '2026-01-02', kg: 70 }]);
  assert.equal(s.settings.fastNotify, false);
  assert.equal(s.meta.lastExport, null);
  assert.equal(s.meta.profileSaved, true);
});

test('recordatorio de copia: solo con datos, nunca exportada o hace más de 30 días', () => {
  const now = 100 * DAY;
  const s = defaultState();
  assert.equal(backupReminderDue(s, now), false); // sin datos, nada que respaldar
  s.weights.push({ date: '2026-01-01', kg: 70 });
  assert.equal(backupReminderDue(s, now), true); // nunca exportó
  markExported(s, now);
  assert.equal(backupReminderDue(s, now + 30 * DAY), false);
  assert.equal(backupReminderDue(s, now + 31 * DAY), true);
  snoozeBackupReminder(s, now + 31 * DAY); // cerrar el aviso lo pospone 7 días
  assert.equal(backupReminderDue(s, now + 37 * DAY), false);
  assert.equal(backupReminderDue(s, now + 39 * DAY), true);
  markExported(s, now + 40 * DAY);
  assert.equal(s.meta.backupSnoozeUntil, null);
});

test('aviso de perfil de ejemplo: visible solo con el perfil por defecto sin tocar', () => {
  const s = defaultState();
  assert.equal(isDefaultProfile(s.profile), true);
  assert.equal(profileNoticeDue(s), true);
  s.profile.weightKg = 80; // perfil modificado (por ejemplo al registrar el peso)
  assert.equal(profileNoticeDue(s), false);

  const saved = defaultState();
  saved.meta.profileSaved = true; // guardó el perfil aunque coincida con el ejemplo
  assert.equal(profileNoticeDue(saved), false);

  const closed = defaultState();
  closed.meta.profileNoticeDismissed = true;
  assert.equal(profileNoticeDue(closed), false);
  assert.equal(profileNoticeDue(mergeState(JSON.parse(JSON.stringify(closed)))), false); // persiste
});
