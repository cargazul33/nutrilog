import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROTOCOLS, isExtended, validGoal, fastProgress, formatDuration, startFast, endFast,
  isProlongedRecord, fastingStats, sanitizeFasting, protocolLabel, goalAlert, LATE_ALERT_MS,
} from '../js/fasting.js';
import { defaultState, mergeState } from '../js/store.js';

const H = 3600 * 1000;
const at = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();

test('protocolos predefinidos y nota solo para más de 24 h', () => {
  assert.deepEqual(PROTOCOLS.map((p) => p.hours), [12, 14, 16, 18, 20, 23, 24, 36, 48, 72]);
  assert.equal(isExtended(24), false);
  assert.equal(isExtended(36), true);
  assert.equal(isExtended(30), true);
  assert.equal(protocolLabel('omad', 23), 'OMAD 23:1');
  assert.equal(protocolLabel(null, 30), '30 h');
});

test('validGoal acepta de 1 a 168 h', () => {
  assert.ok(validGoal(1) && validGoal(16) && validGoal(168));
  assert.ok(!validGoal(0) && !validGoal(169) && !validGoal(NaN));
});

test('fastProgress calcula transcurrido, restante, fin y meta', () => {
  const fast = { start: at(2026, 1, 1, 20), goalHours: 16 };
  const mid = fastProgress(fast, fast.start + 4 * H);
  assert.equal(mid.elapsedMs, 4 * H);
  assert.equal(mid.remainingMs, 12 * H);
  assert.equal(mid.ratio, 0.25);
  assert.equal(mid.reached, false);
  assert.equal(mid.endsAt, at(2026, 1, 2, 12));

  const done = fastProgress(fast, fast.start + 17 * H);
  assert.equal(done.reached, true);
  assert.equal(done.ratio, 1);
  assert.equal(done.remainingMs, 0);
  // Reloj atrasado: nunca negativo
  assert.equal(fastProgress(fast, fast.start - H).elapsedMs, 0);
});

test('formatDuration usa hh:mm:ss y supera 24 h', () => {
  assert.equal(formatDuration(0), '00:00:00');
  assert.equal(formatDuration(H + 2 * 60000 + 3000), '01:02:03');
  assert.equal(formatDuration(36 * H), '36:00:00');
});

test('startFast guarda la marca de inicio y no permite dos a la vez', () => {
  const s = defaultState();
  startFast(s, { goalHours: 18, protocol: '18:6' }, 1000);
  assert.deepEqual(s.fasting.current, { start: 1000, goalHours: 18, protocol: '18:6', notified: false });
  assert.deepEqual(s.fasting.lastGoal, { goalHours: 18, protocol: '18:6' });
  assert.throws(() => startFast(s, { goalHours: 16 }, 2000));
  assert.throws(() => startFast(defaultState(), { goalHours: 0 }, 2000));
});

test('endFast registra en historial con cumplimiento', () => {
  const s = defaultState();
  startFast(s, { goalHours: 16, protocol: '16:8' }, 0);
  const r1 = endFast(s, 15 * H, 'a');
  assert.deepEqual(r1, { id: 'a', start: 0, end: 15 * H, durationMs: 15 * H, goalHours: 16, protocol: '16:8', completed: false });
  assert.equal(s.fasting.current, null);

  startFast(s, { goalHours: 16, protocol: '16:8' }, 20 * H);
  const r2 = endFast(s, 36 * H, 'b');
  assert.equal(r2.completed, true);
  assert.deepEqual(s.fasting.history.map((r) => r.id), ['b', 'a']);
  assert.equal(endFast(s, 40 * H, 'c'), null);
});

test('isProlongedRecord por meta o por duración real', () => {
  assert.equal(isProlongedRecord({ goalHours: 36, durationMs: 2 * H }), true);
  assert.equal(isProlongedRecord({ goalHours: 16, durationMs: 25 * H }), true);
  assert.equal(isProlongedRecord({ goalHours: 24, durationMs: 24 * H }), false);
});

