const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createGpuMutex } = require('../src/director/gpuMutex');
const { registerAdapter } = require('../src/director/adapters');
const { createComfyUIVideoProvider } = require('../src/services/videoProviders/comfyuiVideoProvider');
const { createVideoProviderRegistry } = require('../src/services/videoProviders');

function createWorkflowFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyui-provider-'));
  const workflowPath = path.join(root, 'workflow.json');
  const workflow = {
    prompt: {
      '5': {
        class_type: 'MiniMaxH3Director',
        inputs: { frame_rate: 24, width: 864, height: 480, timeline_data: '{}' },
      },
      '6': { class_type: 'UNETLoader', inputs: {} },
      '7': { class_type: 'SaveVideo', inputs: {} },
    },
  };
  const bytes = Buffer.from(JSON.stringify(workflow));
  fs.writeFileSync(workflowPath, bytes);
  const workflowSha256 = `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
  const registry = {
    workflows: [{
      id: 'h3-continuity-v1',
      status: 'verified',
      workflowPath,
      workflowSha256,
      requiredNodes: ['MiniMaxH3Director', 'UNETLoader', 'SaveVideo'],
      customNodes: ['MiniMaxH3Director', 'SaveVideo'],
      modelFiles: ['minimax-h3.safetensors'],
      runtimeLock: {
        models: [{ relativePath: 'diffusion_models/minimax-h3.safetensors' }],
      },
      execution: {
        promptContract: 'h3_director_v1',
        requiresPromptDraft: true,
        dimensions: { minWidth: 32, maxWidth: 4096, minHeight: 32, maxHeight: 4096, multipleOf: 32 },
        references: { min: 0, max: 9 },
        vramPolicy: 'h3_estimate',
        defaults: { width: 864, height: 480, durationSeconds: 5, frameRate: 24, seed: 42 },
      },
    }],
  };
  return { root, registry, workflowSha256 };
}

function createFakeClient() {
  const calls = [];
  return {
    calls,
    async submitWorkflow(options) {
      calls.push({ method: 'submitWorkflow', ...options });
      return { promptId: 'prompt-1', workflow: options.registry.workflows[0] };
    },
    async getPromptStatus(promptId) {
      calls.push({ method: 'getPromptStatus', promptId });
      return { status: 'running', progress: 35, history: null };
    },
    async cancel(promptId) {
      calls.push({ method: 'cancel', promptId });
      return { promptId, cancelled: true };
    },
    async downloadOutput(options) {
      calls.push({ method: 'downloadOutput', ...options });
      return { artifactPath: 'E:/outputs/shot.mp4', sha256: 'abc123' };
    },
    async probeArtifact(artifactPath) {
      calls.push({ method: 'probeArtifact', artifactPath });
      return { streams: [{ codec_type: 'video', width: 1280, height: 704 }] };
    },
    async getSystemStats() {
      calls.push({ method: 'getSystemStats' });
      return { devices: [{ name: 'RTX 5090', vram_total: 24 * 1024 * 1024 * 1024 }] };
    },
    async getQueue() {
      calls.push({ method: 'getQueue' });
      return { queue_running: [], queue_pending: [] };
    },
    async getObjectInfo() {
      calls.push({ method: 'getObjectInfo' });
      return { MiniMaxH3Director: {}, UNETLoader: {}, SaveVideo: {} };
    },
    async getModels(folders) {
      calls.push({ method: 'getModels', folders });
      return { diffusion_models: ['minimax-h3.safetensors'] };
    },
  };
}

function context(input = {}) {
  return {
    taskId: 'video-1',
    snapshot: { model: 'h3-continuity-v1', settings: { width: 1280, height: 704 } },
    input: {
      prompt: 'A detective crosses a rain-soaked street.',
      durationSeconds: 5,
      frameRate: 24,
      seed: 17,
      width: 1280,
      height: 704,
      ...input,
    },
  };
}

function workflowContext(workflow, input = {}) {
  const base = context(input);
  return {
    ...base,
    snapshot: {
      ...base.snapshot,
      configId: 7,
      provider: 'comfyui',
      model: workflow.id,
      workflowId: workflow.id,
      workflowSnapshotVersion: 1,
      workflowPath: workflow.workflowPath,
      workflowSha256: workflow.workflowSha256,
      workflowStatus: workflow.status,
      workflowExecution: workflow.execution,
      adapter: workflow.adapter || null,
      adapterVersion: workflow.adapterVersion || null,
    },
  };
}

describe('ComfyUI video provider adapter', () => {
  test('submits from the immutable workflow snapshot after the live registry changes', async (t) => {
    const fixture = createWorkflowFixture();
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    const frozen = structuredClone(fixture.registry.workflows[0]);
    const fake = createFakeClient();
    const provider = createComfyUIVideoProvider({
      registry: fixture.registry,
      comfyClient: fake,
      gpuMutex: createGpuMutex(),
    });
    fixture.registry.workflows[0] = {
      ...fixture.registry.workflows[0],
      status: 'invalid',
      workflowPath: path.join(fixture.root, 'replacement.json'),
      workflowSha256: 'sha256:replacement',
      execution: { ...fixture.registry.workflows[0].execution, promptContract: 'free_text_v1' },
    };

    await provider.submit({
      ...context({ width: 320, height: 320 }),
      snapshot: {
        model: frozen.id,
        workflowId: frozen.id,
        workflowSnapshotVersion: 1,
        workflowPath: frozen.workflowPath,
        workflowSha256: frozen.workflowSha256,
        workflowStatus: frozen.status,
        workflowExecution: frozen.execution,
        adapter: frozen.adapter || null,
        adapterVersion: frozen.adapterVersion || null,
        effectiveParameters: { width: 1280, height: 704, durationSeconds: 5, frameRate: 24, seed: 17 },
        settings: {},
      },
    });

    assert.equal(fake.calls[0].registry.workflows[0].workflowPath, frozen.workflowPath);
    assert.equal(fake.calls[0].registry.workflows[0].workflowSha256, frozen.workflowSha256);
    assert.equal(fake.calls[0].prompt['5'].inputs.width, 1280);
    assert.equal(fake.calls[0].prompt['5'].inputs.height, 704);
  });

  test('refuses to submit a legacy snapshot through the live workflow registry', async (t) => {
    const fixture = createWorkflowFixture();
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    const fake = createFakeClient();
    const provider = createComfyUIVideoProvider({
      registry: fixture.registry,
      comfyClient: fake,
      gpuMutex: createGpuMutex(),
    });

    await assert.rejects(
      () => provider.submit({
        ...context({
          prompt: 'integrated_multimodal_description: [Shot 1] A detective crosses a rain-soaked street.\noverall_soundscape: Rain and footsteps.\nnon_diegetic_music: N/A',
        }),
        snapshot: {
          model: 'h3-continuity-v1',
          settings: { width: 1280, height: 704 },
        },
      }),
      (error) => error.code === 'VIDEO_WORKFLOW_SNAPSHOT_LEGACY_UNSAFE' && error.status === 409,
    );
    assert.equal(fake.calls.length, 0);
  });

  test('fails explicitly when the snapshotted workflow file no longer matches its SHA', async (t) => {
    const fixture = createWorkflowFixture();
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    const frozen = structuredClone(fixture.registry.workflows[0]);
    fs.writeFileSync(frozen.workflowPath, JSON.stringify({ prompt: { changed: { class_type: 'Other', inputs: {} } } }));
    const provider = createComfyUIVideoProvider({
      registry: fixture.registry,
      comfyClient: createFakeClient(),
      gpuMutex: createGpuMutex(),
    });

    await assert.rejects(
      () => provider.submit({
        ...context(),
        snapshot: {
          model: frozen.id,
          workflowId: frozen.id,
          workflowSnapshotVersion: 1,
          workflowPath: frozen.workflowPath,
          workflowSha256: frozen.workflowSha256,
          workflowExecution: frozen.execution,
          adapter: null,
          effectiveParameters: { width: 1280, height: 704, durationSeconds: 5, frameRate: 24, seed: 17 },
        },
      }),
      (error) => error.code === 'VIDEO_WORKFLOW_SNAPSHOT_MISMATCH',
    );
  });

  test('submits the configured workflow with numeric H3 dimensions', async (t) => {
    const fixture = createWorkflowFixture();
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    const fake = createFakeClient();
    const gpuMutex = createGpuMutex();
    const provider = createComfyUIVideoProvider({
      registry: fixture.registry,
      comfyClient: fake,
      gpuMutex,
    });

    const result = await provider.submit(workflowContext(fixture.registry.workflows[0], { width: '1280', height: '704' }));

    const submitted = fake.calls[0];
    assert.equal(submitted.workflowId, 'h3-continuity-v1');
    assert.equal(submitted.prompt['5'].inputs.width, 1280);
    assert.equal(submitted.prompt['5'].inputs.height, 704);
    assert.deepEqual(result, {
      providerTaskId: 'prompt-1',
      status: 'running',
      progress: 0,
      output: null,
    });
    assert.equal(gpuMutex.inspect().owner, 'video-1');
  });

  test('rejects non-positive or non-32-aligned H3 dimensions before submission', async (t) => {
    const fixture = createWorkflowFixture();
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    const fake = createFakeClient();
    const provider = createComfyUIVideoProvider({
      registry: fixture.registry,
      comfyClient: fake,
      gpuMutex: createGpuMutex(),
    });

    for (const dimensions of [
      { width: 1280, height: 720 },
      { width: 1279, height: 704 },
      { width: 0, height: 704 },
      { width: 1280, height: -32 },
    ]) {
      await assert.rejects(() => provider.submit(workflowContext(fixture.registry.workflows[0], dimensions)), /32 的倍数/);
    }
    assert.equal(fake.calls.length, 0);
  });

  test('normalizes query, recovery, and cancellation while releasing GPU leases', async (t) => {
    const fixture = createWorkflowFixture();
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    const fake = createFakeClient();
    const gpuMutex = createGpuMutex();
    const provider = createComfyUIVideoProvider({ registry: fixture.registry, comfyClient: fake, gpuMutex });
    await provider.submit(workflowContext(fixture.registry.workflows[0]));

    const running = await provider.query({ providerTaskId: 'prompt-1' });
    assert.deepEqual(running, {
      providerTaskId: 'prompt-1', status: 'running', progress: 35, output: null,
    });

    fake.getPromptStatus = async () => ({
      status: 'completed',
      progress: 100,
      history: { outputs: { '7': { videos: [{ filename: 'shot.mp4' }] } } },
    });
    const recovered = await provider.recover({ providerTaskId: 'prompt-1' });
    assert.equal(recovered.status, 'completed');
    assert.equal(recovered.output.artifactPath, 'E:/outputs/shot.mp4');
    assert.equal(recovered.output.ffprobe.streams[0].width, 1280);
    assert.equal(gpuMutex.inspect(), null);

    await provider.submit({ ...workflowContext(fixture.registry.workflows[0]), taskId: 'video-2' });
    const cancelled = await provider.cancel({ providerTaskId: 'prompt-1' });
    assert.deepEqual(cancelled, {
      providerTaskId: 'prompt-1', status: 'cancelled', progress: 100, output: null,
    });
    assert.equal(gpuMutex.inspect(), null);
  });

  test('keeps the GPU lease when upstream cancellation fails', async (t) => {
    const fixture = createWorkflowFixture();
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    const fake = createFakeClient();
    fake.cancel = async () => { throw new Error('interrupt endpoint unavailable'); };
    const gpuMutex = createGpuMutex();
    const provider = createComfyUIVideoProvider({ registry: fixture.registry, comfyClient: fake, gpuMutex });
    await provider.submit(workflowContext(fixture.registry.workflows[0]));

    await assert.rejects(
      () => provider.cancel({ providerTaskId: 'prompt-1' }),
      /interrupt endpoint unavailable/
    );

    assert.equal(gpuMutex.inspect().owner, 'video-1');
    await assert.rejects(() => provider.submit({ ...workflowContext(fixture.registry.workflows[0]), taskId: 'video-2' }), /GPU_BUSY/);
  });

  test('can release an abandoned local lease without cancelling the upstream task', async (t) => {
    const fixture = createWorkflowFixture();
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    const fake = createFakeClient();
    const gpuMutex = createGpuMutex();
    const provider = createComfyUIVideoProvider({ registry: fixture.registry, comfyClient: fake, gpuMutex });
    await provider.submit(workflowContext(fixture.registry.workflows[0]));

    assert.equal(provider.releaseLocalLease({ providerTaskId: 'prompt-1' }), true);
    await assert.doesNotReject(() => provider.submit({ ...workflowContext(fixture.registry.workflows[0]), taskId: 'video-2' }));
    assert.equal(fake.calls.some((call) => call.method === 'cancel'), false);
  });

  test('releases the GPU lease when completed artifact finalization fails', async (t) => {
    const fixture = createWorkflowFixture();
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    for (const failure of ['download', 'probe']) {
      const fake = createFakeClient();
      fake.getPromptStatus = async () => ({
        status: 'completed', progress: 100, history: { outputs: { '7': { videos: [{ filename: 'shot.mp4' }] } } },
      });
      if (failure === 'download') fake.downloadOutput = async () => { throw new Error('output download failed'); };
      else fake.probeArtifact = async () => { throw new Error('output probe failed'); };
      const gpuMutex = createGpuMutex();
      const provider = createComfyUIVideoProvider({ registry: fixture.registry, comfyClient: fake, gpuMutex });
      await provider.submit(workflowContext(fixture.registry.workflows[0]));

      await assert.rejects(
        () => provider.query({ providerTaskId: 'prompt-1' }),
        new RegExp(`output ${failure} failed`)
      );

      assert.equal(gpuMutex.inspect(), null);
      await assert.doesNotReject(() => provider.submit({ ...workflowContext(fixture.registry.workflows[0]), taskId: `video-after-${failure}` }));
    }
  });

  test('renews an active GPU lease on each running query', async (t) => {
    const fixture = createWorkflowFixture();
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    let now = 1_000;
    const fake = createFakeClient();
    const gpuMutex = createGpuMutex({ clock: () => now });
    const provider = createComfyUIVideoProvider({
      registry: fixture.registry, comfyClient: fake, gpuMutex, leaseMs: 100,
    });
    await provider.submit(workflowContext(fixture.registry.workflows[0]));
    const token = gpuMutex.inspect().token;

    now = 1_090;
    await provider.query({ providerTaskId: 'prompt-1' });
    now = 1_150;

    assert.equal(gpuMutex.inspect().token, token);
    assert.equal(gpuMutex.inspect().expiresAt, 1_190);
  });

  test('reacquires an expired lease even when a stale local handle remains', async (t) => {
    const fixture = createWorkflowFixture();
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    let now = 1_000;
    const fake = createFakeClient();
    const gpuMutex = createGpuMutex({ clock: () => now });
    const provider = createComfyUIVideoProvider({
      registry: fixture.registry, comfyClient: fake, gpuMutex, leaseMs: 100,
    });
    await provider.submit(workflowContext(fixture.registry.workflows[0]));
    const expiredToken = gpuMutex.inspect().token;
    now = 1_101;
    assert.equal(gpuMutex.inspect(), null);

    const recovered = await provider.recover({
      providerTaskId: 'prompt-1', taskId: 'video-1', leaseMs: 100,
    });

    assert.equal(recovered.status, 'running');
    assert.equal(gpuMutex.inspect().owner, 'video-1');
    assert.notEqual(gpuMutex.inspect().token, expiredToken);
  });

  test('does not replace another owner when reacquiring a stale lease', async (t) => {
    const fixture = createWorkflowFixture();
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    let now = 1_000;
    const fake = createFakeClient();
    const gpuMutex = createGpuMutex({ clock: () => now });
    const provider = createComfyUIVideoProvider({
      registry: fixture.registry, comfyClient: fake, gpuMutex, leaseMs: 100,
    });
    await provider.submit(workflowContext(fixture.registry.workflows[0]));
    now = 1_101;
    const other = gpuMutex.acquire('other-job', { leaseMs: 100 });

    await assert.rejects(
      () => provider.recover({ providerTaskId: 'prompt-1', taskId: 'video-1', leaseMs: 100 }),
      /GPU_BUSY/
    );
    assert.equal(gpuMutex.inspect().token, other.token);
  });

  test('tests read-only ComfyUI capabilities without enqueuing inference', async (t) => {
    const fixture = createWorkflowFixture();
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    const fake = createFakeClient();
    const provider = createComfyUIVideoProvider({
      registry: fixture.registry,
      comfyClient: fake,
      gpuMutex: createGpuMutex(),
    });

    const result = await provider.testConnection(context());

    assert.equal(result.status, 'completed');
    assert.equal(result.output.workflow.sha256, fixture.workflowSha256);
    assert.equal(result.output.vram.totalVramMb, 24576);
    assert.deepEqual(result.output.models.required, ['minimax-h3.safetensors']);
    assert.equal(fake.calls.some((call) => call.method === 'submitWorkflow'), false);
    assert.deepEqual(
      fake.calls.map((call) => call.method),
      ['getSystemStats', 'getQueue', 'getObjectInfo', 'getModels']
    );
  });

  test('uses a configured ComfyUI URL for read-only checks without duplicating provider logic', async (t) => {
    const fixture = createWorkflowFixture();
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    const defaultClient = createFakeClient();
    const configuredClient = createFakeClient();
    const requestedUrls = [];
    const provider = createComfyUIVideoProvider({
      registry: fixture.registry,
      comfyClient: defaultClient,
      createComfyClient(baseUrl) {
        requestedUrls.push(baseUrl);
        return configuredClient;
      },
      gpuMutex: createGpuMutex(),
    });

    await provider.testConnection({
      ...context(),
      base_url: 'http://comfyui.internal:8188/',
    });

    assert.deepEqual(requestedUrls, ['http://comfyui.internal:8188']);
    assert.equal(configuredClient.calls.some((call) => call.method === 'getSystemStats'), true);
    assert.equal(defaultClient.calls.length, 0);
  });

  test('rejects stale workflows and missing ComfyUI runtime capabilities without inference', async (t) => {
    const fixture = createWorkflowFixture();
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));

    const cases = [
      {
        name: 'workflow SHA',
        change({ registry }) { registry.workflows[0].workflowSha256 = 'sha256:stale'; },
        expected: /SHA-256/,
      },
      {
        name: 'required nodes',
        change({ fake }) { fake.getObjectInfo = async () => ({ SaveVideo: {} }); },
        expected: /缺少必需节点/,
      },
      {
        name: 'required models',
        change({ fake }) { fake.getModels = async () => ({ diffusion_models: [] }); },
        expected: /缺少必需模型/,
      },
      {
        name: 'GPU VRAM',
        change({ fake }) { fake.getSystemStats = async () => ({ devices: [] }); },
        expected: /GPU 显存/,
      },
    ];

    for (const scenario of cases) {
      const registry = structuredClone(fixture.registry);
      const fake = createFakeClient();
      scenario.change({ registry, fake });
      const provider = createComfyUIVideoProvider({ registry, comfyClient: fake, gpuMutex: createGpuMutex() });
      await assert.rejects(() => provider.testConnection(context()), scenario.expected, scenario.name);
      assert.equal(fake.calls.some((call) => call.method === 'submitWorkflow'), false, scenario.name);
    }
  });

  test('registers the ComfyUI adapter behind the shared provider boundary', () => {
    const adapter = { submit() {} };
    const providers = createVideoProviderRegistry({ comfyui: adapter });
    assert.equal(providers.get('COMFYUI'), adapter);
    assert.throws(() => providers.get('unknown'), /VIDEO_PROVIDER_UNSUPPORTED/);
  });

  test('dispatches free-text validation from its execution contract instead of H3 rules', async (t) => {
    const fixture = createWorkflowFixture();
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    const selected = fixture.registry.workflows[0];
    selected.id = 'free-text-v1';
    selected.adapter = 'test_free_text_v1';
    selected.execution = {
      promptContract: 'free_text_v1', requiresPromptDraft: false,
      dimensions: { minWidth: 100, maxWidth: 2000, minHeight: 100, maxHeight: 2000, multipleOf: 4 },
      references: { min: 0, max: 2 }, vramPolicy: 'none',
      defaults: { width: 1000, height: 700, durationSeconds: 4, frameRate: 20, seed: 3 },
    };
    registerAdapter({
      id: 'test_free_text_v1',
      validate(input) { assert.equal(input.width, 1000); assert.equal(input.height, 700); },
      buildPrompt(template, input) { return { ...template.prompt, freeText: input.prompt }; },
      describeCapabilities() { return { modes: ['text_to_video'] }; },
    });
    const fake = createFakeClient();
    const provider = createComfyUIVideoProvider({ registry: fixture.registry, comfyClient: fake, gpuMutex: createGpuMutex() });
    await assert.doesNotReject(() => provider.submit({
      ...workflowContext(selected, {
        prompt: 'plain prompt', width: 1000, height: 700,
        durationSeconds: undefined, frameRate: undefined, seed: undefined,
      }),
      taskId: 'free-text-task',
    }));
    assert.equal(fake.calls[0].inputs.durationSeconds, 4);
  });

  test('rejects a free-text workflow without an adapter during connection checks', async (t) => {
    const fixture = createWorkflowFixture();
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    const selected = fixture.registry.workflows[0];
    selected.id = 'unbound-free-text';
    selected.adapter = null;
    selected.execution = {
      promptContract: 'free_text_v1', requiresPromptDraft: false,
      dimensions: { minWidth: 1, maxWidth: 2000, minHeight: 1, maxHeight: 2000, multipleOf: 1 },
      references: { min: 0, max: 1 }, vramPolicy: 'none',
      defaults: { width: 640, height: 360, durationSeconds: 5, frameRate: 24, seed: 1 },
    };
    const provider = createComfyUIVideoProvider({ registry: fixture.registry, comfyClient: createFakeClient(), gpuMutex: createGpuMutex() });
    await assert.rejects(
      () => provider.testConnection({ snapshot: { model: 'unbound-free-text' }, input: {} }),
      (error) => error.code === 'WORKFLOW_ADAPTER_REQUIRED',
    );
  });
});
