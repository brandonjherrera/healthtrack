const express = require('express');
const router = express.Router();
const { query, getClient } = require('../config/database');
const { validateMealInput, validateDateParam } = require('../utils/validation');
const { formatMealResponse, calculateTotals } = require('../utils/formatting');

// POST /api/v1/meals — Log a new meal with items
router.post('/', async (req, res, next) => {
  try {
    validateMealInput(req.body);

    const { meal_type, logged_at, notes, source, client_ref, items } = req.body;
    const client = await getClient();

    try {
      await client.query('BEGIN');

      // Insert meal
      const mealResult = await client.query(
        `INSERT INTO meals (user_id, meal_type, logged_at, notes, source, client_ref)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [req.userId, meal_type, logged_at, notes || null, source || 'app', client_ref || null]
      );

      const meal = mealResult.rows[0];

      // Insert meal items
      const insertedItems = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const itemResult = await client.query(
          `INSERT INTO meal_items 
           (meal_id, food_library_id, food_name, quantity, unit, 
            calories, protein_g, carbs_g, fat_g, fiber_g, sodium_mg, sugar_g,
            confidence_score, data_source, verified, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
           RETURNING *`,
          [
            meal.id, item.food_library_id || null, item.food_name, item.quantity, item.unit,
            item.calories, item.protein_g, item.carbs_g, item.fat_g,
            item.fiber_g || null, item.sodium_mg || null, item.sugar_g || null,
            item.confidence_score || null, item.data_source || 'manual', item.verified || false, i,
          ]
        );
        insertedItems.push(itemResult.rows[0]);

        // Update food library use_count if linked
        if (item.food_library_id) {
          await client.query(
            `UPDATE food_library SET use_count = use_count + 1, last_used_at = NOW() WHERE id = $1`,
            [item.food_library_id]
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

// GET /api/v1/meals — List meals with optional filters
router.get('/', async (req, res, next) => {
  try {
    const { date, start_date, end_date, meal_type, source } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = parseInt(req.query.offset) || 0;

    let whereClause = 'WHERE m.user_id = $1';
    const params = [req.userId];
    let paramIndex = 2;

    if (date) {
      validateDateParam(date);
      whereClause += ` AND DATE(m.logged_at AT TIME ZONE (SELECT timezone FROM users WHERE id = $1)) = $${paramIndex}`;
      params.push(date);
      paramIndex++;
    } else {
      if (start_date) {
        validateDateParam(start_date);
        whereClause += ` AND DATE(m.logged_at AT TIME ZONE (SELECT timezone FROM users WHERE id = $1)) >= $${paramIndex}`;
        params.push(start_date);
        paramIndex++;
      }
      if (end_date) {
        validateDateParam(end_date);
        whereClause += ` AND DATE(m.logged_at AT TIME ZONE (SELECT timezone FROM users WHERE id = $1)) <= $${paramIndex}`;
        params.push(end_date);
        paramIndex++;
      }
    }

    if (meal_type) {
      whereClause += ` AND m.meal_type = $${paramIndex}`;
      params.push(meal_type);
      paramIndex++;
    }

    if (source) {
      whereClause += ` AND m.source = $${paramIndex}`;
      params.push(source);
      paramIndex++;
    }

    // Get meals
    const mealsResult = await query(
      `SELECT m.* FROM meals m ${whereClause} 
       ORDER BY m.logged_at DESC 
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    // Get items for all returned meals
    const meals = [];
    let allItems = [];

    if (mealsResult.rows.length > 0) {
      const mealIds = mealsResult.rows.map((m) => m.id);
      const itemsResult = await query(
        `SELECT * FROM meal_items WHERE meal_id = ANY($1) ORDER BY sort_order`,
        [mealIds]
      );

      const itemsByMeal = {};
      for (const item of itemsResult.rows) {
        if (!itemsByMeal[item.meal_id]) itemsByMeal[item.meal_id] = [];
        itemsByMeal[item.meal_id].push(item);
      }

      for (const meal of mealsResult.rows) {
        const mealItems = itemsByMeal[meal.id] || [];
        meals.push(formatMealResponse(meal, mealItems));
        allItems = allItems.concat(mealItems);
      }
    }

    res.json({
      meals,
      count: meals.length,
      daily_totals: calculateTotals(allItems),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/meals/:id — Single meal with items
router.get('/:id', async (req, res, next) => {
  try {
    const mealResult = await query(
      'SELECT * FROM meals WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    );

    if (mealResult.rows.length === 0) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Meal not found' },
      });
    }

    const itemsResult = await query(
      'SELECT * FROM meal_items WHERE meal_id = $1 ORDER BY sort_order',
      [req.params.id]
    );

    res.json(formatMealResponse(mealResult.rows[0], itemsResult.rows));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/meals/:id — Update a meal
router.put('/:id', async (req, res, next) => {
  try {
    const { meal_type, logged_at, notes } = req.body;

    const existing = await query(
      'SELECT * FROM meals WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Meal not found' },
      });
    }

    const result = await query(
      `UPDATE meals SET
        meal_type = COALESCE($1, meal_type),
        logged_at = COALESCE($2, logged_at),
        notes = COALESCE($3, notes)
       WHERE id = $4 AND user_id = $5
       RETURNING *`,
      [meal_type, logged_at, notes, req.params.id, req.userId]
    );

    const itemsResult = await query(
      'SELECT * FROM meal_items WHERE meal_id = $1 ORDER BY sort_order',
      [req.params.id]
    );

    res.json(formatMealResponse(result.rows[0], itemsResult.rows));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/meals/:id — Delete a meal and its items
router.delete('/:id', async (req, res, next) => {
  try {
    const result = await query(
      'DELETE FROM meals WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Meal not found' },
      });
    }

    res.json({ deleted: true, id: result.rows[0].id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
