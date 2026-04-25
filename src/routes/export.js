const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { validateDateParam } = require('../utils/validation');

// GET /api/v1/export — Export nutrition data
router.get('/', async (req, res, next) => {
  try {
    const format = req.query.format || 'json';
    const startDate = validateDateParam(req.query.start_date);
    const endDate = validateDateParam(req.query.end_date);
    const include = (req.query.include || 'meals,foods,goals').split(',');

    const exportData = {};

    if (include.includes('meals')) {
      let mealsQuery = `
        SELECT m.*, json_agg(
          json_build_object(
            'food_name', mi.food_name,
            'quantity', mi.quantity,
            'unit', mi.unit,
            'calories', mi.calories,
            'protein_g', mi.protein_g,
            'carbs_g', mi.carbs_g,
            'fat_g', mi.fat_g
          ) ORDER BY mi.sort_order
        ) as items
        FROM meals m
        LEFT JOIN meal_items mi ON mi.meal_id = m.id
        WHERE m.user_id = $1`;

      const params = [req.userId];
      let paramIndex = 2;

      if (startDate) {
        mealsQuery += ` AND m.logged_at >= $${paramIndex}`;
        params.push(startDate);
        paramIndex++;
      }
      if (endDate) {
        mealsQuery += ` AND m.logged_at <= $${paramIndex}::date + interval '1 day'`;
        params.push(endDate);
        paramIndex++;
      }

      mealsQuery += ' GROUP BY m.id ORDER BY m.logged_at DESC';

      const result = await query(mealsQuery, params);
      exportData.meals = result.rows;
    }

    if (include.includes('foods')) {
      const result = await query(
        'SELECT * FROM food_library WHERE user_id = $1 ORDER BY food_name',
        [req.userId]
      );
      exportData.foods = result.rows;
    }

    if (include.includes('goals')) {
      const result = await query(
        'SELECT * FROM daily_goals WHERE user_id = $1 ORDER BY effective_date DESC',
        [req.userId]
      );
      exportData.goals = result.rows;
    }

    if (include.includes('health')) {
      const result = await query(
        'SELECT * FROM health_data WHERE user_id = $1 ORDER BY recorded_at DESC',
        [req.userId]
      );
      exportData.health = result.rows;
    }

    if (format === 'csv') {
      // Simple CSV export for meals — flatten items
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=healthtrack_export.csv');

      const rows = [];
      rows.push('date,meal_type,food_name,quantity,unit,calories,protein_g,carbs_g,fat_g');

      if (exportData.meals) {
        for (const meal of exportData.meals) {
          for (const item of meal.items) {
            if (item.food_name) {
              const date = new Date(meal.logged_at).toISOString().split('T')[0];
              rows.push(
                `${date},${meal.meal_type},${item.food_name},${item.quantity},${item.unit},${item.calories},${item.protein_g},${item.carbs_g},${item.fat_g}`
              );
            }
          }
        }
      }

      return res.send(rows.join('\n'));
    }

    // Default: JSON export
    res.json({
      exported_at: new Date().toISOString(),
      filters: { start_date: startDate, end_date: endDate, include },
      data: exportData,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
