const bcrypt = require('bcrypt');
const { query } = require('../config/database');

async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Missing or malformed Authorization header. Expected: Bearer <api_key>',
      },
    });
  }

  const apiKey = authHeader.slice(7);

  try {
    // Fetch all active keys for comparison
    // For single-user this is 2-3 keys max, so bcrypt comparison is fine
    const result = await query(
      'SELECT id, user_id, key_hash, label FROM api_keys WHERE is_active = TRUE'
    );

    let matchedKey = null;

    for (const row of result.rows) {
      const isMatch = await bcrypt.compare(apiKey, row.key_hash);
      if (isMatch) {
        matchedKey = row;
        break;
      }
    }

    if (!matchedKey) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid API key',
        },
      });
    }

    // Attach user context to request
    req.userId = matchedKey.user_id;
    req.apiKeyId = matchedKey.id;
    req.apiKeyLabel = matchedKey.label;

    // Update last_used_at (fire and forget — don't block the request)
    query(
      'UPDATE api_keys SET last_used_at = NOW() WHERE id = $1',
      [matchedKey.id]
    ).catch((err) => console.error('Failed to update api_key last_used_at:', err));

    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    return res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Authentication failed due to server error',
      },
    });
  }
}

module.exports = { authenticate };
