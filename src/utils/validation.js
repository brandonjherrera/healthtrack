const VALID_MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'];
const VALID_SOURCES = ['app', 'openclaw', 'agent', 'import'];
const VALID_DATA_SOURCES = ['manual', 'ai_estimate', 'usda', 'openfoodfacts', 'library', 'barcode_scan'];
const VALID_UNITS = ['g', 'oz', 'cup', 'tbsp', 'tsp', 'ml', 'l', 'each', 'slice', 'piece', 'serving', 'scoop', 'lb', 'kg'];
const VALID_HEALTH_SOURCES = ['whoop', 'apple_health', 'manual', 'garmin', 'oura', 'custom'];

function validationError(message, details = null) {
  const err = new Error(message);
  err.type = 'VALIDATION_ERROR';
  err.details = details;
  return err;
}

function validateMealInput(body) {
  if (!body.meal_type || !VALID_MEAL_TYPES.includes(body.meal_type)) {
    throw validationError(
      `meal_type must be one of: ${VALID_MEAL_TYPES.join(', ')}`
    );
  }

  if (!body.logged_at) {
    throw validationError('logged_at is required (ISO 8601 datetime)');
  }

  const loggedAt = new Date(body.logged_at);
  if (isNaN(loggedAt.getTime())) {
    throw validationError('logged_at must be a valid ISO 8601 datetime');
  }

  if (body.source && !VALID_SOURCES.includes(body.source)) {
    throw validationError(
      `source must be one of: ${VALID_SOURCES.join(', ')}`
    );
  }

  if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
    throw validationError('items must be a non-empty array of food items');
  }

  body.items.forEach((item, index) => {
    validateMealItemInput(item, index);
  });
}

function validateMealItemInput(item, index) {
  const prefix = `items[${index}]`;

  if (!item.food_name || typeof item.food_name !== 'string') {
    throw validationError(`${prefix}.food_name is required`);
  }

  if (typeof item.quantity !== 'number' || item.quantity <= 0) {
    throw validationError(`${prefix}.quantity must be a positive number`);
  }

  if (!item.unit || !VALID_UNITS.includes(item.unit)) {
    throw validationError(
      `${prefix}.unit must be one of: ${VALID_UNITS.join(', ')}`
    );
  }

  if (typeof item.calories !== 'number' || item.calories < 0) {
    throw validationError(`${prefix}.calories must be a non-negative number`);
  }

  if (typeof item.protein_g !== 'number' || item.protein_g < 0) {
    throw validationError(`${prefix}.protein_g must be a non-negative number`);
  }

  if (typeof item.carbs_g !== 'number' || item.carbs_g < 0) {
    throw validationError(`${prefix}.carbs_g must be a non-negative number`);
  }

  if (typeof item.fat_g !== 'number' || item.fat_g < 0) {
    throw validationError(`${prefix}.fat_g must be a non-negative number`);
  }

  if (item.data_source && !VALID_DATA_SOURCES.includes(item.data_source)) {
    throw validationError(
      `${prefix}.data_source must be one of: ${VALID_DATA_SOURCES.join(', ')}`
    );
  }
}

function validateGoalInput(body) {
  if (!body.effective_date) {
    throw validationError('effective_date is required (YYYY-MM-DD)');
  }

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(body.effective_date)) {
    throw validationError('effective_date must be in YYYY-MM-DD format');
  }

  const requiredFields = ['calories_target', 'protein_g_target', 'carbs_g_target', 'fat_g_target'];
  for (const field of requiredFields) {
    if (typeof body[field] !== 'number' || body[field] < 0) {
      throw validationError(`${field} must be a non-negative number`);
    }
  }
}

function validateDateParam(dateStr) {
  if (!dateStr) return null;
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dateStr)) {
    throw validationError('Date must be in YYYY-MM-DD format');
  }
  return dateStr;
}

function validateBarcode(code) {
  // UPC-A: 12 digits, EAN-13: 13 digits, EAN-8: 8 digits
  const barcodeRegex = /^\d{8}$|^\d{12,13}$/;
  if (!barcodeRegex.test(code)) {
    throw validationError('Barcode must be 8 (EAN-8), 12 (UPC-A), or 13 (EAN-13) digits');
  }
  return code;
}

module.exports = {
  validationError,
  validateMealInput,
  validateMealItemInput,
  validateGoalInput,
  validateDateParam,
  validateBarcode,
  VALID_MEAL_TYPES,
  VALID_SOURCES,
  VALID_DATA_SOURCES,
  VALID_UNITS,
  VALID_HEALTH_SOURCES,
};
