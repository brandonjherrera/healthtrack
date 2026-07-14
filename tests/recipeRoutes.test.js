const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const database = require('../src/config/database');
const originalQuery = database.query;
const originalGetClient = database.getClient;

afterEach(() => {
  database.query = originalQuery;
  database.getClient = originalGetClient;
  delete require.cache[require.resolve('../src/routes/recipes')];
});

function loadRecipesRouterWithDbStubs() {
  const calls = [];
  let getClientCalled = false;

  database.query = (text, params) => {
    calls.push({ text, params });
    return Promise.resolve({ rows: [{ id: 'recipe-1' }] });
  };
  database.getClient = () => {
    getClientCalled = true;
    throw new Error('getClient should not be called for invalid PUT bodies');
  };

  delete require.cache[require.resolve('../src/routes/recipes')];

  return {
    router: require('../src/routes/recipes'),
    calls,
    wasGetClientCalled: () => getClientCalled,
  };
}

async function invokePut(router, body) {
  const layer = router.stack.find(
    (entry) => entry.route?.path === '/:id' && entry.route.methods.put
  );
  assert.ok(layer, 'PUT /:id route not found');

  const handler = layer.route.stack[0].handle;
  const req = { body, params: { id: 'recipe-1' }, userId: 'user-1' };
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

  let routeError;
  await handler(req, res, (err) => {
    routeError = err;
  });

  return { status: res.statusCode, data: res.body, error: routeError };
}

describe('recipe routes', () => {
  it('requires ingredients on PUT because recipes are fully replaced', async () => {
    const { router, calls, wasGetClientCalled } = loadRecipesRouterWithDbStubs();

    const { error } = await invokePut(router, {
      name: 'Updated Recipe',
      servings: 2,
    });

    assert.equal(error.type, 'VALIDATION_ERROR');
    assert.match(error.message, /ingredients must be a non-empty array/);
    assert.equal(calls.length, 1);
    assert.equal(wasGetClientCalled(), false);
  });
});
