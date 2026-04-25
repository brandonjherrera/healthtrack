const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { validateDateParam } = require('../utils/validation');
const { calculateTotals, calculateProgress, round } = require('../utils/formatting');

// GET /api/v1/nutrition/daily — Daily macro/calorie totals
router.get('/daily', async (req, res, next) => {
  try {
    const date = validateDateParam(req.query.date) || new Date().toISOString().split('T')[0];

    // Get all meal items for the date
    const itemsResult = await query(
      `SELECT mi.* FROM meal_items mi
       JOIN meals m ON mi.meal_id = m.id
       WHERE m.user_id = $1
       AND DATE(m.logged_at AT TIME ZONE (SELECT timezone FROM users WHERE id = $1)) = $2`,
      [req.userId, date]
    );

    const totals = calculateTotals(itemsResult.rows);

    // Get active goal for this date
    const goalResult = await query(
      `SELECT * FROM daily_goals
       WHERE user_id = $1 AND effective_date <= $2
       ORDER BY effective_date DESC LIMIT 1`,
      [req.userId, date]
    );

    const goals = goalResult.rows[0] || null;
    const progressData = calculateProgress(totals, goals);

    // Count meals logged
    const mealCountResult = await query(
      `SELECT COUNT(*) as count FROM meals
       WHERE user_id = $1
       AND DATE(logged_at AT TIME ZONE (SELECT timezone FROM users WHERE id = $1)) = $2`,
      [req.userId, date]
    );

    res.json({
      date,
      totals,
      goals: goals ? {
        calories_target: Number(goals.calories_target),
        protein_g_target: Number(goals.protein_g_target),
        carbs_g_target: Number(goals.carbs_g_target),
        fat_g_target: Number(goals.fat_g_target),
      } : null,
      progress: progressData?.progress || null,
      remaining: progressData?.remaining || null,
      meals_logged: parseInt(mealCountResult.rows[0].count),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/nutrition/summary — Aggregated stats over a range
router.get('/summary', async (req, res, next) => {
  try {
    const range = req.query.range || 'week';
    let startDate, endDate;

    const today = new Date().toISOString().split('T')[0];

    if (range === 'custom') {
      startDate = validateDateParam(req.query.start_date);
      endDate = validateDateParam(req.query.end_date);
      if (!startDate || !endDate) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'start_date and end_date required for custom range',
          },
        });
      }
    } else {
      endDate = today;
      const end = new Date(today);
      if (range === 'week') {
        end.setDate(end.getDate() - 6);
      } else if (range === 'month') {
        end.setDate(end.getDate() - 29);
      }
      startDate = end.toISOString().split('T')[0];
    }

    // Get daily breakdown
    const dailyResult = await query(
      `SELECT 
        DATE(m.logged_at AT TIME ZONE (SELECT timezone FROM users WHERE id = $1)) as date,
        SUM(mi.calories) as calories,
        SUM(mi.protein_g) as protein_g,
        SUM(mi.carbs_g) as carbs_g,
        SUM(mi.fat_g) as fat_g,
        SUM(COALESCE(mi.fiber_g, 0)) as fiber_g,
        SUM(COALESCE(mi.sodium_mg, 0)) as sodium_mg,
        SUM(COALESCE(mi.sugar_g, 0)) as sugar_g
       FROM meal_items mi
       JOIN meals m ON mi.meal_id = m.id
       WHERE m.user_id = $1
       AND DATE(m.logged_at AT TIME ZONE (SELECT timezone FROM users WHERE id = $1)) BETWEEN $2 AND $3
       GROUP BY DATE(m.logged_at AT TIME ZONE (SELECT timezone FROM users WHERE id = $1))
       ORDER BY date`,
      [req.userId, startDate, endDate]
    );

    const dailyBreakdown = dailyResult.rows.map((row) => ({
      date: row.date.toISOString().split('T')[0],
      calories: round(Number(row.calories), 0),
      protein_g: round(Number(row.protein_g), 1),
      carbs_g: round(Number(row.carbs_g), 1),
      fat_g: round(Number(row.fat_g), 1),
    }));

    const daysWithData = dailyBreakdown.length;

    const averages = daysWithData > 0
      ? {
          calories: round(dailyBreakdown.reduce((s, d) => s + d.calories, 0) / daysWithData, 0),
          protein_g: round(dailyBreakdown.reduce((s, d) => s + d.protein_g, 0) / daysWithData, 1),
          carbs_g: round(dailyBreakdown.reduce((s, d) => s + d.carbs_g, 0) / daysWithData, 1),
          fat_g: round(dailyBreakdown.reduce((s, d) => s + d.fat_g, 0) / daysWithData, 1),
        }
      : { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };

    // Goal adherence — check how many days met targets
    const goalResult = await query(
      `SELECT * FROM daily_goals
       WHERE user_id = $1 AND effective_date <= $2
       ORDER BY effective_date DESC LIMIT 1`,
      [req.userId, endDate]
    );

    let goalAdherence = null;
    if (goalResult.rows[0]) {
      const goal = goalResult.rows[0];
      const calTarget = Number(goal.calories_target);
      const threshold = 0.1; // within 10% counts as on-target

      let daysOnTarget = 0;
      let daysOver = 0;
      let daysUnder = 0;

      for (const day of dailyBreakdown) {
        const ratio = day.calories / calTarget;
        if (ratio >= (1 - threshold) && ratio <= (1 + threshold)) {
          daysOnTarget++;
        } else if (ratio > (1 + threshold)) {
          daysOver++;
        } else {
          daysUnder++;
        }
      }

      const proteinTarget = Number(goal.protein_g_target);
      const proteinHitDays = dailyBreakdown.filter(
        (d) => d.protein_g >= proteinTarget * 0.9
      ).length;

      goalAdherence = {
        days_on_target: daysOnTarget,
        days_over: daysOver,
        days_under: daysUnder,
        protein_consistency_pct: daysWithData > 0
          ? round((proteinHitDays / daysWithData) * 100, 0)
          : 0,
      };
    }

    res.json({
      range,
      start_date: startDate,
      end_date: endDate,
      averages,
      goal_adherence: goalAdherence,
      daily_breakdown: dailyBreakdown,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/nutrition/trends — Trend data for charts
router.get('/trends', async (req, res, next) => {
  try {
    const metric = req.query.metric || 'calories';
    const range = req.query.range || 'month';

    const validMetrics = ['calories', 'protein', 'carbs', 'fat'];
    if (!validMetrics.includes(metric)) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: `metric must be one of: ${validMetrics.join(', ')}`,
        },
      });
    }

    const columnMap = {
      calories: 'calories',
      protein: 'protein_g',
      carbs: 'carbs_g',
      fat: 'fat_g',
    };

    const column = columnMap[metric];
    const today = new Date().toISOString().split('T')[0];
    const start = new Date(today);

    const rangeDays = { week: 6, month: 29, '3month': 89, '6month': 179, year: 364 };
    start.setDate(start.getDate() - (rangeDays[range] || 29));
    const startDate = start.toISOString().split('T')[0];

    const result = await query(
      `SELECT 
        DATE(m.logged_at AT TIME ZONE (SELECT timezone FROM users WHERE id = $1)) as date,
        SUM(mi.${column}) as value
       FROM meal_items mi
       JOIN meals m ON mi.meal_id = m.id
       WHERE m.user_id = $1
       AND DATE(m.logged_at AT TIME ZONE (SELECT timezone FROM users WHERE id = $1)) BETWEEN $2 AND $3
       GROUP BY DATE(m.logged_at AT TIME ZONE (SELECT timezone FROM users WHERE id = $1))
       ORDER BY date`,
      [req.userId, startDate, today]
    );

    // Get goal target for this metric
    const goalResult = await query(
      `SELECT ${column}_target as target FROM daily_goals
       WHERE user_id = $1 AND effective_date <= $2
       ORDER BY effective_date DESC LIMIT 1`,
      [req.userId, today]
    );

    const target = goalResult.rows[0] ? Number(goalResult.rows[0].target) : null;

    const dataPoints = result.rows.map((row) => ({
      date: row.date.toISOString().split('T')[0],
      value: round(Number(row.value), metric === 'calories' ? 0 : 1),
      target,
    }));

    const values = dataPoints.map((d) => d.value);
    const average = values.length > 0
      ? round(values.reduce((a, b) => a + b, 0) / values.length, metric === 'calories' ? 0 : 1)
      : 0;

    // Simple trend detection
    let trend = 'stable';
    if (values.length >= 7) {
      const firstHalf = values.slice(0, Math.floor(values.length / 2));
      const secondHalf = values.slice(Math.floor(values.length / 2));
      const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
      const changePercent = ((secondAvg - firstAvg) / firstAvg) * 100;

      if (changePercent > 5) trend = 'increasing';
      else if (changePercent < -5) trend = 'decreasing';
    }

    res.json({
      metric,
      unit: metric === 'calories' ? 'kcal' : 'g',
      range,
      data_points: dataPoints,
      trend,
      average,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
