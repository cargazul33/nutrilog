import {
  MEALS, ACTIVITY, GOALS, dailyCalories, macroTargets, scaleNutrients, sumNutrients,
  toISODate, addDays, bmi,
} from './calc.js';
import { loadState, saveState, mergeState, newId, rememberFood, setWeight } from './store.js';
import { searchFoods, getByBarcode, errorMessage } from './off.js';
import {
  PROTOCOLS, MIN_GOAL_HOURS, MAX_GOAL_HOURS, isExtended, validGoal, protocolLabel, fastProgress,
  formatDuration, startFast, endFast, isProlongedRecord, fastingStats,
} from './fasting.js';

const $ = (sel) => document.querySelector(sel);
const state = loadState();
let currentDate = toISODate(new Date());

// Crea elementos sin usar innerHTML (los datos de alimentos vienen de fuera).
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  node.append(...children.flat().filter((c) => c != null && c !== false));
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text != null) node.textContent = text;
  return node;
}

function persist() {
  if (!saveState(state)) toast('No se pudo guardar en este dispositivo');
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

function goalKcal() {
  return state.profile.customKcal || dailyCalories(state.profile);
}

function formatDate(iso) {
  const today = toISODate(new Date());
  if (iso === today) return 'Hoy';
  if (iso === addDays(today, -1)) return 'Ayer';
  if (iso === addDays(today, 1)) return 'Mañana';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'short' });
}

const entriesFor = (date) => state.entries.filter((e) => e.date === date);

/* ---------- Diario ---------- */

function renderDiary() {
  $('#date-label').textContent = formatDate(currentDate);
  const entries = entriesFor(currentDate);
  const total = sumNutrients(entries);
  const goal = goalKcal();
  const left = goal - total.kcal;

  $('#kcal-goal').textContent = goal;
  $('#kcal-eaten').textContent = total.kcal;
  $('#kcal-left').textContent = Math.abs(left);
  $('#kcal-left-label').textContent = left >= 0 ? 'restantes' : 'de más';

  const ring = $('#ring-fg');
  const circ = 2 * Math.PI * 52;
  ring.style.strokeDasharray = circ;
  ring.style.strokeDashoffset = circ * (1 - Math.min(total.kcal / goal, 1));
  ring.classList.toggle('over', left < 0);

  const targets = macroTargets(goal);
  const macroDefs = [
    ['protein', 'Proteínas', 'var(--protein)'],
    ['carbs', 'Carbohidratos', 'var(--carbs)'],
    ['fat', 'Grasas', 'var(--fat)'],
  ];
  $('#macros').replaceChildren(...macroDefs.map(([key, label, color]) => {
    const pct = Math.min(100, (total[key] / targets[key]) * 100 || 0);
    return el('div', { class: 'macro' },
      el('small', {}, label),
      el('span', {}, `${Math.round(total[key])} / ${targets[key]} g`),
      el('div', { class: 'bar' }, el('span', { style: `width:${pct}%;background:${color}` })));
  }));

  $('#meals').replaceChildren(...MEALS.map((meal) => {
    const items = entries.filter((e) => e.meal === meal.id);
    const mealKcal = sumNutrients(items).kcal;
    return el('div', { class: 'card' },
      el('div', { class: 'meal-head' }, el('h2', {}, meal.name), el('span', {}, `${mealKcal} kcal`)),
      items.length > 0 && el('ul', { class: 'entries' }, items.map((e) => {
        const n = scaleNutrients(e.per100, e.grams);
        return el('li', { onclick: () => openAmount({ entry: e }) },
          el('div', { class: 'name' }, e.name,
            el('small', {}, [e.brand, `${e.grams} g`].filter(Boolean).join(' · '))),
          el('span', { class: 'kcal' }, `${n.kcal} kcal`));
      })),
      el('button', { class: 'add-link', onclick: () => openAdd(meal.id) }, '+ Añadir alimento'));
  }));

  $('#water-ml').textContent = state.water[currentDate] || 0;
}

/* ---------- Añadir alimento ---------- */

let addMeal = 'breakfast';
let searchAbort;

