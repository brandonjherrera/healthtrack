const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { validateGoalInput } = require('../utils/validation');

// GET /api/v1/goals — Current active goal
router.get('/', async (req, res, next) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    const result = await query(
      `SELECT * FROM daily_goals
       WHERE user_id = $1 AND effective_date <= $2
       ORDER BY effective_date DESC LIMIT 1`,
      [req.userId, today]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'No goals set yet' },
      });
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/goals — Create new goal (does not overwrite history)
router.put('/', async (req, res, next) => {
  try {
    validateGoalInput(req.body);

    const {
      effective_date, calories_target, protein_g_target, carbs_g_target, fat_g_target,
      fiber_g_target, sodium_mg_target, sugar_g_target, notes,
    } = req.body;

    // Upsert — if a goal already exists for this effective_date, update it
    const result = await query(
      `INSERT INTO daily_goals 
       (user_id, effective_date, calories_target, protein_g_target, carbs_g_target, fat_g_target,
        fiber_g_target, sodium_mg_target, sugar_g_target, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (user_id, effective_date) DO UPDATE SET
        calories_target = EXCLUDED.calories_target,
        protein_g_target = EXCLUDED.protein_g_target,
        carbs_g_target = EXCLUDED.carbs_g_target,
        fat_g_target = EXCLUDED.fat_g_target,
        fiber_g_target = EXCLUDED.fiber_g_target,
        sodium_mg_target = EXCLUDED.sodium_mg_target,
        sugar_g_target = EXCLUDED.sugar_g_target,
        notes = EXCLUDED.notes
       RETURNING *`,
      [
        req.userId, effective_date, calories_target, protein_g_target, carbs_g_target, fat_g_target,
        fiber_g_target || null, sodium_mg_target || null, sugar_g_target || null, notes || null,
      ]
    );

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/goals/history — All goal changes over time
router.get('/history', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT * FROM daily_goals
       WHERE user_id = $1
       ORDER BY effective_date DESC`,
      [req.userId]
    );

    res.json({ goals: result.rows, count: result.rows.length });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
