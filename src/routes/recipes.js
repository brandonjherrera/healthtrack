const express = require('express');
const router = express.Router();
const { query, getClient } = require('../config/database');
const { validationError, validateMealItemInput, VALID_MEAL_TYPES, VALID_SOURCES } = require('../utils/validation');
const { calculateTotals, formatMealResponse } = require('../utils/formatting');

function round(v, d = 1) {
  return Math.round(v * Math.pow(10, d)) / Math.pow(10, d);
}

function formatRecipeResponse(recipe, ingredients) {
  const total = calculateTotals(ingredients);
  const s = parseFloat(recipe.servings) || 1;
  const per_serving = {
    calories:  round(total.calories  / s),
    protein_g: round(total.protein_g / s),
    carbs_g:   round(total.carbs_g   / s),
    fat_g:     round(total.fat_g     / s),
    fiber_g:   total.fiber_g   != null ? round(total.fiber_g   / s) : null,
    sodium_mg: total.sodium_mg != null ? round(total.sodium_mg / s) : null,
    sugar_g:   total.sugar_g   != null ? round(total.sugar_g   / s) : null,
  };
  return {
    id: recipe.id,
    name: recipe.name,
    description: recipe.description,
    servings: parseFloat(recipe.servings),
    prep_time_min: recipe.prep_time_min,
    cook_time_min: recipe.cook_time_min,
    tags: recipe.tags || [],
    notes: recipe.notes,
    source: recipe.source,
    per_serving,
    total,
    ingredients: ingredients.map((ing, i) => ({
      id: ing.id,
      food_library_id: ing.food_library_id || null,
      food_name: ing.food_name,
      quantity: parseFloat(ing.quantity),
      unit: ing.unit,
      calories:  parseFloat(ing.calories),
      protein_g: parseFloat(ing.protein_g),
      carbs_g:   parseFloat(ing.carbs_g),
      fat_g:     parseFloat(ing.fat_g),
      fiber_g:   ing.fiber_g   != null ? parseFloat(ing.fiber_g)   : null,
      sodium_mg: ing.sodium_mg != null ? parseFloat(ing.sodium_mg) : null,
      sugar_g:   ing.sugar_g   != null ? parseFloat(ing.sugar_g)   : null,
      sort_order: ing.sort_order ?? i,
    })),
    created_at: recipe.created_at,
    updated_at: recipe.updated_at,
  };
}

function validateRecipeInput(body) {
  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
    throw validationError('name is required');
  }
  if (body.servings !== undefined && (typeof body.servings !== 'number' || body.servings <= 0)) {
    throw validationError('servings must be a positive number');
  }
  if (body.prep_time_min !== undefined && (typeof body.prep_time_min !== 'number' || body.prep_time_min < 0)) {
    throw validationError('prep_time_min must be a non-negative integer');
  }
  if (body.cook_time_min !== undefined && (typeof body.cook_time_min !== 'number' || body.cook_time_min < 0)) {
    throw validationError('cook_time_min must be a non-negative integer');
  }
  if (!Array.isArray(body.ingredients) || body.ingredients.length === 0) {
    throw validationError('ingredients must be a non-empty array');
  }
  body.ingredients.forEach((item, i) => validateMealItemInput(item, i));
}

