#!/usr/bin/env node

// Seed the single-user HealthTrack profile and initial nutrition goals.
// Usage: npm run seed

require('dotenv').config();
const { Pool } = require('pg');

function numberFromEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;

  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`${name} must be a number`);
  }

  return parsed;
}

async function seed() {
  const email = process.env.SEED_USER_EMAIL;
  const name = process.env.SEED_USER_NAME;
  const timezone = process.env.SEED_USER_TIMEZONE || 'America/Chicago';
  const effectiveDate = process.env.SEED_GOAL_EFFECTIVE_DATE
    || new Date().toISOString().split('T')[0];

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required.');
    process.exit(1);
  }

  if (!email || !name) {
    console.error('SEED_USER_EMAIL and SEED_USER_NAME are required.');
    console.error('Add them to .env, then run npm run seed again.');
    process.exit(1);
  }

  const goals = {
    calories_target: numberFromEnv('SEED_CALORIES_TARGET', 2500),
    protein_g_target: numberFromEnv('SEED_PROTEIN_G_TARGET', 200),
    carbs_g_target: numberFromEnv('SEED_CARBS_G_TARGET', 250),
    fat_g_target: numberFromEnv('SEED_FAT_G_TARGET', 80),
    fiber_g_target: numberFromEnv('SEED_FIBER_G_TARGET', 30),
  };

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const preferences = {
    units: process.env.SEED_UNITS || 'imperial',
    dark_mode: true,
    macro_colors: {
      protein: '#3B82F6',
      carbs: '#F59E0B',
      fat: '#F43F5E',
    },
    notifications: {
      morning_briefing: true,
      evening_reminder: true,
      weekly_summary: true,
    },
  };

  try {
    await pool.query('BEGIN');

    const userResult = await pool.query(
      `INSERT INTO users (email, name, timezone, preferences)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET
        name = EXCLUDED.name,
        timezone = EXCLUDED.timezone,
        preferences = EXCLUDED.preferences
       RETURNING id, email`,
      [email, name, timezone, preferences]
    );

    const user = userResult.rows[0];

    await pool.query(
      `INSERT INTO daily_goals
       (user_id, effective_date, calories_target, protein_g_target, carbs_g_target,
        fat_g_target, fiber_g_target, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id, effective_date) DO UPDATE SET
        calories_target = EXCLUDED.calories_target,
        protein_g_target = EXCLUDED.protein_g_target,
        carbs_g_target = EXCLUDED.carbs_g_target,
        fat_g_target = EXCLUDED.fat_g_target,
        fiber_g_target = EXCLUDED.fiber_g_target,
        notes = EXCLUDED.notes`,
      [
        user.id,
        effectiveDate,
        goals.calories_target,
        goals.protein_g_target,
        goals.carbs_g_target,
        goals.fat_g_target,
        goals.fiber_g_target,
        process.env.SEED_GOAL_NOTES || 'Initial targets',
      ]
    );

    await pool.query('COMMIT');

    console.log('\nSeed complete.');
    console.log(`  User: ${user.email}`);
    console.log(`  Goals effective: ${effectiveDate}`);
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('Seed failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seed();
