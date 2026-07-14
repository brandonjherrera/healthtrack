const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const database = require('../src/config/database');
const originalQuery = database.query;

afterEach(() => {
  database.query = originalQuery;
  delete require.cache[require.resolve('../src/routes/export')];
});

function loadExportRouterWithQueryStub(response) {
  const calls = [];

  database.query = (text, params) => {
    calls.push({ text, params });
    return Promise.resolve(response);
  };

  delete require.cache[require.resolve('../src/routes/export')];

  return {
    router: require('../src/routes/export'),
    calls,
  };
}

async function invokeGet(router, query = {}) {
  const layer = router.stack.find(
    (entry) => entry.route?.path === '/' && entry.route.methods.get
  );
  assert.ok(layer, 'GET / route not found');

  const handler = layer.route.stack[0].handle;
  const req = { query, userId: 'user-1' };
  const res = {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    send(bodyValue) {
      this.body = bodyValue;
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

  return { status: res.statusCode, body: res.body, headers: res.headers };
}

describe('export routes', () => {
  it('escapes CSV food names containing commas, quotes, and newlines', async () => {
    const { router, calls } = loadExportRouterWithQueryStub({
      rows: [{
        id: 'meal-1',
        meal_type: 'breakfast',
        logged_at: '2026-07-11T14:00:00.000Z',
        items: [
          {
            food_name: 'Greek "yogurt", plain',
            quantity: 1,
            unit: 'cup',
            calories: 150,
            protein_g: 20,
            carbs_g: 9,
            fat_g: 4,
          },
          {
            food_name: 'Line\nBreak',
            quantity: 2,
            unit: 'each',
            calories: 80,
            protein_g: 1,
            carbs_g: 18,
            fat_g: 0,
          },
        ],
      }],
    });

    const { status, body, headers } = await invokeGet(router, {
      format: 'csv',
      include: 'meals',
    });

    assert.equal(status, 200);
    assert.equal(headers['content-type'], 'text/csv');
    assert.equal(calls.length, 1);
    assert.equal(body, [
      'date,meal_type,food_name,quantity,unit,calories,protein_g,carbs_g,fat_g',
      '2026-07-11,breakfast,"Greek ""yogurt"", plain",1,cup,150,20,9,4',
      '2026-07-11,breakfast,"Line\nBreak",2,each,80,1,18,0',
    ].join('\n'));
  });
});
