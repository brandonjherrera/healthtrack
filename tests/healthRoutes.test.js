const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const database = require('../src/config/database');
const originalQuery = database.query;

afterEach(() => {
  database.query = originalQuery;
  delete require.cache[require.resolve('../src/routes/health')];
});

function loadHealthRouterWithQueryStub(response) {
  const calls = [];

  database.query = (text, params) => {
    calls.push({ text, params });
    return Promise.resolve(response);
  };

  delete require.cache[require.resolve('../src/routes/health')];

  return {
    router: require('../src/routes/health'),
    calls,
  };
}

async function invokePost(router, body) {
  const layer = router.stack.find(
    (entry) => entry.route?.path === '/' && entry.route.methods.post
  );
  assert.ok(layer, 'POST / route not found');

  const handler = layer.route.stack[0].handle;
  const req = { body, userId: 'user-1' };
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(bodyValue) {
      this.body = bodyValue;
      return this;
    },
  };

  await handler(req, res, (err) => {
    if (err) throw err;
  });

  return { status: res.statusCode, data: res.body };
}

describe('health routes', () => {
  it('accepts zero as a valid health metric value', async () => {
    const inserted = {
      id: 'metric-1',
      user_id: 'user-1',
      source: 'manual',
      data_type: 'steps',
      value: 0,
      unit: 'count',
      recorded_at: '2026-07-11T10:00:00.000Z',
      metadata: {},
    };
    const { router, calls } = loadHealthRouterWithQueryStub({ rows: [inserted] });

    const { status, data } = await invokePost(router, {
      source: 'manual',
      data_type: 'steps',
      value: 0,
      unit: 'count',
      recorded_at: '2026-07-11T10:00:00.000Z',
    });

    assert.equal(status, 201);
    assert.equal(data.value, 0);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].params.slice(0, 6), [
      'user-1',
      'manual',
      'steps',
      0,
      'count',
      '2026-07-11T10:00:00.000Z',
    ]);
  });
});
