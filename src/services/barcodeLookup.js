// Open Food Facts is a free public API — no key required.
// USDA FoodData Central requires a free key at https://fdc.nal.usda.gov/api-key-signup
// Set USDA_API_KEY in .env to enable USDA fallback.

const OFF_BASE = 'https://world.openfoodfacts.org/api/v2/product';
const USDA_BASE = 'https://api.nal.usda.gov/fdc/v1';
const OFF_USER_AGENT = process.env.OFF_USER_AGENT || 'HealthTrack/0.1.0 (personal use)';

async function searchOpenFoodFacts(barcode) {
  const url = `${OFF_BASE}/${barcode}?fields=product_name,brands,serving_size,nutriments`;

  let response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': OFF_USER_AGENT },
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    throw new Error(`Open Food Facts request failed: ${err.message}`);
  }

  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Open Food Facts returned ${response.status}`);

  const data = await response.json();
  if (data.status !== 1 || !data.product) return null;

  const p = data.product;
  const n = p.nutriments || {};

  // Nutriments from OFF are per 100g by default; serving-based values use _serving suffix
  const per100g = {
    calories: n['energy-kcal_100g'] ?? n['energy-kcal'] ?? null,
    protein_g: n['proteins_100g'] ?? null,
    carbs_g: n['carbohydrates_100g'] ?? null,
    fat_g: n['fat_100g'] ?? null,
    fiber_g: n['fiber_100g'] ?? null,
    sodium_mg: n['sodium_100g'] != null ? Math.round(n['sodium_100g'] * 1000) : null,
    sugar_g: n['sugars_100g'] ?? null,
  };

  return {
    source: 'openfoodfacts',
    barcode,
    food_name: p.product_name || 'Unknown product',
    brand: p.brands || null,
    default_quantity: 100,
    default_unit: 'g',
    serving_size: p.serving_size || null,
    openfoodfacts_id: barcode,
    ...per100g,
  };
}

async function searchUSDA(barcode) {
  const apiKey = process.env.USDA_API_KEY;
  if (!apiKey) return null;

  let response;
  try {
    response = await fetch(
      `${USDA_BASE}/foods/search?query=${encodeURIComponent(barcode)}&api_key=${apiKey}&pageSize=1`,
      { signal: AbortSignal.timeout(5000) }
    );
  } catch (err) {
    throw new Error(`USDA request failed: ${err.message}`);
  }

  if (!response.ok) return null;

  const data = await response.json();
  if (!data.foods || data.foods.length === 0) return null;

  const food = data.foods[0];
  const nutrients = {};
  for (const n of food.foodNutrients || []) {
    if (n.nutrientName === 'Energy') nutrients.calories = n.value;
    if (n.nutrientName === 'Protein') nutrients.protein_g = n.value;
    if (n.nutrientName === 'Carbohydrate, by difference') nutrients.carbs_g = n.value;
    if (n.nutrientName === 'Total lipid (fat)') nutrients.fat_g = n.value;
    if (n.nutrientName === 'Fiber, total dietary') nutrients.fiber_g = n.value;
    if (n.nutrientName === 'Sodium, Na') nutrients.sodium_mg = n.value;
    if (n.nutrientName === 'Sugars, total including NLEA') nutrients.sugar_g = n.value;
  }

  return {
    source: 'usda',
    barcode,
    food_name: food.description || 'Unknown product',
    brand: food.brandOwner || null,
    default_quantity: 100,
    default_unit: 'g',
    serving_size: null,
    usda_fdc_id: String(food.fdcId),
    ...nutrients,
  };
}

module.exports = { searchOpenFoodFacts, searchUSDA };
