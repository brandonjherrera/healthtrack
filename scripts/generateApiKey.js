#!/usr/bin/env node

// Generate a new API key for a client
// Usage: npm run generate-key -- --label pwa
//        npm run generate-key -- --label openclaw
//        npm run generate-key -- --label morning_agent

require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');

async function generateKey() {
  const args = process.argv.slice(2);
  const labelIndex = args.indexOf('--label');
  const label = labelIndex >= 0 ? args[labelIndex + 1] : 'default';

  if (!label) {
    console.error('Usage: npm run generate-key -- --label <label>');
    console.error('Example labels: pwa, openclaw, morning_agent');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // Get the first user (single-user setup)
    const userResult = await pool.query('SELECT id FROM users LIMIT 1');
    if (userResult.rows.length === 0) {
      console.error('No users found. Run the migration and seed first.');
      process.exit(1);
    }

    const userId = userResult.rows[0].id;

    // Generate a secure random key with a recognizable prefix
    const rawKey = `htk_${crypto.randomBytes(32).toString('hex')}`;
    const keyHash = await bcrypt.hash(rawKey, 12);

    await pool.query(
      'INSERT INTO api_keys (user_id, key_hash, label) VALUES ($1, $2, $3)',
      [userId, keyHash, label]
    );

    console.log('\n========================================');
    console.log('  API Key Generated Successfully');
    console.log('========================================');
    console.log(`  Label:  ${label}`);
    console.log(`  Key:    ${rawKey}`);
    console.log('========================================');
    console.log('\n⚠️  SAVE THIS KEY NOW. It will never be shown again.');
    console.log('   Add it to your .env or client config.\n');
  } catch (err) {
    console.error('Failed to generate key:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

generateKey();
