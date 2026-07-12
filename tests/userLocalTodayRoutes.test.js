const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const database = require('../src/config/database');
const originalQuery = database.query;

const routeModules = [
  '../src/routes/nutrition',
  '../src/routes/agentContext',
  '../src/utils/dates',
];

afterEach(() => {
  database.query = originalQuery;
  for (const modulePath of routeModules) {
    delete require.cache[require.resolve(modulePath)];
  }
});

function loadRouterWithQueryStub(modulePath, responses) {
  const calls = [];

  database.query = (text, params) => {
    calls.push({ text, params });
    const response = responses.shift();
    assert.ok(response, `Unexpected query: ${text}`);
    return Promise.resolve(typeof response === 'function' ? response(text, params) : response);
  };

  delete require.cache[require.resolve('../src/utils/dates')];
  delete require.cache[require.resolve(modulePath)];

  return {
    router: require(modulePath),
    calls,
  };
}

async function invokeGet(router, path, query = {}) {
  const layer = router.stack.find(
    (entry) => entry.route?.path === path && entry.route.methods.get
  );
  assert.ok(layer, `GET ${path} route not found`);

  const handler = layer.route.stack[0].handle;
  const req = { query, userId: 'user-1' };
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };

  await handler(req, res, (err) => {
    if (err) throw err;
  });

  return { status: res.statusCode, data: res.body };
}

describe('user-local today route behavior', () => {
  it('uses the database-derived user-local date for nutrition daily defaults', async () => {
    const { router, calls } = loadRouterWithQueryStub('../src/routes/nutrition', [
      { rows: [{ today: '2026-07-11' }] },
      { rows: [] },
      { rows: [] },
      { rows: [{ count: '0' }] },
    ]);

    const { status, data } = await invokeGet(router, '/daily');

    assert.equal(status, 200);
    assert.equal(data.date, '2026-07-11');
    assert.match(calls[0].text, /CURRENT_TIMESTAMP AT TIME ZONE timezone/);
    assert.deepEqual(calls[1].params, ['user-1', '2026-07-11']);
    assert.deepEqual(calls[3].params, ['user-1', '2026-07-11']);
  });

  it('counts all meals logged today in agent context, not just recent meals shown', async () => {
    const recentMeals = Array.from({ length: 5 }, (_, index) => ({
      id: `meal-${index + 1}`,
      meal_type: 'snack',
      logged_at: '2026-07-10T20:00:00.000Z',
      notes: null,
      photo_url: null,
      source: 'manual',
      created_at: '2026-07-10T20:00:00.000Z',
      updated_at: '2026-07-10T20:00:00.000Z',
    }));

    const { router, calls } = loadRouterWithQueryStub('../src/routes/agentContext', [
      { rows: [{ today: '2026-07-11' }] },
      { rows: [{ id: 'user-1', email: 'test@example.com', name: 'Test User', timezone: 'America/Chicago' }] },
      { rows: [] },
      { rows: [] },
      { rows: recentMeals },
      { rows: [{ count: '7' }] },
      { rows: [] },
    ]);

    const { status, data } = await invokeGet(router, '/');

    assert.equal(status, 200);
    assert.equal(data.today.date, '2026-07-11');
    assert.equal(data.today.meals_logged, 7);
    assert.equal(data.recent_meals.length, 5);
    assert.deepEqual(calls[5].params, ['user-1', '2026-07-11']);
  });
});