function foodItem(food, onPick) {
  return el('li', { onclick: () => onPick(food) },
    el('div', {}, food.name, el('small', {}, food.brand || '')),
    el('span', { class: 'kcal' }, `${food.per100.kcal} kcal/100 g`));
}

function showRecent() {
  const list = $('#food-results');
  $('#search-status').textContent = '';
  if (!state.recentFoods.length) {
    list.replaceChildren();
    $('#search-status').textContent = 'Busca un alimento, escanea un código o añádelo a mano.';
    return;
  }
  list.replaceChildren(el('h3', {}, 'Recientes'),
    ...state.recentFoods.map((f) => foodItem(f, pickFood)));
}

function openAdd(mealId) {
  addMeal = mealId;
  $('#add-title').textContent = `Añadir a ${MEALS.find((m) => m.id === mealId).name}`;
  $('#search-input').value = '';
  showRecent();
  $('#add-dialog').showModal();
}

function pickFood(food) {
  $('#add-dialog').close();
  openAmount({ food });
}

async function runSearch(query) {
  const q = query.trim();
  if (!q) return showRecent();
  searchAbort?.abort();
  searchAbort = new AbortController();

  const local = state.recentFoods.filter((f) =>
    `${f.name} ${f.brand || ''}`.toLowerCase().includes(q.toLowerCase()));
  const list = $('#food-results');
  list.replaceChildren(...(local.length ? [el('h3', {}, 'Recientes'), ...local.map((f) => foodItem(f, pickFood))] : []));
  $('#search-status').textContent = 'Buscando…';

  try {
    const results = await searchFoods(q, { signal: searchAbort.signal });
    $('#search-status').textContent = results.length
      ? ''
      : `No hay resultados para «${q}». Prueba otro nombre o la entrada manual.`;
    if (results.length) list.append(el('h3', {}, 'Open Food Facts'), ...results.map((f) => foodItem(f, pickFood)));
  } catch (err) {
    if (err.name === 'AbortError') return;
    $('#search-status').textContent = errorMessage(err);
  }
}

/* ---------- Cantidad / edición ---------- */

let amountCtx = null; // { food, entry, manual }

function openAmount({ food, entry, manual = false }) {
  amountCtx = { food: food || entry, entry, manual };
  const form = $('#amount-form');
  form.reset();
  $('#manual-fields').hidden = !manual;
  for (const name of ['name', 'kcal']) form.elements[name].required = manual;
  $('#amount-title').textContent = manual ? 'Entrada manual' : amountCtx.food.name;
  form.elements.grams.value = entry ? entry.grams : (food?.serving || 100);
  form.elements.meal.value = entry ? entry.meal : addMeal;
  $('#delete-entry').hidden = !entry;
  $('#amount-submit').textContent = entry ? 'Guardar' : 'Añadir';
  updateAmountPreview();
  $('#amount-dialog').showModal();
}

function readPer100(form) {
  if (!amountCtx.manual) return amountCtx.food.per100;
  const v = (k) => Number(form.elements[k].value) || 0;
  return { kcal: v('kcal'), protein: v('protein'), carbs: v('carbs'), fat: v('fat') };
}

function updateAmountPreview() {
  const form = $('#amount-form');
  const grams = Number(form.elements.grams.value) || 0;
  const n = scaleNutrients(readPer100(form), grams);
  $('#amount-preview').textContent =
    `${n.kcal} kcal · P ${n.protein} g · C ${n.carbs} g · G ${n.fat} g`;
}

function submitAmount(e) {
  e.preventDefault();
  const form = e.target;
  if (!form.reportValidity()) return;
  const grams = Number(form.elements.grams.value);
  const meal = form.elements.meal.value;
  const per100 = readPer100(form);

  if (amountCtx.entry) {
    Object.assign(amountCtx.entry, { grams, meal });
    toast('Guardado');
  } else {
    const food = amountCtx.manual
      ? { name: form.elements.name.value.trim(), brand: '', per100, serving: grams }
      : amountCtx.food;
    state.entries.push({
      id: newId(), date: currentDate, meal, grams,
      name: food.name, brand: food.brand || '', per100: food.per100,
    });
    rememberFood(state, food);
    toast(`${food.name} añadido`);
  }
  persist();
  $('#amount-dialog').close();
  renderDiary();
}

