const express = require('express');
const router = express.Router();

// POST /api/v1/meals/scan — AI food photo analysis
// TODO: Implement with Claude Sonnet 4.6 or GPT-4o vision
// This is a placeholder — the full implementation involves:
// 1. Receive photo (base64 or multipart upload)
// 2. Send to AI vision model with structured prompt
// 3. Parse response into food items with estimated macros
// 4. Cross-reference against USDA and Open Food Facts
// 5. Return structured analysis for user confirmation
router.post('/', async (req, res, next) => {
  try {
    res.status(501).json({
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'AI food scanning is not yet implemented. Use manual entry or barcode scanning.',
      },
      _dev_note: 'Implement in src/services/aiVision.js — needs ANTHROPIC_API_KEY or OPENAI_API_KEY configured',
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
