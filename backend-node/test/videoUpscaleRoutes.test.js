const test = require('node:test');
const assert = require('node:assert/strict');

const createRoutes = require('../src/routes/videoUpscale');

function responseCapture() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('video upscale capabilities is read-only and returns configured workflows', async () => {
  let inferenceCalls = 0;
  const runtime = {
    capabilities: async () => ({
      enabled: true, provider_online: true, comfyui_running: true,
      default_method: 'flash', methods: { flash: { workflow_id: 'M20' }, seed: { workflow_id: 'M19' } },
    }),
    createAndRun: async () => { inferenceCalls += 1; },
  };
  const route = createRoutes({}, console, runtime);
  const res = responseCapture();
  await route.capabilities({}, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.methods.flash.workflow_id, 'M20');
  assert.equal(inferenceCalls, 0);
});

test('video upscale routes expose job state and accepted retry', async () => {
  const job = { id: 'job-1', status: 'waiting_provider', config_snapshot_json: '{"safe":true}', segments: [] };
  const runtime = {
    getJob: () => job,
    retryJob: async () => ({ ...job, status: 'running' }),
  };
  const route = createRoutes({}, console, runtime);
  const getRes = responseCapture();
  await route.get({ params: { id: 'job-1' } }, getRes);
  assert.equal(getRes.body.data.allowed_actions.retry, true);
  assert.equal(getRes.body.data.allowed_actions.skip, true);
  assert.equal(getRes.body.data.config_snapshot_json, undefined);

  const retryRes = responseCapture();
  await route.retry({ params: { id: 'job-1' } }, retryRes);
  assert.equal(retryRes.statusCode, 202);
  assert.equal(retryRes.body.data.status, 'running');
});

test('video upscale state conflicts return HTTP 409 with a stable code', async () => {
  const error = new Error('当前状态不能跳过超分');
  error.code = 'UPSCALE_STATE_CONFLICT';
  const route = createRoutes({}, console, { skipJob: () => { throw error; } });
  const res = responseCapture();
  await route.skip({ params: { id: 'job-1' } }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'UPSCALE_STATE_CONFLICT');
});