function deleteEntry() {
  state.entries = state.entries.filter((x) => x.id !== amountCtx.entry.id);
  persist();
  $('#amount-dialog').close();
  renderDiary();
  toast('Eliminado');
}

/* ---------- Escáner ---------- */

let scanStream = null;
let scanLoop = null;

async function openScanner() {
  $('#add-dialog').close();
  $('#barcode-input').value = '';
  $('#scan-status').textContent = '';
  const video = $('#scan-video');
  $('#scan-dialog').showModal();

  if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) {
    video.hidden = true;
    $('#scan-status').textContent = 'Tu navegador no puede leer códigos con la cámara. Escribe el número.';
    return;
  }
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.hidden = false;
    video.srcObject = scanStream;
    await video.play();
    const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
    $('#scan-status').textContent = 'Apunta al código de barras.';
    scanLoop = setInterval(async () => {
      try {
        const [code] = await detector.detect(video);
        if (code) lookupBarcode(code.rawValue);
      } catch { /* fotograma no disponible */ }
    }, 300);
  } catch {
    video.hidden = true;
    $('#scan-status').textContent = 'No hay acceso a la cámara. Escribe el número del código.';
  }
}

function stopScanner() {
  clearInterval(scanLoop);
  scanLoop = null;
  scanStream?.getTracks().forEach((t) => t.stop());
  scanStream = null;
}

async function lookupBarcode(code) {
  stopScanner();
  $('#scan-status').textContent = `Buscando ${code}…`;
  try {
    const food = await getByBarcode(code);
    if (!food) {
      $('#scan-status').textContent = 'Producto no encontrado. Puedes añadirlo a mano.';
      return;
    }
    $('#scan-dialog').close();
    openAmount({ food });
  } catch (err) {
    $('#scan-status').textContent = errorMessage(err);
  }
}

/* ---------- Progreso ---------- */

function renderWeightChart() {
  const box = $('#weight-chart');
  const data = state.weights.slice(-30);
  if (data.length < 2) {
    box.replaceChildren(el('p', { class: 'muted' }, 'Registra tu peso al menos dos días para ver la gráfica.'));
  } else {
    const W = 320, H = 140, P = 24;
    const kgs = data.map((d) => d.kg);
    const min = Math.min(...kgs) - 1, max = Math.max(...kgs) + 1;
    const x = (i) => P + (i * (W - 2 * P)) / (data.length - 1);
    const y = (kg) => H - P - ((kg - min) * (H - 2 * P)) / (max - min);
    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Evolución del peso' });
    root.append(svg('polyline', { class: 'line', points: data.map((d, i) => `${x(i)},${y(d.kg)}`).join(' ') }));
    data.forEach((d, i) => root.append(svg('circle', { class: 'dot', cx: x(i), cy: y(d.kg), r: 3 })));
    root.append(
      svg('text', { x: 0, y: y(max - 1) + 3 }, (max - 1).toFixed(1)),
      svg('text', { x: 0, y: y(min + 1) + 3 }, (min + 1).toFixed(1)),
      svg('text', { x: P, y: H - 4 }, data[0].date.slice(5)),
      svg('text', { x: W - P, y: H - 4, 'text-anchor': 'end' }, data.at(-1).date.slice(5)));
    box.replaceChildren(root);
  }
  const last = state.weights.at(-1);
  $('#weight-summary').textContent = last
    ? `Último: ${last.kg} kg · IMC ${bmi(last.kg, state.profile.heightCm)}`
    : '';
}

function renderKcalChart() {
  const today = toISODate(new Date());
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const values = days.map((d) => sumNutrients(entriesFor(d)).kcal);
  const goal = goalKcal();
  const W = 320, H = 150, P = 20;
  const max = Math.max(goal * 1.2, ...values);
  const bw = (W - 2 * P) / 7;
  const y = (v) => H - P - (v * (H - 2 * P)) / max;
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Calorías por día' });
  days.forEach((d, i) => {
    const v = values[i];
    root.append(
      svg('rect', { class: `barfill${v > goal ? ' over' : ''}`, x: P + i * bw + 4, y: y(v), width: bw - 8, height: H - P - y(v), rx: 3 }),
      svg('text', { x: P + i * bw + bw / 2, y: H - 6, 'text-anchor': 'middle' },
        new Date(`${d}T12:00`).toLocaleDateString('es', { weekday: 'narrow' })));
  });
  root.append(svg('line', { class: 'goal', x1: P, x2: W - P, y1: y(goal), y2: y(goal) }));
  $('#kcal-chart').replaceChildren(root);
}

