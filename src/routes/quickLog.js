const express = require('express');
const router = express.Router();
const { estimateFromText } = require('../services/macroEstimator');
const { getClient, query } = require('../config/database');
const { formatMealResponse, calculateTotals } = require('../utils/formatting');
const { VALID_MEAL_TYPES } = require('../utils/validation');

// POST /api/v1/meals/quick-log — One-shot: estimate + log from a plain-text description
// OpenClaw flow: send description + meal_type, get back the logged meal and updated daily totals
router.post('/', async (req, res, next) => {
  try {
    const { description, meal_type, logged_at } = req.body || {};

    if (!description || typeof description !== 'string' || description.trim().length === 0) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'description is required',
          example: { description: '8oz grilled chicken, 1 cup rice, steamed broccoli', meal_type: 'lunch' },
        },
      });
    }

    if (description.length > 1000) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'description must be 1000 characters or fewer' },
      });
    }

    const loggedAt = logged_at ? new Date(logged_at) : new Date();
    if (isNaN(loggedAt.getTime())) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'logged_at must be a valid ISO 8601 datetime' },
      });
    }

    const estimate = await estimateFromText(description.trim());

    const resolvedMealType = meal_type || estimate.meal_type_suggestion;
    if (!resolvedMealType || !VALID_MEAL_TYPES.includes(resolvedMealType)) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: `meal_type must be one of: ${VALID_MEAL_TYPES.join(', ')}`,
        },
      });
    }

    const client = await getClient();
    let meal, insertedItems;

    try {
      await client.query('BEGIN');

      const mealResult = await client.query(
        `INSERT INTO meals (user_id, meal_type, logged_at, notes, source)
         VALUES ($1, $2, $3, $4, 'openclaw')
         RETURNING *`,
        [req.userId, resolvedMealType, loggedAt.toISOString(), description.trim()]
      );
      meal = mealResult.rows[0];

      insertedItems = [];
      for (let i = 0; i < estimate.items.length; i++) {
        const item = estimate.items[i];
        const itemResult = await client.query(
          `INSERT INTO meal_items
           (meal_id, food_name, quantity, unit,
            calories, protein_g, carbs_g, fat_g, fiber_g, sodium_mg, sugar_g,
            confidence_score, data_source, verified, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'ai_estimate', false, $13)
           RETURNING *`,
          [
            meal.id, item.food_name, item.quantity, item.unit,
            item.calories, item.protein_g, item.carbs_g, item.fat_g,
            item.fiber_g || null, item.sodium_mg || null, item.sugar_g || null,
            item.confidence_score || null, i,
          ]
        );
        insertedItems.push(itemResult.rows[0]);
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const date = loggedAt.toISOString().split('T')[0];
    const dailyItemsResult = await query(
      `SELECT mi.* FROM meal_items mi
       JOIN meals m ON mi.meal_id = m.id
       WHERE m.user_id = $1
       AND DATE(m.logged_at AT TIME ZONE (SELECT timezone FROM users WHERE id = $1)) = $2`,
      [req.userId, date]
    );
    const dailyTotals = calculateTotals(dailyItemsResult.rows);

    const goalResult = await query(
      `SELECT * FROM daily_goals WHERE user_id = $1 AND effective_date <= $2
       ORDER BY effective_date DESC LIMIT 1`,
      [req.userId, date]
    );
    const goals = goalResult.rows[0] || null;

    res.status(201).json({
      meal: formatMealResponse(meal, insertedItems),
      estimate_confidence: estimate.overall_confidence,
      estimate_assumptions: estimate.assumptions,
      daily_totals: dailyTotals,
      goals: goals ? {
        calories_target: Number(goals.calories_target),
        protein_g_target: Number(goals.protein_g_target),
        carbs_g_target: Number(goals.carbs_g_target),
        fat_g_target: Number(goals.fat_g_target),
      } : null,
    });
  } catch (err) {
    if (err.message && err.message.includes('ANTHROPIC_API_KEY')) {
      return res.status(503).json({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Macro estimation service is not configured. Set ANTHROPIC_API_KEY in your .env file.',
        },
      });
    }
    next(err);
  }
});

module.exports = router;
