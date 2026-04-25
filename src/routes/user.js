const express = require('express');
const router = express.Router();
const { query } = require('../config/database');

// GET /api/v1/user/profile
router.get('/profile', async (req, res, next) => {
  try {
    const result = await query(
      'SELECT id, email, name, timezone, preferences, created_at, updated_at FROM users WHERE id = $1',
      [req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'User not found' },
      });
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/user/profile
router.put('/profile', async (req, res, next) => {
  try {
    const { name, timezone, preferences } = req.body;

    const result = await query(
      `UPDATE users SET
        name = COALESCE($1, name),
        timezone = COALESCE($2, timezone),
        preferences = COALESCE($3, preferences)
       WHERE id = $4
       RETURNING id, email, name, timezone, preferences, created_at, updated_at`,
      [name, timezone, preferences, req.userId]
    );

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
