// Lógica pura de ayunos: protocolos, progreso, historial y estadísticas.
// Los tiempos se guardan como marcas en milisegundos (Date.now()).

import { toISODate, addDays } from './calc.js';

const HOUR = 3600 * 1000;

export const PROTOCOLS = [
  { id: '12', label: '12 h', hours: 12, group: 'intermittent' },
  { id: '14:10', label: '14:10', hours: 14, group: 'intermittent' },
  { id: '16:8', label: '16:8', hours: 16, group: 'intermittent' },
  { id: '18:6', label: '18:6', hours: 18, group: 'intermittent' },
  { id: '20:4', label: '20:4', hours: 20, group: 'intermittent' },
  { id: 'omad', label: 'OMAD 23:1', hours: 23, group: 'intermittent' },
  { id: '24h', label: '24 h', hours: 24, group: 'extended' },
  { id: '36h', label: '36 h', hours: 36, group: 'extended' },
  { id: '48h', label: '48 h', hours: 48, group: 'extended' },
  { id: '72h', label: '72 h', hours: 72, group: 'extended' },
];

export const MIN_GOAL_HOURS = 1;
export const MAX_GOAL_HOURS = 168;

// Más de 24 h: se muestra la nota de cuidado.
export const isExtended = (hours) => hours > 24;

export function protocolLabel(protocolId, goalHours) {
  return PROTOCOLS.find((p) => p.id === protocolId)?.label ?? `${goalHours} h`;
}

export function validGoal(hours) {
  return Number.isFinite(hours) && hours >= MIN_GOAL_HOURS && hours <= MAX_GOAL_HOURS;
}

export function fastProgress(fast, now) {
  const goalMs = fast.goalHours * HOUR;
  const elapsedMs = Math.max(0, now - fast.start);
  return {
    elapsedMs,
    goalMs,
    ratio: goalMs > 0 ? Math.min(1, elapsedMs / goalMs) : 0,
    reached: elapsedMs >= goalMs,
    remainingMs: Math.max(0, goalMs - elapsedMs),
    endsAt: fast.start + goalMs,
  };
}

// hh:mm:ss; las horas pueden pasar de 24 (p. ej. 36:00:00).
export function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

export function formatHours(ms) {
  const h = ms / HOUR;
  return h >= 10 ? `${Math.round(h)} h` : `${Math.round(h * 10) / 10} h`;
}

export function startFast(state, { goalHours, protocol = null }, now) {
  if (state.fasting.current) throw new Error('Ya hay un ayuno en curso');
  if (!validGoal(goalHours)) throw new Error('Meta de horas no válida');
  state.fasting.current = { start: now, goalHours, protocol, notified: false };
  state.fasting.lastGoal = { goalHours, protocol };
  return state.fasting.current;
}

// Cierra el ayuno en curso y lo guarda en el historial (más reciente primero).
export function endFast(state, now, id) {
  const fast = state.fasting.current;
  if (!fast) return null;
  const end = Math.max(now, fast.start);
  const record = {
    id,
    start: fast.start,
    end,
    durationMs: end - fast.start,
    goalHours: fast.goalHours,
    protocol: fast.protocol,
    completed: end - fast.start >= fast.goalHours * HOUR,
  };
  state.fasting.history = [record, ...state.fasting.history].sort((a, b) => b.end - a.end);
  state.fasting.current = null;
  return record;
}

// Más allá de este retraso la meta se cumplió con la app cerrada: al volver
// se avisa en pantalla, sin notificación del sistema que llegaría tarde.
export const LATE_ALERT_MS = 5 * 60 * 1000;

// Qué hacer cuando el temporizador ve la meta cumplida:
// 'notify' (notificación + vibración), 'silent' (solo en pantalla) o null (nada).
export function goalAlert(fast, now, { enabled }) {
  if (!fast || fast.notified) return null;
  const p = fastProgress(fast, now);
  if (!p.reached) return null;
  return enabled && now - p.endsAt <= LATE_ALERT_MS ? 'notify' : 'silent';
}

export const isProlongedRecord = (r) => isExtended(r.goalHours) || r.durationMs > 24 * HOUR;

// Lunes de la semana de una fecha ISO local.
function weekStart(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dow = (new Date(y, m - 1, d).getDay() + 6) % 7; // 0 = lunes
  return addDays(iso, -dow);
}

// Estadísticas calculadas solo a partir del historial guardado.
export function fastingStats(history, now) {
  const done = history.filter((r) => r.completed);
  const totalMs = history.reduce((sum, r) => sum + r.durationMs, 0);
  const longestMs = history.reduce((max, r) => Math.max(max, r.durationMs), 0);

  // Racha: días seguidos (hasta hoy o ayer) que terminan con al menos un ayuno cumplido.
  const days = new Set(done.map((r) => toISODate(new Date(r.end))));
  const today = toISODate(new Date(now));
  let cursor = days.has(today) ? today : addDays(today, -1);
  let streakDays = 0;
  while (days.has(cursor)) {
    streakDays += 1;
    cursor = addDays(cursor, -1);
  }

  const monday = weekStart(today);
  const thisWeek = done.filter((r) => toISODate(new Date(r.end)) >= monday).length;

  return {
    total: history.length,
    completed: done.length,
    totalHours: Math.round((totalMs / HOUR) * 10) / 10,
    longestMs,
    streakDays,
    thisWeek,
  };
}

// Valida el bloque de ayuno al cargar o importar datos.
export function sanitizeFasting(data) {
  const okNum = (n) => typeof n === 'number' && Number.isFinite(n);
  const base = { current: null, history: [], lastGoal: { goalHours: 16, protocol: '16:8' } };
  if (!data || typeof data !== 'object') return base;
  const c = data.current;
  const current = c && okNum(c.start) && validGoal(c.goalHours)
    ? { start: c.start, goalHours: c.goalHours, protocol: c.protocol ?? null, notified: c.notified === true }
    : null;
  const history = Array.isArray(data.history)
    ? data.history.filter((r) => r && okNum(r.start) && okNum(r.end) && r.end >= r.start && okNum(r.goalHours))
      .map((r) => ({
        id: String(r.id ?? r.start),
        start: r.start,
        end: r.end,
        durationMs: r.end - r.start,
        goalHours: r.goalHours,
        protocol: r.protocol ?? null,
        completed: r.end - r.start >= r.goalHours * HOUR,
      }))
      .sort((a, b) => b.end - a.end)
    : [];
  const lg = data.lastGoal;
  const lastGoal = lg && validGoal(lg.goalHours) ? { goalHours: lg.goalHours, protocol: lg.protocol ?? null } : base.lastGoal;
  return { current, history, lastGoal };
}
