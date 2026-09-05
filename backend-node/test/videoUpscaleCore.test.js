const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_UPSCALE_CONFIG,
  normalizeVideoUpscaleConfig,
  createSafeConfigSnapshot,
} = require('../src/services/videoUpscale/videoUpscaleConfig');
const {
  buildSegmentPlan,
  validateSourceMedia,
} = require('../src/services/videoUpscale/videoUpscalePlanner');
const {
  ZealmanUpscaleClient,
  applyWorkflowInputs,
  extractVideoResult,
} = require('../src/services/videoUpscale/zealmanUpscaleClient');

test('video upscale config defaults to disabled Flash without leaking credentials', () => {
  const config = normalizeVideoUpscaleConfig({
    base_url: 'https://panel.example.test/',
    api_key: 'secret',
  });

  assert.equal(config.enabled, false);
  assert.equal(config.default_method, 'flash');
  assert.equal(config.base_url, 'https://panel.example.test');
  assert.equal(config.workflows.flash, DEFAULT_UPSCALE_CONFIG.workflows.flash);
  assert.equal(config.workflows.seed, DEFAULT_UPSCALE_CONFIG.workflows.seed);
  assert.equal(config.expected_source_width, 1312);
  assert.equal(config.expected_source_height, 736);
  assert.equal(config.scale, 2);
  assert.equal(config.segment_frame_cap, 240);
  assert.equal(config.overlap_frames, 4);
  assert.equal(createSafeConfigSnapshot(config).api_key, undefined);
});

test('video upscale config rejects invalid method, URL, and overlap', () => {
  assert.throws(() => normalizeVideoUpscaleConfig({ default_method: 'rtx' }), /default_method/);
  assert.throws(() => normalizeVideoUpscaleConfig({ base_url: 'file:///tmp/panel' }), /base_url/);
  assert.throws(
    () => normalizeVideoUpscaleConfig({ segment_frame_cap: 4, overlap_frames: 4 }),
    /overlap_frames/
  );
});

test('segment planner covers every frame once after trimming overlap', () => {
  const segments = buildSegmentPlan({ frameCount: 481, frameCap: 240, overlapFrames: 4 });
  assert.deepEqual(segments, [
    { index: 0, startFrame: 0, frameCount: 240, trimLeadingFrames: 0 },
    { index: 1, startFrame: 236, frameCount: 240, trimLeadingFrames: 4 },
    { index: 2, startFrame: 472, frameCount: 9, trimLeadingFrames: 4 },
  ]);
  assert.equal(
    segments.reduce((sum, segment) => sum + segment.frameCount - segment.trimLeadingFrames, 0),
    481
  );
});

test('segment planner accepts the configured H3 source dimensions', () => {
  assert.deepEqual(buildSegmentPlan({ frameCount: 240, frameCap: 240, overlapFrames: 4 }), [
    { index: 0, startFrame: 0, frameCount: 240, trimLeadingFrames: 0 },
  ]);
  assert.deepEqual(
    validateSourceMedia({ width: 1312, height: 736, frameCount: 72, fpsNumerator: 24, fpsDenominator: 1 }),
    { width: 2624, height: 1472 }
  );
  assert.throws(
    () => validateSourceMedia({ width: 1280, height: 736, frameCount: 72, fpsNumerator: 24, fpsDenominator: 1 }),
    (error) => error.code === 'UNSUPPORTED_SOURCE_DIMENSIONS'
  );
});

