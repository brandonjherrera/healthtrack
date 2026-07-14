const express = require('express');
const multer = require('multer');
const router = express.Router();
const { analyzePhoto } = require('../services/aiVision');

const upload = multer({ storage: multer.memoryStorage() });

// POST /api/v1/meals/scan — AI food photo analysis
// Accepts base64-encoded image in JSON body or multipart/form-data
// Returns estimated food items ready to pass into POST /api/v1/meals
router.post('/', upload.single('image'), async (req, res, next) => {
  try {
    let imageBase64;
    let mimeType = 'image/jpeg';

    // Support two input formats:
    // 1. JSON body: { "image": "<base64>", "mime_type": "image/jpeg" }
    // 2. multipart/form-data with file field named "image"
    if (req.file) {
      imageBase64 = req.file.buffer.toString('base64');
      if (req.file.mimetype) mimeType = req.file.mimetype;
    } else if (req.body && req.body.image) {
      imageBase64 = req.body.image;
      if (req.body.mime_type) mimeType = req.body.mime_type;
    } else {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request must include an "image" field containing a base64-encoded photo or multipart image file.',
          example: { image: '<base64_string>', mime_type: 'image/jpeg' },
        },
      });
    }

    // Strip data URL prefix if present (e.g. "data:image/jpeg;base64,...")
    const base64Match = imageBase64.match(/^data:([^;]+);base64,(.+)$/);
    if (base64Match) {
      mimeType = base64Match[1];
      imageBase64 = base64Match[2];
    }

    const result = await analyzePhoto(imageBase64, mimeType);

    res.json({
      scan_result: result,
      _note: 'Review items before logging. Use POST /api/v1/meals with source: "scan" to save.',
    });
  } catch (err) {
    if (err.message && err.message.includes('ANTHROPIC_API_KEY')) {
      return res.status(503).json({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'AI vision service is not configured. Set ANTHROPIC_API_KEY in your .env file.',
        },
      });
    }
    next(err);
  }
});

module.exports = router;
