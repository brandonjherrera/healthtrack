const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { validateBarcode } = require('../utils/validation');
const { searchOpenFoodFacts, searchUSDA } = require('../services/barcodeLookup');

// GET /api/v1/foods — Search personal food library
router.get('/', async (req, res, next) => {
  try {
    const searchTerm = req.query.q || '';
    const tags = req.query.tags ? req.query.tags.split(',') : null;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);

    let whereClause = 'WHERE user_id = $1';
    const params = [req.userId];
    let paramIndex = 2;

    if (searchTerm) {
      whereClause += ` AND (food_name ILIKE $${paramIndex} OR brand ILIKE $${paramIndex})`;
      params.push(`%${searchTerm}%`);
      paramIndex++;
    }

    if (tags) {
      whereClause += ` AND tags && $${paramIndex}`;
      params.push(tags);
      paramIndex++;
    }

    const result = await query(
      `SELECT * FROM food_library ${whereClause}
       ORDER BY use_count DESC, food_name ASC
       LIMIT $${paramIndex}`,
      [...params, limit]
    );

    res.json({ foods: result.rows, count: result.rows.length });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/foods/frequent — Most-used foods
router.get('/frequent', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 30);

    const result = await query(
      `SELECT * FROM food_library
       WHERE user_id = $1 AND use_count > 0
       ORDER BY use_count DESC
       LIMIT $2`,
      [req.userId, limit]
    );

    res.json({ foods: result.rows, count: result.rows.length });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/foods/barcode/:code — Barcode lookup
router.get('/barcode/:code', async (req, res, next) => {
  try {
    const barcode = validateBarcode(req.params.code);

    // Step 1: Check local food library first
    const localResult = await query(
      'SELECT * FROM food_library WHERE barcode = $1 AND user_id = $2',
      [barcode, req.userId]
    );

    if (localResult.rows.length > 0) {
      return res.json({
        barcode,
        found_in: 'library',
        in_library: true,
        product: localResult.rows[0],
      });
    }

    // Step 2: Check Open Food Facts (free, no key required)
    const offResult = await searchOpenFoodFacts(barcode);
    if (offResult) {
      return res.json({ barcode, found_in: 'openfoodfacts', in_library: false, product: offResult });
    }

    // Step 3: Check USDA FoodData Central (requires USDA_API_KEY in .env)
    const usdaResult = await searchUSDA(barcode);
    if (usdaResult) {
      return res.json({ barcode, found_in: 'usda', in_library: false, product: usdaResult });
    }

    res.status(404).json({
      barcode,
      found_in: null,
      suggestion: 'Product not found in local library, Open Food Facts, or USDA. Add it manually via POST /api/v1/foods.',
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/foods — Add a custom food to library
router.post('/', async (req, res, next) => {
  try {
    const {
      food_name, brand, default_quantity, default_unit,
      calories, protein_g, carbs_g, fat_g,
      fiber_g, sodium_mg, sugar_g,
      barcode, usda_fdc_id, openfoodfacts_id,
      tags,
    } = req.body;

    if (!food_name || !default_quantity || !default_unit) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'food_name, default_quantity, and default_unit are required',
        },
      });
    }

    const result = await query(
      `INSERT INTO food_library 
       (user_id, food_name, brand, default_quantity, default_unit,
        calories, protein_g, carbs_g, fat_g, fiber_g, sodium_mg, sugar_g,
        barcode, usda_fdc_id, openfoodfacts_id, is_custom, tags)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       RETURNING *`,
      [
        req.userId, food_name, brand || null, default_quantity, default_unit,
        calories, protein_g, carbs_g, fat_g,
        fiber_g || null, sodium_mg || null, sugar_g || null,
        barcode || null, usda_fdc_id || null, openfoodfacts_id || null,
        true, tags || null,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
