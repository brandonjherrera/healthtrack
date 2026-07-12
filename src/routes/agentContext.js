const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { calculateTotals, calculateProgress, formatMealResponse, round } = require('../utils/formatting');
const { getUserLocalToday } = require('../utils/dates');

// GET /api/v1/agent/context — Single "orient me" call for any agent session
// Returns user profile, active goals, today's nutrition, and recent meals in one shot
router.get('/', async (req, res, next) => {
  try {
    const today = await getUserLocalToday(req.userId);

    const [userResult, goalResult, dailyItemsResult, recentMealsResult, mealCountResult] = await Promise.all([
      query(
        'SELECT id, email, name, timezone, preferences FROM users WHERE id = $1',
        [req.userId]
      ),
      query(
        `SELECT * FROM daily_goals
         WHERE user_id = $1 AND effective_date <= $2
         ORDER BY effective_date DESC LIMIT 1`,
        [req.userId, today]
      ),
      query(
        `SELECT mi.* FROM meal_items mi
         JOIN meals m ON mi.meal_id = m.id
         WHERE m.user_id = $1
         AND DATE(m.logged_at AT TIME ZONE (SELECT timezone FROM users WHERE id = $1)) = $2`,
        [req.userId, today]
      ),
      query(
        `SELECT m.* FROM meals m
         WHERE m.user_id = $1
         ORDER BY m.logged_at DESC LIMIT 5`,
        [req.userId]
      ),
      query(
        `SELECT COUNT(*) as count FROM meals
         WHERE user_id = $1
         AND DATE(logged_at AT TIME ZONE (SELECT timezone FROM users WHERE id = $1)) = $2`,
        [req.userId, today]
      ),
    ]);

    const user = userResult.rows[0];
    const goals = goalResult.rows[0] || null;
    const todayTotals = calculateTotals(dailyItemsResult.rows);
    const progressData = calculateProgress(todayTotals, goals);

    // Attach items to recent meals
    const recentMeals = [];
    if (recentMealsResult.rows.length > 0) {
      const mealIds = recentMealsResult.rows.map((m) => m.id);
      const itemsResult = await query(
        'SELECT * FROM meal_items WHERE meal_id = ANY($1) ORDER BY sort_order',
        [mealIds]
      );
      const itemsByMeal = {};
      for (const item of itemsResult.rows) {
        if (!itemsByMeal[item.meal_id]) itemsByMeal[item.meal_id] = [];
        itemsByMeal[item.meal_id].push(item);
      }
      for (const meal of recentMealsResult.rows) {
        recentMeals.push(formatMealResponse(meal, itemsByMeal[meal.id] || []));
      }
    }

    res.json({
      as_of: new Date().toISOString(),
      user: {
        name: user.name,
        email: user.email,
        timezone: user.timezone,
      },
      goals: goals ? {
        calories_target: Number(goals.calories_target),
        protein_g_target: Number(goals.protein_g_target),
        carbs_g_target: Number(goals.carbs_g_target),
        fat_g_target: Number(goals.fat_g_target),
        fiber_g_target: goals.fiber_g_target ? Number(goals.fiber_g_target) : null,
        effective_date: goals.effective_date,
      } : null,
      today: {
        date: today,
        totals: todayTotals,
        progress: progressData?.progress || null,
        remaining: progressData?.remaining || null,
        meals_logged: parseInt(mealCountResult.rows[0].count),
      },
      recent_meals: recentMeals,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
