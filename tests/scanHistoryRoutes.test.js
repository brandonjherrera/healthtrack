const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const database = require('../src/config/database');
const aiVision = require('../src/services/aiVision');
const originalQuery = database.query;
const originalAnalyzePhoto = aiVision.analyzePhoto;

afterEach(() => {
  database.query = originalQuery;
  aiVision.analyzePhoto = originalAnalyzePhoto;
  delete require.cache[require.resolve('../src/routes/scan')];
});

function loadScanRouterWithStubs(result) {
  const queryCalls = [];
  const analyzeCalls = [];

  database.query = (text, params) => {
    queryCalls.push({ text, params });
    return Promise.resolve({ rows: [] });
  };
  aiVision.analyzePhoto = (imageBase64, mimeType) => {
    analyzeCalls.push({ imageBase64, mimeType });
    return Promise.resolve(result);
  };

  delete require.cache[require.resolve('../src/routes/scan')];

  return {
    router: require('../src/routes/scan'),
    queryCalls,
    analyzeCalls,
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

describe('scan routes', () => {
  it('writes successful photo scans to scan_history', async () => {
    const scanResult = {
      description: 'toast and eggs',
      meal_type_suggestion: 'breakfast',
      items: [],
      overall_confidence: 0.87,
      model_used: 'claude-test',
    };
    const { router, queryCalls, analyzeCalls } = loadScanRouterWithStubs(scanResult);

    const { status, data } = await invokePost(router, {
      image: 'base64-photo',
      mime_type: 'image/png',
      photo_url: 'uploads/scan-1.png',
      context_text: 'post-run breakfast',
    });

    assert.equal(status, 200);
    assert.deepEqual(data.scan_result, scanResult);
    assert.deepEqual(analyzeCalls, [{ imageBase64: 'base64-photo', mimeType: 'image/png' }]);
    assert.equal(queryCalls.length, 1);
    assert.match(queryCalls[0].text, /INSERT INTO scan_history/);
    assert.equal(queryCalls[0].params[0], 'user-1');
    assert.equal(queryCalls[0].params[1], 'uploads/scan-1.png');
    assert.equal(queryCalls[0].params[2], 'post-run breakfast');
    assert.equal(queryCalls[0].params[3], 'claude-test');
    assert.deepEqual(queryCalls[0].params[4], scanResult);
    assert.equal(typeof queryCalls[0].params[5], 'number');
  });
});
