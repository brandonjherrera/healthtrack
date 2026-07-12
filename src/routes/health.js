const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { validateDateParam, VALID_HEALTH_SOURCES } = require('../utils/validation');

// POST /api/v1/health — Log a health metric
router.post('/', async (req, res, next) => {
  try {
    const { source, data_type, value, unit, recorded_at, metadata } = req.body;

    if (!source || !VALID_HEALTH_SOURCES.includes(source)) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: `source must be one of: ${VALID_HEALTH_SOURCES.join(', ')}`,
        },
      });
    }

    if (!data_type || value === undefined || value === null || !unit || !recorded_at) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'data_type, value, unit, and recorded_at are required',
        },
      });
    }

    const result = await query(
      `INSERT INTO health_data (user_id, source, data_type, value, unit, recorded_at, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [req.userId, source, data_type, value, unit, recorded_at, metadata || {}]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/health — Query health data
router.get('/', async (req, res, next) => {
  try {
    const { data_type, source, start_date, end_date } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);

    let whereClause = 'WHERE user_id = $1';
    const params = [req.userId];
    let paramIndex = 2;

    if (data_type) {
      whereClause += ` AND data_type = $${paramIndex}`;
      params.push(data_type);
      paramIndex++;
    }

    if (source) {
      whereClause += ` AND source = $${paramIndex}`;
      params.push(source);
      paramIndex++;
    }

    if (start_date) {
      validateDateParam(start_date);
      whereClause += ` AND recorded_at >= $${paramIndex}`;
      params.push(start_date);
      paramIndex++;
    }

    if (end_date) {
      validateDateParam(end_date);
      whereClause += ` AND recorded_at <= $${paramIndex}::date + interval '1 day'`;
      params.push(end_date);
      paramIndex++;
    }

    const result = await query(
      `SELECT * FROM health_data ${whereClause}
       ORDER BY recorded_at DESC
       LIMIT $${paramIndex}`,
      [...params, limit]
    );

    res.json({ data: result.rows, count: result.rows.length });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
