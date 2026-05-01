const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const baseUrl = process.env.HEALTHTRACK_TEST_BASE_URL;
const apiKey = process.env.HEALTHTRACK_TEST_API_KEY;
const hasLiveApi = Boolean(baseUrl && apiKey);

async function apiRequest(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  return { response, data };
}

describe('recipe plan logging integration', { skip: !hasLiveApi }, () => {
  it('returns 409 when logging the same planned recipe twice', async () => {
    let recipeId;
    let planId;
    let mealId;

    try {
      const recipeResult = await apiRequest('/recipes', {
        method: 'POST',
        body: {
          name: `Duplicate Plan Guard ${Date.now()}`,
          servings: 2,
          source: 'openclaw',
          ingredients: [
            {
              food_name: 'Chicken Breast',
              quantity: 200,
              unit: 'g',
              calories: 330,
              protein_g: 62,
              carbs_g: 0,
              fat_g: 7.2,
            },
          ],
        },
      });
      assert.equal(recipeResult.response.status, 201);
      recipeId = recipeResult.data.id;

      const planDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const planResult = await apiRequest('/meal-plans', {
        method: 'POST',
        body: {
          plan_date: planDate,
          meal_type: 'dinner',
          recipe_id: recipeId,
          servings: 1,
        },
      });
      assert.equal(planResult.response.status, 201);
      planId = planResult.data.id;

      const firstLog = await apiRequest(`/recipes/${recipeId}/log`, {
        method: 'POST',
        body: {
          plan_id: planId,
          meal_type: 'dinner',
          logged_at: new Date().toISOString(),
          servings: 1,
        },
      });
      assert.equal(firstLog.response.status, 201);
      mealId = firstLog.data.id;
      assert.equal(firstLog.data.source, 'manual');

      const secondLog = await apiRequest(`/recipes/${recipeId}/log`, {
        method: 'POST',
        body: {
          plan_id: planId,
          meal_type: 'dinner',
          logged_at: new Date().toISOString(),
          servings: 1,
        },
      });
      assert.equal(secondLog.response.status, 409);
      assert.equal(secondLog.data.error.code, 'PLAN_ALREADY_LOGGED');
      assert.match(secondLog.data.error.message, /already logged/i);
    } finally {
      if (mealId) await apiRequest(`/meals/${mealId}`, { method: 'DELETE' });
      if (planId) await apiRequest(`/meal-plans/${planId}`, { method: 'DELETE' });
      if (recipeId) await apiRequest(`/recipes/${recipeId}`, { method: 'DELETE' });
    }
  });
});
