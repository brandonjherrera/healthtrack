function errorHandler(err, req, res, next) {
  console.error(`[${new Date().toISOString()}] Error:`, err);

  // Validation errors (thrown manually in routes)
  if (err.type === 'VALIDATION_ERROR') {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: err.message,
        details: err.details || null,
      },
    });
  }

  // Multer file upload errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'File too large. Maximum size is 10MB.',
      },
    });
  }

  // PostgreSQL unique constraint violations (e.g. duplicate client_ref)
  if (err.code === '23505') {
    return res.status(409).json({
      error: {
        code: 'CONFLICT',
        message: 'A record with this identifier already exists',
        details: { constraint: err.constraint },
      },
    });
  }

  // PostgreSQL foreign key violations
  if (err.code === '23503') {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Referenced record does not exist',
        details: { constraint: err.constraint },
      },
    });
  }

  // Default server error
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: process.env.NODE_ENV === 'development'
        ? err.message
        : 'An unexpected error occurred',
    },
  });
}

module.exports = { errorHandler };