function renderFastStats() {
  const box = $('#fast-stats');
  const s = fastingStats(state.fasting.history, Date.now());
  if (!s.total) {
    box.replaceChildren(el('p', { class: 'muted' }, 'Cuando termines tu primer ayuno verás aquí el resumen.'));
    return;
  }
  const items = [
    [s.completed, `cumplidos de ${s.total}`],
    [`${s.totalHours} h`, 'en ayuno en total'],
    [formatHM(s.longestMs), 'ayuno más largo'],
    [s.thisWeek, 'cumplidos esta semana'],
    [s.streakDays, s.streakDays === 1 ? 'día de racha' : 'días de racha'],
  ];
  box.replaceChildren(el('div', { class: 'stats-grid' },
    items.map(([value, label]) => el('div', { class: 'stat' }, el('strong', {}, String(value)), el('span', {}, label)))));
}

function renderProgress() {
  renderWeightChart();
  renderKcalChart();
  renderFastStats();
}

/* ---------- Ayuno ---------- */

let fastChoice = { ...state.fasting.lastGoal }; // { goalHours, protocol }
let lastEnded = null; // ayuno recién terminado, para el mensaje posterior

const formatHM = (ms) => `${formatDuration(ms).slice(0, -3)} h`;

function formatMoment(ms) {
  const d = new Date(ms);
  const day = toISODate(d);
  const today = toISODate(new Date());
  const hm = d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  if (day === today) return `hoy ${hm}`;
  if (day === addDays(today, 1)) return `mañana ${hm}`;
  if (day === addDays(today, -1)) return `ayer ${hm}`;
  return `${d.toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' })} ${hm}`;
}

function setFastRing(ratio, done) {
  const ring = $('#fast-ring');
  const circ = 2 * Math.PI * 52;
  ring.style.strokeDasharray = circ;
  ring.style.strokeDashoffset = circ * (1 - ratio);
  ring.classList.toggle('done', done);
}

function renderFastSetup() {
  for (const group of ['intermittent', 'extended']) {
    $(`#chips-${group}`).replaceChildren(...PROTOCOLS.filter((p) => p.group === group).map((p) =>
      el('button', {
        type: 'button',
        class: 'chip',
        'aria-pressed': String(fastChoice.protocol === p.id),
        onclick: () => {
          fastChoice = { goalHours: p.hours, protocol: p.id };
          $('#custom-hours').value = '';
          renderFastSetup();
        },
      }, p.label)));
  }
  const input = $('#custom-hours');
  if (!fastChoice.protocol && document.activeElement !== input && validGoal(fastChoice.goalHours)) {
    input.value = fastChoice.goalHours;
  }
  const ok = validGoal(fastChoice.goalHours);
  $('#care-note').hidden = !(ok && isExtended(fastChoice.goalHours));
  $('#fast-start-btn').disabled = !ok;
  $('#fast-start-btn').textContent = ok
    ? `Empezar ayuno de ${fastChoice.goalHours} h`
    : `Elige una duración entre ${MIN_GOAL_HOURS} y ${MAX_GOAL_HOURS} h`;
}

// Actualiza solo lo que cambia cada segundo.
function tickFast() {
  const fast = state.fasting.current;
  $('#fast-banner').hidden = !fast;
  if (!fast) return;
  const p = fastProgress(fast, Date.now());
  const time = formatDuration(p.elapsedMs);
  $('#fast-banner-time').textContent = time;
  $('#fast-elapsed').textContent = time;
  setFastRing(p.ratio, p.reached);
  const status = $('#fast-status');
  status.textContent = p.reached
    ? 'Meta cumplida. Termina el ayuno cuando quieras.'
    : `Faltan ${formatDuration(p.remainingMs)}`;
  status.classList.toggle('done', p.reached);
}

