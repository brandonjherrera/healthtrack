const express = require('express');
const router = express.Router();
const { estimateFromText } = require('../services/macroEstimator');

// POST /api/v1/meals/estimate — Text description → structured macro estimate
// OpenClaw workflow: send plain-text description, get items ready for POST /meals
// Example body: { "description": "2 scrambled eggs, wheat toast with butter, black coffee" }
router.post('/', async (req, res, next) => {
  try {
    const { description } = req.body || {};

    if (!description || typeof description !== 'string' || description.trim().length === 0) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request body must include a non-empty "description" string.',
          example: { description: '2 scrambled eggs, wheat toast with butter, black coffee' },
        },
      });
    }

    if (description.length > 1000) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Description must be 1000 characters or fewer.',
        },
      });
    }

    const result = await estimateFromText(description.trim());

    res.json({
      description: description.trim(),
      estimate: result,
      _note: 'Review items, then log via POST /api/v1/meals with source: "openclaw".',
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
