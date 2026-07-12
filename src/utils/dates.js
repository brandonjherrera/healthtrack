const { query } = require('../config/database');

function formatDateOnly(value) {
  if (typeof value === 'string') {
    return value.slice(0, 10);
  }

  return value.toISOString().split('T')[0];
}

async function getUserLocalToday(userId) {
  const result = await query(
    `SELECT (CURRENT_TIMESTAMP AT TIME ZONE timezone)::date AS today
     FROM users
     WHERE id = $1`,
    [userId]
  );

  return formatDateOnly(result.rows[0].today);
}

module.exports = {
  formatDateOnly,
  getUserLocalToday,
};
