// Calculate macro totals from an array of meal items
function calculateTotals(items) {
  return items.reduce(
    (totals, item) => ({
      calories: totals.calories + Number(item.calories),
      protein_g: totals.protein_g + Number(item.protein_g),
      carbs_g: totals.carbs_g + Number(item.carbs_g),
      fat_g: totals.fat_g + Number(item.fat_g),
      fiber_g: totals.fiber_g + Number(item.fiber_g || 0),
      sodium_mg: totals.sodium_mg + Number(item.sodium_mg || 0),
      sugar_g: totals.sugar_g + Number(item.sugar_g || 0),
    }),
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sodium_mg: 0, sugar_g: 0 }
  );
}

// Calculate progress against goals
function calculateProgress(totals, goals) {
  if (!goals) return null;

  const progress = {};
  const remaining = {};

  if (goals.calories_target) {
    progress.calories_pct = round((totals.calories / goals.calories_target) * 100, 1);
    remaining.calories = Math.max(0, goals.calories_target - totals.calories);
  }
  if (goals.protein_g_target) {
    progress.protein_pct = round((totals.protein_g / goals.protein_g_target) * 100, 1);
    remaining.protein_g = Math.max(0, round(goals.protein_g_target - totals.protein_g, 1));
  }
  if (goals.carbs_g_target) {
    progress.carbs_pct = round((totals.carbs_g / goals.carbs_g_target) * 100, 1);
    remaining.carbs_g = Math.max(0, round(goals.carbs_g_target - totals.carbs_g, 1));
  }
  if (goals.fat_g_target) {
    progress.fat_pct = round((totals.fat_g / goals.fat_g_target) * 100, 1);
    remaining.fat_g = Math.max(0, round(goals.fat_g_target - totals.fat_g, 1));
  }

  return { progress, remaining };
}

// Format a meal row with its items for API response
function formatMealResponse(meal, items) {
  const totals = calculateTotals(items);
  return {
    id: meal.id,
    meal_type: meal.meal_type,
    logged_at: meal.logged_at,
    notes: meal.notes,
    photo_url: meal.photo_url,
    source: meal.source,
    totals,
    items: items.map(formatMealItemResponse),
    created_at: meal.created_at,
    updated_at: meal.updated_at,
  };
}

function formatMealItemResponse(item) {
  return {
    id: item.id,
    food_name: item.food_name,
    quantity: Number(item.quantity),
    unit: item.unit,
    calories: Number(item.calories),
    protein_g: Number(item.protein_g),
    carbs_g: Number(item.carbs_g),
    fat_g: Number(item.fat_g),
    fiber_g: item.fiber_g ? Number(item.fiber_g) : null,
    sodium_mg: item.sodium_mg ? Number(item.sodium_mg) : null,
    sugar_g: item.sugar_g ? Number(item.sugar_g) : null,
    confidence_score: item.confidence_score ? Number(item.confidence_score) : null,
    data_source: item.data_source,
    verified: item.verified,
    food_library_id: item.food_library_id,
  };
}

function round(value, decimals) {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

module.exports = {
  calculateTotals,
  calculateProgress,
  formatMealResponse,
  formatMealItemResponse,
  round,
};
