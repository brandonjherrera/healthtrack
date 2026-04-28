const bcrypt = require('bcrypt');
const { query } = require('../config/database');

// Cache validated keys for 5 minutes to avoid bcrypt on every request.
// Map<rawKey, { userId, apiKeyId, label, expiresAt }>
const keyCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

function getCached(rawKey) {
  const entry = keyCache.get(rawKey);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    keyCache.delete(rawKey);
    return null;
  }
  return entry;
}

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

  // Fast path — cache hit
  const cached = getCached(apiKey);
  if (cached) {
    req.userId = cached.userId;
    req.apiKeyId = cached.apiKeyId;
    req.apiKeyLabel = cached.label;
    return next();
  }

  try {
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

    // Cache for next requests
    keyCache.set(apiKey, {
      userId: matchedKey.user_id,
      apiKeyId: matchedKey.id,
      label: matchedKey.label,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    req.userId = matchedKey.user_id;
    req.apiKeyId = matchedKey.id;
    req.apiKeyLabel = matchedKey.label;

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
