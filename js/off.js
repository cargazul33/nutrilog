// Cliente de Open Food Facts (base de datos abierta, licencia ODbL).
// https://openfoodfacts.github.io/openfoodfacts-server/api/

const BASE = 'https://world.openfoodfacts.org';
const FIELDS = 'code,product_name,product_name_es,generic_name,brands,nutriments,serving_quantity';
const TIMEOUT_MS = 15000;

// Error con un tipo para que la interfaz muestre un mensaje adecuado.
export class OffError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'OffError';
    this.kind = kind; // 'offline' | 'timeout' | 'rate_limit' | 'server' | 'bad_response'
  }
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Convierte un producto de OFF al formato interno, o null si no tiene datos útiles.
export function normalizeProduct(p) {
  if (!p) return null;
  const n = p.nutriments || {};
  let kcal = num(n['energy-kcal_100g']);
  if (!kcal && n.energy_100g) kcal = num(n.energy_100g) / 4.184;
  const name = (p.product_name_es || p.product_name || p.generic_name || '').trim();
  if (!name || !kcal) return null;
  return {
    code: p.code || null,
    name,
    brand: (p.brands || '').split(',')[0].trim(),
    per100: {
      kcal: Math.round(kcal),
      protein: num(n.proteins_100g),
      carbs: num(n.carbohydrates_100g),
      fat: num(n.fat_100g),
    },
    serving: num(p.serving_quantity) || 100,
  };
}

// fetch con tiempo límite y errores clasificados.
async function request(url, signal) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new OffError('offline', 'Sin conexión');
  }
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    return await fetch(url, { signal: combined, headers: { Accept: 'application/json' } });
  } catch (err) {
    if (signal?.aborted) throw err; // cancelada por una búsqueda nueva
    if (timeout.aborted) throw new OffError('timeout', 'Open Food Facts tardó demasiado');
    throw new OffError('offline', 'No se pudo conectar con Open Food Facts');
  }
}

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    throw new OffError('bad_response', 'Respuesta no válida de Open Food Facts');
  }
}

function checkStatus(res) {
  if (res.status === 429) throw new OffError('rate_limit', 'Demasiadas búsquedas seguidas');
  if (!res.ok) throw new OffError('server', `Open Food Facts respondió ${res.status}`);
}

export function searchUrl(query) {
  const url = new URL(`${BASE}/cgi/search.pl`);
  url.search = new URLSearchParams({
    search_terms: query,
    search_simple: '1',
    action: 'process',
    json: '1',
    page_size: '25',
    lc: 'es',
    fields: FIELDS,
  });
  return url;
}

export async function searchFoods(query, { signal } = {}) {
  const res = await request(searchUrl(query), signal);
  checkStatus(res);
  const data = await readJson(res);
  const seen = new Set();
  return (Array.isArray(data.products) ? data.products : [])
    .map(normalizeProduct)
    .filter((f) => {
      if (!f) return false;
      const key = f.code || `${f.name}|${f.brand}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export async function getByBarcode(code, { signal } = {}) {
  const clean = String(code).replace(/\D/g, '');
  if (!clean) return null;
  const res = await request(`${BASE}/api/v2/product/${clean}.json?fields=${FIELDS}`, signal);
  if (res.status === 404) return null; // la API v2 responde 404 si el producto no existe
  checkStatus(res);
  const data = await readJson(res);
  return data.status === 1 ? normalizeProduct(data.product) : null;
}

export function errorMessage(err) {
  switch (err?.kind) {
    case 'offline': return 'Sin conexión. Puedes usar los recientes o la entrada manual.';
    case 'timeout': return 'Open Food Facts no respondió a tiempo. Inténtalo de nuevo.';
    case 'rate_limit': return 'Demasiadas búsquedas seguidas. Espera un minuto e inténtalo otra vez.';
    case 'server': return 'Open Food Facts no está disponible ahora. Inténtalo más tarde.';
    default: return 'No se pudo completar la búsqueda. Inténtalo de nuevo.';
  }
}