test('workflow inputs enforce 1312x736 to 2624x1472 on Flash and Seed templates', () => {
  const template = {
    _api_config: { fields: ['hidden'] },
    25: { inputs: { video: '', frame_load_cap: 240, skip_first_frames: 0 } },
    27: { inputs: { filename_prefix: 'seed' } },
    29: { inputs: { resolution: 1472, max_resolution: 2560 } },
    192: { inputs: { value: 2 } },
    195: { inputs: { video: '', frame_load_cap: 240, skip_first_frames: 0 } },
    204: { inputs: { filename_prefix: 'flash' } },
  };

  const flash = applyWorkflowInputs(template, 'flash', {
    remoteVideo: 'input/source.mp4', frameCap: 120, skipFrames: 236, filenamePrefix: 'job_part_0001',
    targetWidth: 2624, targetHeight: 1472, scale: 2,
  });
  assert.equal(flash._api_config, undefined);
  assert.equal(flash['195'].inputs.video, 'input/source.mp4');
  assert.equal(flash['195'].inputs.frame_load_cap, 120);
  assert.equal(flash['195'].inputs.skip_first_frames, 236);
  assert.equal(flash['204'].inputs.filename_prefix, 'job_part_0001');
  assert.equal(flash['192'].inputs.value, 2);
  assert.equal(template['195'].inputs.video, '');

  const seed = applyWorkflowInputs(template, 'seed', {
    remoteVideo: 'input/source.mp4', frameCap: 60, skipFrames: 0, filenamePrefix: 'seed_part',
    targetWidth: 2624, targetHeight: 1472, scale: 2,
  });
  assert.equal(seed['25'].inputs.frame_load_cap, 60);
  assert.equal(seed['27'].inputs.filename_prefix, 'seed_part');
  assert.equal(seed['29'].inputs.resolution, 1472);
  assert.equal(seed['29'].inputs.max_resolution, 2624);
  assert.equal(template['29'].inputs.max_resolution, 2560);
});

test('workflow mutation fails closed when the platform schema changes', () => {
  assert.throws(
    () => applyWorkflowInputs({ 195: { inputs: { video: '' } } }, 'flash', {
      remoteVideo: 'x.mp4', frameCap: 240, skipFrames: 0, filenamePrefix: 'x',
      targetWidth: 2624, targetHeight: 1472, scale: 2,
    }),
    (error) => error.code === 'WORKFLOW_SCHEMA_CHANGED'
  );
});

test('Zealman adapter fetches the full template before submitting a quick workflow', async () => {
  const calls = [];
  const template = {
    _api_config: { fields: [] },
    192: { inputs: { value: 2 } },
    195: { inputs: { video: '', frame_load_cap: 240, skip_first_frames: 0 } },
    204: { inputs: { filename_prefix: 'flash' } },
  };
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/api/workflow/config/')) {
      return new Response(JSON.stringify({ workflow_template: template }), { status: 200 });
    }
    if (String(url).endsWith('/api/workflow/generate')) {
      return new Response(JSON.stringify({ prompt_id: 'prompt-123' }), { status: 200 });
    }
    throw new Error(`unexpected URL ${url}`);
  };
  const client = new ZealmanUpscaleClient({
    baseUrl: 'https://panel.example.test', fetchImpl, apiKey: 'token',
  });

  const promptId = await client.submitSegment({
    workflowId: 'M20-Flash', method: 'flash', remoteVideo: 'source.mp4',
    frameCap: 240, skipFrames: 0, filenamePrefix: 'job_part_0000', clientId: 'job:0',
    targetWidth: 2624, targetHeight: 1472, scale: 2,
  });

  assert.equal(promptId, 'prompt-123');
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/api\/workflow\/config\/M20-Flash$/);
  const submitted = JSON.parse(calls[1].options.body);
  assert.equal(submitted.source, 'quick');
  assert.equal(submitted.client_id, 'job:0');
  assert.equal(submitted.workflow_id, undefined);
  assert.equal(submitted.input_values, undefined);
  assert.equal(submitted.workflow_template['195'].inputs.video, 'source.mp4');
  assert.equal(submitted.workflow_template['192'].inputs.value, 2);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer token');
});

test('result extraction selects a video output and rejects a success without video', () => {
  assert.equal(
    extractVideoResult({ results: [{ type: 'image', url: '/preview.png' }, { type: 'video', url: '/out.mp4' }] }, 'https://panel.test'),
    'https://panel.test/out.mp4'
  );
  assert.throws(
    () => extractVideoResult({ success: true, results: [{ type: 'image', url: '/preview.png' }] }, 'https://panel.test'),
    (error) => error.code === 'REMOTE_OUTPUT_MISSING'
  );
});

test('a gateway 404 on health is treated as an offline machine, not a missing workflow', async () => {
  const client = new ZealmanUpscaleClient({
    baseUrl: 'https://panel.example.test',
    fetchImpl: async () => new Response('not found', { status: 404 }),
  });
  await assert.rejects(
    () => client.health(),
    (error) => error.code === 'PROVIDER_UNAVAILABLE' && error.retryable === true
  );
  await assert.rejects(
    () => client.loadWorkflowTemplate('M20'),
    (error) => error.code === 'WORKFLOW_NOT_FOUND' && error.retryable === false
  );
});
