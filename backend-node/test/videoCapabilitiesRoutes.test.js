const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const videoRoutes = require('../src/routes/videos');

function responseCapture() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

describe('video capabilities route', () => {
  it('returns the lifecycle capability contract without credentials', () => {
    const routes = videoRoutes({}, { error() {} }, {
      lifecycleService: {
        getVideoCapabilities() {
          return {
            provider: 'comfyui',
            workflow: { id: 'minimax_h3_director_r2v', sha256: 'sha256:test' },
            capabilities: { modes: ['single_reference'], maxReferenceImages: 9, supportsSage: true },
            connection: { status: 'unknown', inferenceStarted: false },
          };
        },
      },
    });
    const res = responseCapture();
    routes.capabilities({}, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.workflow.id, 'minimax_h3_director_r2v');
    assert.equal(JSON.stringify(res.body).includes('api_key'), false);
    assert.equal(JSON.stringify(res.body).includes('token'), false);
  });

  it('fails closed when capability discovery is unavailable', () => {
    const routes = videoRoutes({}, { error() {} }, { lifecycleService: {} });
    const res = responseCapture();
    routes.capabilities({}, res);
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error.code, 'VIDEO_CAPABILITIES_UNAVAILABLE');
  });
});
