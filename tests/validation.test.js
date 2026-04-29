const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  validateMealInput,
  validateGoalInput,
  validateDateParam,
  validateBarcode,
  VALID_SOURCES,
  VALID_MEAL_TYPES,
  VALID_UNITS,
} = require('../src/utils/validation');

// --- validateMealInput ---

describe('validateMealInput', () => {
  const baseItem = {
    food_name: 'Eggs',
    quantity: 2,
    unit: 'each',
    calories: 140,
    protein_g: 12,
    carbs_g: 1,
    fat_g: 10,
  };

  const baseBody = {
    meal_type: 'breakfast',
    logged_at: new Date().toISOString(),
    source: 'openclaw',
    items: [baseItem],
  };

  it('accepts a valid meal', () => {
    assert.doesNotThrow(() => validateMealInput(baseBody));
  });

  it('rejects missing meal_type', () => {
    assert.throws(() => validateMealInput({ ...baseBody, meal_type: undefined }));
  });

  it('rejects invalid meal_type', () => {
    assert.throws(() => validateMealInput({ ...baseBody, meal_type: 'brunch' }));
  });

  it('rejects missing logged_at', () => {
    assert.throws(() => validateMealInput({ ...baseBody, logged_at: undefined }));
  });

  it('rejects invalid logged_at', () => {
    assert.throws(() => validateMealInput({ ...baseBody, logged_at: 'not-a-date' }));
  });

  it('rejects invalid source', () => {
    assert.throws(() => validateMealInput({ ...baseBody, source: 'unknown_client' }));
  });

  it('accepts source: scan', () => {
    assert.doesNotThrow(() => validateMealInput({ ...baseBody, source: 'scan' }));
  });

  it('accepts source: manual', () => {
    assert.doesNotThrow(() => validateMealInput({ ...baseBody, source: 'manual' }));
  });

  it('accepts source: openclaw', () => {
    assert.doesNotThrow(() => validateMealInput({ ...baseBody, source: 'openclaw' }));
  });

  it('accepts source: app', () => {
    assert.doesNotThrow(() => validateMealInput({ ...baseBody, source: 'app' }));
  });

  it('rejects empty items array', () => {
    assert.throws(() => validateMealInput({ ...baseBody, items: [] }));
  });

  it('rejects missing items', () => {
    assert.throws(() => validateMealInput({ ...baseBody, items: undefined }));
  });

  it('rejects item with missing food_name', () => {
    assert.throws(() => validateMealInput({
      ...baseBody,
      items: [{ ...baseItem, food_name: undefined }],
    }));
  });

  it('rejects item with invalid quantity', () => {
    assert.throws(() => validateMealInput({
      ...baseBody,
      items: [{ ...baseItem, quantity: -1 }],
    }));
  });

  it('rejects item with invalid unit', () => {
    assert.throws(() => validateMealInput({
      ...baseBody,
      items: [{ ...baseItem, unit: 'handful' }],
    }));
  });

  it('rejects item with negative calories', () => {
    assert.throws(() => validateMealInput({
      ...baseBody,
      items: [{ ...baseItem, calories: -10 }],
    }));
  });
});

// --- VALID_SOURCES whitelist ---

describe('VALID_SOURCES', () => {
  it('includes scan', () => {
    assert.ok(VALID_SOURCES.includes('scan'));
  });

  it('includes manual', () => {
    assert.ok(VALID_SOURCES.includes('manual'));
  });

  it('includes openclaw', () => {
    assert.ok(VALID_SOURCES.includes('openclaw'));
  });

  it('includes app', () => {
    assert.ok(VALID_SOURCES.includes('app'));
  });
});

// --- validateGoalInput ---

describe('validateGoalInput', () => {
  const baseGoal = {
    effective_date: '2026-04-28',
    calories_target: 2000,
    protein_g_target: 150,
    carbs_g_target: 200,
    fat_g_target: 70,
  };

  it('accepts a valid goal', () => {
    assert.doesNotThrow(() => validateGoalInput(baseGoal));
  });

  it('rejects missing effective_date', () => {
    assert.throws(() => validateGoalInput({ ...baseGoal, effective_date: undefined }));
  });

  it('rejects malformed effective_date', () => {
    assert.throws(() => validateGoalInput({ ...baseGoal, effective_date: '28-04-2026' }));
  });

  it('rejects non-numeric calories_target', () => {
    assert.throws(() => validateGoalInput({ ...baseGoal, calories_target: '2000' }));
  });

  it('rejects negative protein_g_target', () => {
    assert.throws(() => validateGoalInput({ ...baseGoal, protein_g_target: -10 }));
  });
});

// --- validateDateParam ---

describe('validateDateParam', () => {
  it('returns null for empty input', () => {
    assert.equal(validateDateParam(null), null);
    assert.equal(validateDateParam(undefined), null);
    assert.equal(validateDateParam(''), null);
  });

  it('accepts YYYY-MM-DD format', () => {
    assert.equal(validateDateParam('2026-04-28'), '2026-04-28');
  });

  it('rejects non-standard format', () => {
    assert.throws(() => validateDateParam('04/28/2026'));
    assert.throws(() => validateDateParam('2026/04/28'));
    assert.throws(() => validateDateParam('April 28 2026'));
  });
});

// --- validateBarcode ---

describe('validateBarcode', () => {
  it('accepts 12-digit UPC-A', () => {
    assert.equal(validateBarcode('012345678901'), '012345678901');
  });

  it('accepts 13-digit EAN-13', () => {
    assert.equal(validateBarcode('0123456789012'), '0123456789012');
  });

  it('accepts 8-digit EAN-8', () => {
    assert.equal(validateBarcode('01234567'), '01234567');
  });

  it('rejects non-numeric', () => {
    assert.throws(() => validateBarcode('ABCDEFGHIJKL'));
  });

  it('rejects wrong length', () => {
    assert.throws(() => validateBarcode('123'));
    assert.throws(() => validateBarcode('12345678901234'));
  });
});
