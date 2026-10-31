import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { searchFoods, getByBarcode, searchUrl, errorMessage, OffError } from '../js/off.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});

// Producto con la forma que devuelve la API real.
const nutella = {
  code: '3017620422003',
  product_name: 'Nutella',
  product_name_es: 'Nutella',
  brands: 'Nutella,Ferrero',
  serving_quantity: 15,
  nutriments: { 'energy-kcal_100g': 539, proteins_100g: 6.3, carbohydrates_100g: 57.5, fat_100g: 30.9 },
};

test('searchUrl usa el endpoint de búsqueda con JSON y campos limitados', () => {
  const url = searchUrl('pan integral');
  assert.equal(url.origin + url.pathname, 'https://world.openfoodfacts.org/cgi/search.pl');
  assert.equal(url.searchParams.get('search_terms'), 'pan integral');
  assert.equal(url.searchParams.get('json'), '1');
  assert.match(url.searchParams.get('fields'), /nutriments/);
});

test('searchFoods normaliza, descarta incompletos y quita duplicados', async () => {
  globalThis.fetch = async () => json({
    count: 3, page: 1,
    products: [nutella, { code: '1', product_name: 'Sin datos', nutriments: {} }, nutella],
  });
  const foods = await searchFoods('nutella');
  assert.equal(foods.length, 1);
  assert.deepEqual(foods[0].per100, { kcal: 539, protein: 6.3, carbs: 57.5, fat: 30.9 });
  assert.equal(foods[0].brand, 'Nutella');
  assert.equal(foods[0].serving, 15);
});

test('searchFoods sin resultados devuelve lista vacía', async () => {
  globalThis.fetch = async () => json({ count: 0, products: [] });
  assert.deepEqual(await searchFoods('xyzxyz'), []);
});

test('errores clasificados: límite, servidor, red y JSON inválido', async () => {
  globalThis.fetch = async () => json({}, 429);
  await assert.rejects(searchFoods('a'), (e) => e instanceof OffError && e.kind === 'rate_limit');
  globalThis.fetch = async () => json({}, 503);
  await assert.rejects(searchFoods('a'), (e) => e.kind === 'server');
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(searchFoods('a'), (e) => e.kind === 'offline');
  globalThis.fetch = async () => new Response('<html>', { status: 200 });
  await assert.rejects(searchFoods('a'), (e) => e.kind === 'bad_response');
});

test('una búsqueda cancelada no se convierte en error de red', async () => {
  const ctrl = new AbortController();
  globalThis.fetch = (_url, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  });
  const p = searchFoods('a', { signal: ctrl.signal });
  ctrl.abort();
  await assert.rejects(p, (e) => e.name === 'AbortError');
});

test('getByBarcode: encontrado, no encontrado (404) y código vacío', async () => {
  let called = '';
  globalThis.fetch = async (url) => { called = String(url); return json({ status: 1, product: nutella }); };
  assert.equal((await getByBarcode('3017 6204 22003')).name, 'Nutella');
  assert.match(called, /\/api\/v2\/product\/3017620422003\.json/);

  globalThis.fetch = async () => json({ status: 0, status_verbose: 'product not found' }, 404);
  assert.equal(await getByBarcode('0000000000000'), null);
  assert.equal(await getByBarcode('abc'), null);
});

test('errorMessage da un texto para cada tipo', () => {
  for (const kind of ['offline', 'timeout', 'rate_limit', 'server', 'bad_response']) {
    assert.ok(errorMessage(new OffError(kind, '')).length > 10);
  }
});