test('fastingStats sale solo del historial', () => {
  const now = at(2026, 3, 12, 10); // jueves
  const rec = (startMs, hours, goal) => ({
    id: String(startMs), start: startMs, end: startMs + hours * H, durationMs: hours * H,
    goalHours: goal, protocol: null, completed: hours >= goal,
  });
  const history = [
    rec(at(2026, 3, 11, 20), 13, 12), // termina jue 12 09:00, cumplido
    rec(at(2026, 3, 10, 20), 16, 16), // termina mié 11, cumplido
    rec(at(2026, 3, 9, 20), 10, 16), //  termina mar 10, NO cumplido (corta la racha)
    rec(at(2026, 3, 8, 18), 16, 16), //  termina lun 9, cumplido
    rec(at(2026, 3, 4, 8), 36, 36), //   termina jue 5 de la semana anterior
  ];
  const s = fastingStats(history, now);
  assert.equal(s.total, 5);
  assert.equal(s.completed, 4);
  assert.equal(s.totalHours, 91);
  assert.equal(s.longestMs, 36 * H);
  assert.equal(s.streakDays, 2);
  assert.equal(s.thisWeek, 3);
  assert.deepEqual(fastingStats([], now), { total: 0, completed: 0, totalHours: 0, longestMs: 0, streakDays: 0, thisWeek: 0 });
});

test('la racha cuenta desde ayer si hoy aún no hay ayuno', () => {
  const now = at(2026, 3, 12, 8);
  const r = { id: 'x', start: at(2026, 3, 10, 20), end: at(2026, 3, 11, 12), durationMs: 16 * H, goalHours: 16, completed: true };
  assert.equal(fastingStats([r], now).streakDays, 1);
  assert.equal(fastingStats([r], at(2026, 3, 13, 8)).streakDays, 0);
});

test('migración: datos sin ayuno conservan entradas, pesos y perfil', () => {
  const old = {
    profile: { age: 41, sex: 'male' },
    entries: [{ id: '1', date: '2026-01-01', meal: 'lunch', name: 'Pan', grams: 50, per100: { kcal: 250 } }],
    weights: [{ date: '2026-01-01', kg: 80 }],
    water: { '2026-01-01': 500 },
  };
  const s = mergeState(old);
  assert.equal(s.profile.age, 41);
  assert.equal(s.entries.length, 1);
  assert.deepEqual(s.weights, old.weights);
  assert.deepEqual(s.water, old.water);
  assert.deepEqual(s.fasting, defaultState().fasting);
});

test('migración: el ayuno en curso sobrevive y se descartan datos rotos', () => {
  const s = mergeState({
    fasting: {
      current: { start: 1000, goalHours: 16, protocol: '16:8' },
      history: [
        { id: 'ok', start: 0, end: 17 * H, goalHours: 16, completed: false },
        { id: 'roto', start: 'ayer', end: 5 },
        { id: 'al-reves', start: 10, end: 5, goalHours: 16 },
      ],
      lastGoal: { goalHours: 999 },
    },
  });
  assert.deepEqual(s.fasting.current, { start: 1000, goalHours: 16, protocol: '16:8', notified: false });
  assert.equal(s.fasting.history.length, 1);
  assert.equal(s.fasting.history[0].completed, true); // se recalcula desde los tiempos
  assert.equal(s.fasting.history[0].durationMs, 17 * H);
  assert.deepEqual(s.fasting.lastGoal, { goalHours: 16, protocol: '16:8' });
  assert.equal(sanitizeFasting({ current: { start: 5, goalHours: 0 } }).current, null);
});

test('goalAlert: avisa una sola vez al cumplir la meta', () => {
  const fast = { start: 0, goalHours: 16, notified: false };
  assert.equal(goalAlert(fast, 15 * H, { enabled: true }), null); // aún no
  assert.equal(goalAlert(fast, 16 * H, { enabled: true }), 'notify'); // justo en la meta
  assert.equal(goalAlert(fast, 16 * H + LATE_ALERT_MS, { enabled: true }), 'notify');
  assert.equal(goalAlert(fast, 16 * H, { enabled: false }), 'silent'); // sin permiso: solo pantalla
  assert.equal(goalAlert({ ...fast, notified: true }, 17 * H, { enabled: true }), null); // ya avisado
  assert.equal(goalAlert(null, 17 * H, { enabled: true }), null);
});

test('goalAlert: si la app estuvo cerrada al cumplirse, al volver avisa solo en pantalla', () => {
  const fast = { start: 0, goalHours: 16, notified: false };
  assert.equal(goalAlert(fast, 16 * H + LATE_ALERT_MS + 1, { enabled: true }), 'silent');
});

test('la marca de aviso enviado sobrevive a la recarga', () => {
  const f = sanitizeFasting({ current: { start: 0, goalHours: 16, protocol: '16:8', notified: true } });
  assert.equal(f.current.notified, true);
  assert.equal(sanitizeFasting({ current: { start: 0, goalHours: 16 } }).current.notified, false);
});