function renderLastFast() {
  const box = $('#fast-last');
  box.hidden = !lastEnded || Boolean(state.fasting.current);
  if (box.hidden) return;
  box.replaceChildren(el('div', {},
    el('h2', {}, lastEnded.completed ? 'Ayuno cumplido' : 'Ayuno terminado'),
    el('p', {}, `Ayunaste ${formatHM(lastEnded.durationMs)} con una meta de ${lastEnded.goalHours} h.`),
    isProlongedRecord(lastEnded) &&
      el('p', { class: 'care-note' }, 'Para romper un ayuno largo, mejor empezar con una comida liviana.')));
}

function renderFastHistory() {
  const list = state.fasting.history;
  $('#fast-history-empty').hidden = list.length > 0;
  $('#fast-history').replaceChildren(...list.slice(0, 50).map((r) => el('li', {},
    el('div', { class: 'name' }, `${formatMoment(r.start)} → ${formatMoment(r.end)}`,
      el('small', {}, `${protocolLabel(r.protocol, r.goalHours)} · meta ${r.goalHours} h`)),
    el('span', { class: 'kcal' }, formatHM(r.durationMs),
      el('small', { class: r.completed ? 'ok' : 'miss' }, r.completed ? '✓ Cumplido' : 'No cumplido')),
    el('button', { class: 'del', type: 'button', 'aria-label': 'Borrar del historial', onclick: () => deleteFast(r.id) }, '✕'))));
}

function renderFast() {
  const fast = state.fasting.current;
  $('#fast-setup').hidden = Boolean(fast);
  $('#fast-times').hidden = !fast;
  $('#fast-end-btn').hidden = !fast;
  if (fast) {
    const label = protocolLabel(fast.protocol, fast.goalHours);
    $('#fast-sub').textContent = fast.protocol ? `${label} · meta ${fast.goalHours} h` : `meta ${fast.goalHours} h`;
    $('#fast-start').textContent = formatMoment(fast.start);
    $('#fast-goal').textContent = `${fast.goalHours} h`;
    $('#fast-end').textContent = formatMoment(fastProgress(fast, fast.start).endsAt);
  } else {
    $('#fast-elapsed').textContent = '00:00:00';
    $('#fast-sub').textContent = 'Sin ayuno en curso';
    $('#fast-status').textContent = '';
    setFastRing(0, false);
    renderFastSetup();
  }
  renderLastFast();
  renderFastHistory();
  tickFast();
}

function beginFast() {
  try {
    startFast(state, fastChoice, Date.now());
  } catch (err) {
    toast(err.message);
    return;
  }
  lastEnded = null;
  persist();
  renderFast();
  toast('Ayuno iniciado');
}

function finishFast() {
  const fast = state.fasting.current;
  if (!fast) return;
  const reached = fastProgress(fast, Date.now()).reached;
  const question = reached
    ? '¿Terminar el ayuno ahora?'
    : `Todavía no llegas a la meta de ${fast.goalHours} h. ¿Terminar igual?`;
  if (!confirm(question)) return;
  lastEnded = endFast(state, Date.now(), newId());
  persist();
  renderFast();
  toast(lastEnded.completed ? 'Ayuno cumplido' : 'Ayuno terminado');
}

function deleteFast(id) {
  if (!confirm('¿Borrar este ayuno del historial?')) return;
  state.fasting.history = state.fasting.history.filter((r) => r.id !== id);
  if (lastEnded?.id === id) lastEnded = null;
  persist();
  renderFast();
}

/* ---------- Perfil ---------- */

function fillProfile() {
  const form = $('#profile-form');
  for (const [k, v] of Object.entries(state.profile)) {
    if (form.elements[k]) form.elements[k].value = v ?? '';
  }
  updateGoalPreview();
}

function readProfile() {
  const f = $('#profile-form').elements;
  return {
    sex: f.sex.value,
    age: Number(f.age.value),
    heightCm: Number(f.heightCm.value),
    weightKg: Number(f.weightKg.value),
    activity: f.activity.value,
    goal: f.goal.value,
    customKcal: Number(f.customKcal.value) || null,
  };
}

