// Cliente de Open Food Facts (base de datos abierta, licencia ODbL).
// https://openfoodfacts.github.io/openfoodfacts-server/api/

const BASE = 'https://world.openfoodfacts.org';
const FIELDS = 'code,product_name,product_name_es,brands,nutriments,serving_quantity';

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
  const name = (p.product_name_es || p.product_name || '').trim();
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

export async function searchFoods(query, { signal } = {}) {
  const url = new URL(`${BASE}/cgi/search.pl`);
  url.search = new URLSearchParams({
    search_terms: query,
    search_simple: '1',
    json: '1',
    page_size: '25',
    fields: FIELDS,
  });
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Error ${res.status} al buscar`);
  const data = await res.json();
  return (data.products || []).map(normalizeProduct).filter(Boolean);
}

export async function getByBarcode(code, { signal } = {}) {
  const clean = String(code).replace(/\D/g, '');
  if (!clean) return null;
  const res = await fetch(`${BASE}/api/v2/product/${clean}.json?fields=${FIELDS}`, { signal });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Error ${res.status} al buscar el código`);
  const data = await res.json();
  return data.status === 1 ? normalizeProduct(data.product) : null;
}
