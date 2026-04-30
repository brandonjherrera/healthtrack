const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { validationError, validateDateParam, VALID_MEAL_TYPES } = require('../utils/validation');
const { calculateTotals } = require('../utils/formatting');

const VALID_PLAN_STATUSES = ['planned', 'logged', 'skipped'];

function round(v, d = 1) {
  return Math.round(v * Math.pow(10, d)) / Math.pow(10, d);
}

function formatPlanEntry(plan) {
  return {
    id: plan.id,
    plan_date: plan.plan_date_str || plan.plan_date,
    meal_type: plan.meal_type,
    recipe: plan.recipe_id ? {
      id: plan.recipe_id,
      name: plan.recipe_name,
      description: plan.recipe_description,
      tags: plan.recipe_tags || [],
      prep_time_min: plan.prep_time_min,
      cook_time_min: plan.cook_time_min,
    } : null,
    servings: parseFloat(plan.servings),
    notes: plan.notes,
    status: plan.status,
    meal_id: plan.meal_id,
    created_at: plan.created_at,
    updated_at: plan.updated_at,
  };
}

// GET /api/v1/meal-plans/week — 7-day grid with per-day macro totals vs goal
// Must be registered before /:id to avoid Express routing conflict
router.get('/week', async (req, res, next) => {
  try {
    let weekStart;
    if (req.query.start_date) {
      validateDateParam(req.query.start_date);
      weekStart = req.query.start_date;
    } else {
      const today = new Date();
      const day = today.getDay(); // 0 = Sunday
      const diff = day === 0 ? -6 : 1 - day; // shift to Monday
      const monday = new Date(today);
      monday.setDate(today.getDate() + diff);
      weekStart = monday.toISOString().split('T')[0];
    }

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const weekEndStr = weekEnd.toISOString().split('T')[0];

    // Active goal
    const goalRes = await query(
      `SELECT * FROM daily_goals WHERE user_id = $1 AND effective_date <= $2
       ORDER BY effective_date DESC LIMIT 1`,
      [req.userId, weekEndStr]
    );
    const goal = goalRes.rows[0] || null;

    // Plans for the week with recipe metadata
    const plansRes = await query(
      `SELECT
         mp.*,
         mp.plan_date::text        AS plan_date_str,
         r.name                    AS recipe_name,
         r.description             AS recipe_description,
         r.servings                AS recipe_servings,
         r.tags                    AS recipe_tags,
         r.prep_time_min,
         r.cook_time_min
       FROM meal_plans mp
       LEFT JOIN recipes r ON r.id = mp.recipe_id
       WHERE mp.user_id = $1 AND mp.plan_date BETWEEN $2 AND $3
       ORDER BY mp.plan_date, mp.meal_type`,
      [req.userId, weekStart, weekEndStr]
    );

    // Fetch ingredients for all recipes referenced this week
    const recipeIds = [...new Set(plansRes.rows.filter(p => p.recipe_id).map(p => p.recipe_id))];
    const ingByRecipe = {};
    if (recipeIds.length > 0) {
      const ingRes = await query(
        'SELECT * FROM recipe_ingredients WHERE recipe_id = ANY($1)',
        [recipeIds]
      );
      for (const ing of ingRes.rows) {
        if (!ingByRecipe[ing.recipe_id]) ingByRecipe[ing.recipe_id] = [];
        ingByRecipe[ing.recipe_id].push(ing);
      }
    }

    // Build 7-day grid
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];
      const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

      const dayPlans = plansRes.rows.filter(p => p.plan_date_str === dateStr);
      const mealSlots = { breakfast: [], lunch: [], dinner: [], snack: [] };

      let totalCal = 0, totalPro = 0, totalCarb = 0, totalFat = 0;

      for (const plan of dayPlans) {
        let macros = null;
        if (plan.recipe_id) {
          const ings = ingByRecipe[plan.recipe_id] || [];
          const recipeTotal = calculateTotals(ings);
          const scale = parseFloat(plan.servings) / (parseFloat(plan.recipe_servings) || 1);
          macros = {
            calories:  round(recipeTotal.calories  * scale),
            protein_g: round(recipeTotal.protein_g * scale),
            carbs_g:   round(recipeTotal.carbs_g   * scale),
            fat_g:     round(recipeTotal.fat_g     * scale),
          };
          totalCal  += macros.calories;
          totalPro  += macros.protein_g;
          totalCarb += macros.carbs_g;
          totalFat  += macros.fat_g;
        }

        mealSlots[plan.meal_type].push({
          id: plan.id,
          recipe_id: plan.recipe_id,
          recipe_name: plan.recipe_name,
          recipe_tags: plan.recipe_tags || [],
          prep_time_min: plan.prep_time_min,
          cook_time_min: plan.cook_time_min,
          servings: parseFloat(plan.servings),
          notes: plan.notes,
          status: plan.status,
          meal_id: plan.meal_id,
          macros,
        });
      }

      const totals = {
        calories:  round(totalCal),
        protein_g: round(totalPro),
        carbs_g:   round(totalCarb),
        fat_g:     round(totalFat),
      };

      let progress = null;
      if (goal) {
        const pct = (v, t) => (t > 0 ? Math.round((v / t) * 100) : 0);
        progress = {
          calories:  { target: goal.calories_target,              planned: totals.calories,  pct: pct(totals.calories,  goal.calories_target) },
          protein_g: { target: parseFloat(goal.protein_g_target), planned: totals.protein_g, pct: pct(totals.protein_g, parseFloat(goal.protein_g_target)) },
          carbs_g:   { target: parseFloat(goal.carbs_g_target),   planned: totals.carbs_g,   pct: pct(totals.carbs_g,   parseFloat(goal.carbs_g_target)) },
          fat_g:     { target: parseFloat(goal.fat_g_target),     planned: totals.fat_g,     pct: pct(totals.fat_g,     parseFloat(goal.fat_g_target)) },
        };
      }

      days.push({ date: dateStr, day_of_week: DAY_NAMES[d.getDay()], meals: mealSlots, totals, progress });
    }

    res.json({
      week_start: weekStart,
      week_end: weekEndStr,
      goal: goal ? {
        calories_target:  goal.calories_target,
        protein_g_target: parseFloat(goal.protein_g_target),
        carbs_g_target:   parseFloat(goal.carbs_g_target),
        fat_g_target:     parseFloat(goal.fat_g_target),
      } : null,
      days,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/meal-plans
router.get('/', async (req, res, next) => {
  try {
    const { start_date, end_date, status } = req.query;

    let where = 'WHERE mp.user_id = $1';
    const params = [req.userId];
    let p = 2;

    if (start_date) {
      validateDateParam(start_date);
      where += ` AND mp.plan_date >= $${p}`;
      params.push(start_date);
      p++;
    }
    if (end_date) {
      validateDateParam(end_date);
      where += ` AND mp.plan_date <= $${p}`;
      params.push(end_date);
      p++;
    }
    if (status) {
      if (!VALID_PLAN_STATUSES.includes(status)) {
        throw validationError(`status must be one of: ${VALID_PLAN_STATUSES.join(', ')}`);
      }
      where += ` AND mp.status = $${p}`;
      params.push(status);
      p++;
    }

    const result = await query(
      `SELECT
         mp.*,
         mp.plan_date::text AS plan_date_str,
         r.name             AS recipe_name,
         r.description      AS recipe_description,
         r.tags             AS recipe_tags,
         r.prep_time_min,
         r.cook_time_min
       FROM meal_plans mp
       LEFT JOIN recipes r ON r.id = mp.recipe_id
       ${where}
       ORDER BY mp.plan_date ASC, mp.meal_type ASC`,
      params
    );

    res.json({ plans: result.rows.map(formatPlanEntry), count: result.rows.length });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/meal-plans
router.post('/', async (req, res, next) => {
  try {
    const { plan_date, meal_type, recipe_id, servings = 1, notes } = req.body;

    validateDateParam(plan_date);
    if (!meal_type || !VALID_MEAL_TYPES.includes(meal_type)) {
      throw validationError(`meal_type must be one of: ${VALID_MEAL_TYPES.join(', ')}`);
    }
    if (typeof servings !== 'number' || servings <= 0) {
      throw validationError('servings must be a positive number');
    }

    // Verify recipe belongs to user
    if (recipe_id) {
      const rCheck = await query(
        'SELECT id FROM recipes WHERE id = $1 AND user_id = $2',
        [recipe_id, req.userId]
      );
      if (rCheck.rows.length === 0) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Recipe not found' } });
      }
    }

    const result = await query(
      `INSERT INTO meal_plans (user_id, plan_date, meal_type, recipe_id, servings, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *, plan_date::text AS plan_date_str`,
      [req.userId, plan_date, meal_type, recipe_id || null, servings, notes || null]
    );

    const plan = result.rows[0];
    let recipe_name = null, recipe_description = null, recipe_tags = null;
    let prep_time_min = null, cook_time_min = null;

    if (plan.recipe_id) {
      const rRes = await query('SELECT * FROM recipes WHERE id = $1', [plan.recipe_id]);
      if (rRes.rows.length > 0) {
        recipe_name        = rRes.rows[0].name;
        recipe_description = rRes.rows[0].description;
        recipe_tags        = rRes.rows[0].tags;
        prep_time_min      = rRes.rows[0].prep_time_min;
        cook_time_min      = rRes.rows[0].cook_time_min;
      }
    }

    res.status(201).json(formatPlanEntry({ ...plan, recipe_name, recipe_description, recipe_tags, prep_time_min, cook_time_min }));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/meal-plans/:id
router.put('/:id', async (req, res, next) => {
  try {
    const existing = await query(
      'SELECT id FROM meal_plans WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Meal plan entry not found' } });
    }

    const { plan_date, meal_type, recipe_id, servings, notes, status } = req.body;

    if (plan_date)  validateDateParam(plan_date);
    if (meal_type && !VALID_MEAL_TYPES.includes(meal_type)) {
      throw validationError(`meal_type must be one of: ${VALID_MEAL_TYPES.join(', ')}`);
    }
    if (status && !VALID_PLAN_STATUSES.includes(status)) {
      throw validationError(`status must be one of: ${VALID_PLAN_STATUSES.join(', ')}`);
    }
    if (servings !== undefined && (typeof servings !== 'number' || servings <= 0)) {
      throw validationError('servings must be a positive number');
    }

    if (recipe_id) {
      const rCheck = await query('SELECT id FROM recipes WHERE id = $1 AND user_id = $2', [recipe_id, req.userId]);
      if (rCheck.rows.length === 0) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Recipe not found' } });
      }
    }

    const result = await query(
      `UPDATE meal_plans SET
         plan_date = COALESCE($1, plan_date),
         meal_type = COALESCE($2, meal_type),
         recipe_id = COALESCE($3, recipe_id),
         servings  = COALESCE($4, servings),
         notes     = COALESCE($5, notes),
         status    = COALESCE($6, status)
       WHERE id = $7 AND user_id = $8
       RETURNING *, plan_date::text AS plan_date_str`,
      [plan_date, meal_type, recipe_id, servings, notes, status, req.params.id, req.userId]
    );

    const plan = result.rows[0];
    let recipe_name = null, recipe_description = null, recipe_tags = null;
    let prep_time_min = null, cook_time_min = null;

    if (plan.recipe_id) {
      const rRes = await query('SELECT * FROM recipes WHERE id = $1', [plan.recipe_id]);
      if (rRes.rows.length > 0) {
        recipe_name        = rRes.rows[0].name;
        recipe_description = rRes.rows[0].description;
        recipe_tags        = rRes.rows[0].tags;
        prep_time_min      = rRes.rows[0].prep_time_min;
        cook_time_min      = rRes.rows[0].cook_time_min;
      }
    }

    res.json(formatPlanEntry({ ...plan, recipe_name, recipe_description, recipe_tags, prep_time_min, cook_time_min }));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/meal-plans/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const result = await query(
      'DELETE FROM meal_plans WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Meal plan entry not found' } });
    }
    res.json({ deleted: true, id: result.rows[0].id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