function updateGoalPreview() {
  const p = readProfile();
  if (!p.age || !p.heightCm || !p.weightKg) return;
  const kcal = p.customKcal || dailyCalories(p);
  const m = macroTargets(kcal);
  $('#goal-preview').textContent =
    `Objetivo: ${kcal} kcal/día · P ${m.protein} g · C ${m.carbs} g · G ${m.fat} g`;
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `nutrilog-${toISODate(new Date())}.json` });
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importData(file) {
  try {
    const data = mergeState(JSON.parse(await file.text()));
    Object.assign(state, data);
    persist();
    fastChoice = { ...state.fasting.lastGoal };
    lastEnded = null;
    fillProfile();
    renderDiary();
    renderFast();
    toast('Copia importada');
  } catch {
    toast('El archivo no es una copia válida');
  }
}

/* ---------- Navegación e inicio ---------- */

function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  if (name === 'diary') renderDiary();
  if (name === 'fast') renderFast();
  if (name === 'progress') renderProgress();
  if (name === 'profile') fillProfile();
}

function init() {
  const opts = (obj) => Object.entries(obj).map(([k, v]) => el('option', { value: k }, v.label || v.name));
  $('#activity-select').append(...opts(ACTIVITY));
  $('#goal-select').append(...opts(GOALS));
  $('#meal-select').append(...MEALS.map((m) => el('option', { value: m.id }, m.name)));

  document.querySelectorAll('.tabbar button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
  document.querySelectorAll('[data-day]').forEach((b) => b.addEventListener('click', () => {
    currentDate = addDays(currentDate, Number(b.dataset.day));
    renderDiary();
  }));
  $('#date-label').addEventListener('click', () => { currentDate = toISODate(new Date()); renderDiary(); });
  document.querySelectorAll('[data-water]').forEach((b) => b.addEventListener('click', () => {
    state.water[currentDate] = Math.max(0, (state.water[currentDate] || 0) + Number(b.dataset.water));
    persist();
    renderDiary();
  }));
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

  $('#search-form').addEventListener('submit', (e) => { e.preventDefault(); runSearch($('#search-input').value); });
  $('#manual-btn').addEventListener('click', () => { $('#add-dialog').close(); openAmount({ manual: true }); });
  $('#scan-btn').addEventListener('click', openScanner);
  $('#scan-dialog').addEventListener('close', stopScanner);
  $('#barcode-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = $('#barcode-input').value.trim();
    if (code) lookupBarcode(code);
  });

  $('#amount-form').addEventListener('input', updateAmountPreview);
  $('#amount-form').addEventListener('submit', submitAmount);
  $('#delete-entry').addEventListener('click', deleteEntry);

  $('#weight-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const kg = Number($('#weight-input').value);
    setWeight(state, toISODate(new Date()), kg);
    state.profile.weightKg = kg;
    persist();
    $('#weight-input').value = '';
    renderProgress();
    toast('Peso registrado');
  });

  $('#profile-form').addEventListener('input', updateGoalPreview);
  $('#profile-form').addEventListener('submit', (e) => {
    e.preventDefault();
    state.profile = readProfile();
    persist();
    updateGoalPreview();
    toast('Perfil guardado');
  });
  $('#export-btn').addEventListener('click', exportData);
  $('#import-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) importData(file);
    e.target.value = '';
  });

  // Instalación como app
  let installPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
    $('#install-btn').hidden = false;
  });
  $('#install-btn').addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    $('#install-btn').hidden = true;
  });

  // Ayuno
  $('#fast-start-btn').addEventListener('click', beginFast);
  $('#fast-end-btn').addEventListener('click', finishFast);
  $('#fast-banner').addEventListener('click', () => showView('fast'));
  $('#custom-hours').addEventListener('input', (e) => {
    fastChoice = { goalHours: e.target.value === '' ? NaN : Number(e.target.value), protocol: null };
    renderFastSetup();
  });
  // El tiempo se calcula desde la marca de inicio, así que el temporizador
  // muestra el tiempo real aunque la app haya estado cerrada.
  setInterval(tickFast, 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tickFast(); });
  renderFast();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  renderDiary();
}

init();