// GET /api/v1/recipes
router.get('/', async (req, res, next) => {
  try {
    const { q, tags, goal_match } = req.query;
    const limit  = Math.min(parseInt(req.query.limit)  || 50, 100);
    const offset = parseInt(req.query.offset) || 0;

    let where = 'WHERE r.user_id = $1';
    const params = [req.userId];
    let p = 2;

    if (q) {
      where += ` AND r.name ILIKE $${p}`;
      params.push(`%${q}%`);
      p++;
    }

    if (tags) {
      const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
      if (tagList.length > 0) {
        where += ` AND r.tags && $${p}`;
        params.push(tagList);
        p++;
      }
    }

    // goal_match: compute remaining calories for today and post-filter
    let caloriesRemaining = null;
    if (goal_match === 'true') {
      const goalRes = await query(
        `SELECT * FROM daily_goals WHERE user_id = $1 AND effective_date <= CURRENT_DATE
         ORDER BY effective_date DESC LIMIT 1`,
        [req.userId]
      );
      if (goalRes.rows.length > 0) {
        const goal = goalRes.rows[0];
        const loggedRes = await query(
          `SELECT COALESCE(SUM(mi.calories), 0) AS logged
           FROM meals m
           JOIN meal_items mi ON mi.meal_id = m.id
           WHERE m.user_id = $1
             AND DATE(m.logged_at AT TIME ZONE (SELECT timezone FROM users WHERE id = $1)) = CURRENT_DATE`,
          [req.userId]
        );
        const remaining = goal.calories_target - parseFloat(loggedRes.rows[0].logged);
        if (remaining > 0) caloriesRemaining = remaining;
      }
    }

    const recipesRes = await query(
      `SELECT r.* FROM recipes r ${where} ORDER BY r.name ASC LIMIT $${p} OFFSET $${p + 1}`,
      [...params, limit, offset]
    );

    if (recipesRes.rows.length === 0) {
      return res.json({ recipes: [], count: 0 });
    }

    const recipeIds = recipesRes.rows.map(r => r.id);
    const ingRes = await query(
      `SELECT * FROM recipe_ingredients WHERE recipe_id = ANY($1) ORDER BY sort_order`,
      [recipeIds]
    );

    const ingByRecipe = {};
    for (const ing of ingRes.rows) {
      if (!ingByRecipe[ing.recipe_id]) ingByRecipe[ing.recipe_id] = [];
      ingByRecipe[ing.recipe_id].push(ing);
    }

    let recipes = recipesRes.rows.map(r => formatRecipeResponse(r, ingByRecipe[r.id] || []));

    if (caloriesRemaining !== null) {
      recipes = recipes.filter(r => r.per_serving.calories <= caloriesRemaining);
    }

    res.json({ recipes, count: recipes.length });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/recipes
router.post('/', async (req, res, next) => {
  try {
    validateRecipeInput(req.body);

    const { name, description, servings = 1, prep_time_min, cook_time_min, tags, notes, source = 'manual', ingredients } = req.body;
    const client = await getClient();

    try {
      await client.query('BEGIN');

      const recipeRes = await client.query(
        `INSERT INTO recipes (user_id, name, description, servings, prep_time_min, cook_time_min, tags, notes, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [req.userId, name.trim(), description || null, servings, prep_time_min || null, cook_time_min || null,
         tags && tags.length ? tags : null, notes || null, source]
      );
      const recipe = recipeRes.rows[0];

      const insertedIng = [];
      for (let i = 0; i < ingredients.length; i++) {
        const ing = ingredients[i];
        const r = await client.query(
          `INSERT INTO recipe_ingredients
           (recipe_id, food_library_id, food_name, quantity, unit,
            calories, protein_g, carbs_g, fat_g, fiber_g, sodium_mg, sugar_g, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
          [recipe.id, ing.food_library_id || null, ing.food_name, ing.quantity, ing.unit,
           ing.calories, ing.protein_g, ing.carbs_g, ing.fat_g,
           ing.fiber_g || null, ing.sodium_mg || null, ing.sugar_g || null, i]
        );
        insertedIng.push(r.rows[0]);
      }

      await client.query('COMMIT');
      res.status(201).json(formatRecipeResponse(recipe, insertedIng));
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/recipes/:id
router.get('/:id', async (req, res, next) => {
  try {
    const recipeRes = await query(
      'SELECT * FROM recipes WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    );
    if (recipeRes.rows.length === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Recipe not found' } });
    }
    const ingRes = await query(
      'SELECT * FROM recipe_ingredients WHERE recipe_id = $1 ORDER BY sort_order',
      [req.params.id]
    );
    res.json(formatRecipeResponse(recipeRes.rows[0], ingRes.rows));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/recipes/:id — full replace (ingredients are replaced wholesale)
router.put('/:id', async (req, res, next) => {
  try {
    const existing = await query(
      'SELECT id FROM recipes WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Recipe not found' } });
    }

    if (req.body.ingredients !== undefined) {
      validateRecipeInput(req.body);
    }

    const { name, description, servings, prep_time_min, cook_time_min, tags, notes, source, ingredients } = req.body;
    const client = await getClient();

    try {
      await client.query('BEGIN');

      const recipeRes = await client.query(
        `UPDATE recipes SET
           name          = COALESCE($1, name),
           description   = COALESCE($2, description),
           servings      = COALESCE($3, servings),
           prep_time_min = COALESCE($4, prep_time_min),
           cook_time_min = COALESCE($5, cook_time_min),
           tags          = COALESCE($6, tags),
           notes         = COALESCE($7, notes),
           source        = COALESCE($8, source)
         WHERE id = $9 AND user_id = $10 RETURNING *`,
        [name?.trim() || null, description, servings, prep_time_min, cook_time_min,
         tags && tags.length ? tags : null, notes, source, req.params.id, req.userId]
      );
      const recipe = recipeRes.rows[0];

      let insertedIng;
      if (Array.isArray(ingredients)) {
        await client.query('DELETE FROM recipe_ingredients WHERE recipe_id = $1', [recipe.id]);
        insertedIng = [];
        for (let i = 0; i < ingredients.length; i++) {
          const ing = ingredients[i];
          const r = await client.query(
            `INSERT INTO recipe_ingredients
             (recipe_id, food_library_id, food_name, quantity, unit,
              calories, protein_g, carbs_g, fat_g, fiber_g, sodium_mg, sugar_g, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
            [recipe.id, ing.food_library_id || null, ing.food_name, ing.quantity, ing.unit,
             ing.calories, ing.protein_g, ing.carbs_g, ing.fat_g,
             ing.fiber_g || null, ing.sodium_mg || null, ing.sugar_g || null, i]
          );
          insertedIng.push(r.rows[0]);
        }
      } else {
        const ingRes = await client.query(
          'SELECT * FROM recipe_ingredients WHERE recipe_id = $1 ORDER BY sort_order',
          [recipe.id]
        );
        insertedIng = ingRes.rows;
      }

      await client.query('COMMIT');
      res.json(formatRecipeResponse(recipe, insertedIng));
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/recipes/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const result = await query(
      'DELETE FROM recipes WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Recipe not found' } });
    }
    res.json({ deleted: true, id: result.rows[0].id });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/recipes/:id/log — cook it, log as a meal
router.post('/:id/log', async (req, res, next) => {
  try {
    const { meal_type, logged_at, servings = 1, source = 'recipe', notes } = req.body;

    if (!meal_type || !VALID_MEAL_TYPES.includes(meal_type)) {
      throw validationError(`meal_type must be one of: ${VALID_MEAL_TYPES.join(', ')}`);
    }
    if (!logged_at || isNaN(new Date(logged_at).getTime())) {
      throw validationError('logged_at is required (ISO 8601 datetime)');
    }
    if (typeof servings !== 'number' || servings <= 0) {
      throw validationError('servings must be a positive number');
    }

    const recipeRes = await query(
      'SELECT * FROM recipes WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    );
    if (recipeRes.rows.length === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Recipe not found' } });
    }
    const recipe = recipeRes.rows[0];

    const ingRes = await query(
      'SELECT * FROM recipe_ingredients WHERE recipe_id = $1 ORDER BY sort_order',
      [recipe.id]
    );
    if (ingRes.rows.length === 0) {
      throw validationError('Recipe has no ingredients — add ingredients before logging');
    }

    const scale = servings / (parseFloat(recipe.servings) || 1);
    const client = await getClient();

    try {
      await client.query('BEGIN');

      const mealRes = await client.query(
        `INSERT INTO meals (user_id, meal_type, logged_at, notes, source)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [req.userId, meal_type, logged_at,
         notes || `${recipe.name}${servings !== parseFloat(recipe.servings) ? ` (${servings} serving${servings !== 1 ? 's' : ''})` : ''}`,
         source]
      );
      const meal = mealRes.rows[0];

      const insertedItems = [];
      for (let i = 0; i < ingRes.rows.length; i++) {
        const ing = ingRes.rows[i];
        const r = await client.query(
          `INSERT INTO meal_items
           (meal_id, food_library_id, food_name, quantity, unit,
            calories, protein_g, carbs_g, fat_g, fiber_g, sodium_mg, sugar_g,
            data_source, verified, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
           RETURNING *`,
          [
            meal.id, ing.food_library_id || null, ing.food_name,
            round(parseFloat(ing.quantity) * scale, 2), ing.unit,
            round(parseFloat(ing.calories)  * scale),
            round(parseFloat(ing.protein_g) * scale),
            round(parseFloat(ing.carbs_g)   * scale),
            round(parseFloat(ing.fat_g)     * scale),
            ing.fiber_g   != null ? round(parseFloat(ing.fiber_g)   * scale) : null,
            ing.sodium_mg != null ? round(parseFloat(ing.sodium_mg) * scale) : null,
            ing.sugar_g   != null ? round(parseFloat(ing.sugar_g)   * scale) : null,
            'library', true, i,
          ]
        );
        insertedItems.push(r.rows[0]);

        if (ing.food_library_id) {
          await client.query(
            `UPDATE food_library SET use_count = use_count + 1, last_used_at = NOW() WHERE id = $1`,
            [ing.food_library_id]
          );
        }
      }

      await client.query('COMMIT');
      res.status(201).json(formatMealResponse(meal, insertedItems));
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

module.exports = router;
