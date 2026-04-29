const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  calculateTotals,
  calculateProgress,
  round,
} = require('../src/utils/formatting');

// --- round ---

describe('round', () => {
  it('rounds to 0 decimals', () => {
    assert.equal(round(1.5, 0), 2);
    assert.equal(round(1.4, 0), 1);
  });

  it('rounds to 1 decimal', () => {
    assert.equal(round(1.25, 1), 1.3);
    assert.equal(round(1.24, 1), 1.2);
  });

  it('handles whole numbers', () => {
    assert.equal(round(10, 1), 10);
  });
});

// --- calculateTotals ---

describe('calculateTotals', () => {
  it('returns zeros for empty items', () => {
    const totals = calculateTotals([]);
    assert.equal(totals.calories, 0);
    assert.equal(totals.protein_g, 0);
    assert.equal(totals.carbs_g, 0);
    assert.equal(totals.fat_g, 0);
    assert.equal(totals.fiber_g, 0);
    assert.equal(totals.sodium_mg, 0);
    assert.equal(totals.sugar_g, 0);
  });

  it('sums a single item', () => {
    const totals = calculateTotals([{
      calories: 200, protein_g: 15, carbs_g: 20, fat_g: 8,
      fiber_g: 3, sodium_mg: 150, sugar_g: 5,
    }]);
    assert.equal(totals.calories, 200);
    assert.equal(totals.protein_g, 15);
    assert.equal(totals.carbs_g, 20);
    assert.equal(totals.fat_g, 8);
    assert.equal(totals.fiber_g, 3);
    assert.equal(totals.sodium_mg, 150);
    assert.equal(totals.sugar_g, 5);
  });

  it('sums multiple items', () => {
    const items = [
      { calories: 200, protein_g: 15, carbs_g: 20, fat_g: 8, fiber_g: 3, sodium_mg: 100, sugar_g: 5 },
      { calories: 300, protein_g: 25, carbs_g: 30, fat_g: 12, fiber_g: 2, sodium_mg: 200, sugar_g: 8 },
    ];
    const totals = calculateTotals(items);
    assert.equal(totals.calories, 500);
    assert.equal(totals.protein_g, 40);
    assert.equal(totals.carbs_g, 50);
    assert.equal(totals.fat_g, 20);
    assert.equal(totals.fiber_g, 5);
    assert.equal(totals.sodium_mg, 300);
    assert.equal(totals.sugar_g, 13);
  });

  it('treats null/undefined optional fields as 0', () => {
    const totals = calculateTotals([{
      calories: 100, protein_g: 10, carbs_g: 10, fat_g: 5,
      fiber_g: null, sodium_mg: undefined, sugar_g: null,
    }]);
    assert.equal(totals.fiber_g, 0);
    assert.equal(totals.sodium_mg, 0);
    assert.equal(totals.sugar_g, 0);
  });

  it('coerces string numbers from DB', () => {
    const totals = calculateTotals([{
      calories: '350', protein_g: '30', carbs_g: '40', fat_g: '12',
    }]);
    assert.equal(totals.calories, 350);
    assert.equal(totals.protein_g, 30);
  });
});

// --- calculateProgress ---

describe('calculateProgress', () => {
  it('returns null when no goals set', () => {
    const totals = { calories: 1000, protein_g: 80, carbs_g: 120, fat_g: 40 };
    assert.equal(calculateProgress(totals, null), null);
  });

  it('calculates correct percentages', () => {
    const totals = { calories: 1000, protein_g: 75, carbs_g: 100, fat_g: 35 };
    const goals = {
      calories_target: 2000,
      protein_g_target: 150,
      carbs_g_target: 200,
      fat_g_target: 70,
    };
    const result = calculateProgress(totals, goals);
    assert.equal(result.progress.calories_pct, 50);
    assert.equal(result.progress.protein_pct, 50);
    assert.equal(result.progress.carbs_pct, 50);
    assert.equal(result.progress.fat_pct, 50);
  });

  it('calculates remaining correctly', () => {
    const totals = { calories: 1500, protein_g: 100, carbs_g: 150, fat_g: 50 };
    const goals = {
      calories_target: 2000,
      protein_g_target: 150,
      carbs_g_target: 200,
      fat_g_target: 70,
    };
    const result = calculateProgress(totals, goals);
    assert.equal(result.remaining.calories, 500);
    assert.equal(result.remaining.protein_g, 50);
    assert.equal(result.remaining.carbs_g, 50);
    assert.equal(result.remaining.fat_g, 20);
  });

  it('clamps remaining to 0 when over goal', () => {
    const totals = { calories: 2500, protein_g: 200, carbs_g: 250, fat_g: 90 };
    const goals = {
      calories_target: 2000,
      protein_g_target: 150,
      carbs_g_target: 200,
      fat_g_target: 70,
    };
    const result = calculateProgress(totals, goals);
    assert.equal(result.remaining.calories, 0);
    assert.equal(result.remaining.protein_g, 0);
  });
});
