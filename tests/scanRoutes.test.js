const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const aiVision = require('../src/services/aiVision');
const originalAnalyzePhoto = aiVision.analyzePhoto;

afterEach(() => {
  aiVision.analyzePhoto = originalAnalyzePhoto;
  delete require.cache[require.resolve('../src/routes/scan')];
});

function loadScanRouterWithAnalyzeStub(result) {
  const calls = [];

  aiVision.analyzePhoto = (imageBase64, mimeType) => {
    calls.push({ imageBase64, mimeType });
    return Promise.resolve(result);
  };

  delete require.cache[require.resolve('../src/routes/scan')];

  return {
    router: require('../src/routes/scan'),
    calls,
  };
}

async function invokeScanHandler(router, req) {
  const layer = router.stack.find(
    (entry) => entry.route?.path === '/' && entry.route.methods.post
  );
  assert.ok(layer, 'POST / route not found');

  const handler = layer.route.stack.at(-1).handle;
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
  it('accepts multipart image files by converting the uploaded buffer to base64', async () => {
    const scanResult = {
      description: 'apple slices',
      meal_type_suggestion: 'snack',
      items: [],
      overall_confidence: 0.9,
    };
    const { router, calls } = loadScanRouterWithAnalyzeStub(scanResult);

    const { status, data } = await invokeScanHandler(router, {
      body: {},
      file: {
        buffer: Buffer.from('fake image bytes'),
        mimetype: 'image/png',
      },
    });

    assert.equal(status, 200);
    assert.deepEqual(data.scan_result, scanResult);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].imageBase64, Buffer.from('fake image bytes').toString('base64'));
    assert.equal(calls[0].mimeType, 'image/png');
  });
});
