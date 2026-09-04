const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sutPath = path.resolve(__dirname, '../src/director/workflowRegistry.js');

function loadSut() {
  assert.equal(fs.existsSync(sutPath), true, `missing implementation: ${sutPath}`);
  return require(sutPath);
}

function writeWorkflowFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aistory-registry-'));
  const workflowPath = path.join(root, 'workflow.json');
  fs.writeFileSync(path.join(root, 'evidence.md'), 'verified fixture evidence');
  fs.writeFileSync(workflowPath, JSON.stringify({
    prompt: {
      '1': { class_type: 'UNETLoader' },
      '2': { class_type: 'CLIPLoader' },
      '3': { class_type: 'SaveVideo' },
    },
  }));
  return { root, workflowPath };
}

function governance() {
  return {
    provenance: {
      provider: 'MiniMax', modelFamily: 'MiniMax H3', source: 'test fixture',
      license: { status: 'review_required', evidence: 'test evidence' },
    },
    runtimeLock: {
      comfyUIVersion: '0.33.1',
      models: [],
      customNodes: [{ name: 'fixture-node', files: [{ path: '__init__.py', sha256: 'a'.repeat(64) }] }],
    },
  };
}

function execution() {
  return {
    promptContract: 'h3_director_v1',
    requiresPromptDraft: true,
    dimensions: { minWidth: 32, maxWidth: 4096, minHeight: 32, maxHeight: 4096, multipleOf: 32 },
    references: { min: 1, max: 9 },
    vramPolicy: 'h3_estimate',
    defaults: { width: 864, height: 480, durationSeconds: 5, frameRate: 24, seed: 42 },
  };
}

function registryFor(workflowPath, workflowSha256) {
  return {
    version: 1,
    workflows: [
      {
        id: 'h3-continuity-v1',
        status: 'verified',
        workflowPath,
        workflowSha256,
        requiredNodes: ['UNETLoader', 'CLIPLoader', 'SaveVideo'],
        modelFiles: ['minimax_h3_fl2va_pruned_int8_convrot.safetensors'],
        customNodes: ['MiniMaxH3Director'],
        inputSchema: { prompt: 'string', seed: 'integer' },
        verifiedEvidence: path.join(path.dirname(workflowPath), 'evidence.md'),
        execution: execution(),
        ...governance(),
      },
      {
        id: 'h3-r2v-configured-v1',
        status: 'configured',
        workflowPath,
        workflowSha256,
        requiredNodes: ['UNETLoader', 'CLIPLoader', 'SaveVideo'],
        modelFiles: [],
        customNodes: [],
        inputSchema: { prompt: 'string' },
        verifiedEvidence: null,
        execution: execution(),
        ...governance(),
      },
      {
        id: 'h3-r2v-invalid-v1',
        status: 'invalid',
        workflowPath,
        workflowSha256,
        requiredNodes: ['UNETLoader', 'CLIPLoader'],
        modelFiles: [],
        customNodes: [],
        inputSchema: { prompt: 'string' },
        verifiedEvidence: null,
        execution: execution(),
        ...governance(),
      },
    ],
  };
}

describe('Director workflow registry', () => {
  it('selects verified workflows and rejects configured by default', () => {
    const { selectWorkflow } = loadSut();
    const { workflowPath } = writeWorkflowFixture();
    const registry = registryFor(workflowPath, 'sha256:fixture');

    assert.equal(selectWorkflow(registry, 'h3-continuity-v1').status, 'verified');
    assert.throws(
      () => selectWorkflow(registry, 'h3-r2v-configured-v1'),
      /experimental|configured/i
    );
  });

  it('allows a configured workflow only with the explicit experimental flag', () => {
    const { selectWorkflow } = loadSut();
    const { workflowPath } = writeWorkflowFixture();
    const registry = registryFor(workflowPath, 'sha256:fixture');

    assert.equal(
      selectWorkflow(registry, 'h3-r2v-configured-v1', { allowExperimental: true }).status,
      'configured'
    );
  });

  it('always rejects invalid workflows', () => {
    const { selectWorkflow } = loadSut();
    const { workflowPath } = writeWorkflowFixture();
    const registry = registryFor(workflowPath, 'sha256:fixture');

    assert.throws(
      () => selectWorkflow(registry, 'h3-r2v-invalid-v1', { allowExperimental: true }),
      /invalid/i
    );
  });

  it('loads a registry and rejects missing files or hash mismatches', () => {
    const { loadRegistry } = loadSut();
    const { root, workflowPath } = writeWorkflowFixture();
    const registryPath = path.join(root, 'registry.json');
    const registry = registryFor(workflowPath, 'sha256:fixture');
    fs.writeFileSync(registryPath, JSON.stringify(registry));

    assert.throws(() => loadRegistry(registryPath), /sha256|hash/i);
    fs.writeFileSync(registryPath, JSON.stringify({
      ...registry,
      workflows: registry.workflows.map((entry) => ({
        ...entry,
        workflowSha256: undefined,
      })),
    }));
    assert.throws(() => loadRegistry(registryPath), /sha256|hash/i);
  });

  it('rejects a registry entry without an explicit execution contract', () => {
    const { loadRegistry, sha256File } = loadSut();
    const { root, workflowPath } = writeWorkflowFixture();
    const registryPath = path.join(root, 'registry.json');
    const registry = registryFor(workflowPath, sha256File(workflowPath));
    delete registry.workflows[0].execution;
    fs.writeFileSync(registryPath, JSON.stringify({ ...registry, workflows: [registry.workflows[0]] }));

    assert.throws(
      () => loadRegistry(registryPath),
      (error) => error.code === 'WORKFLOW_EXECUTION_INVALID',
    );
  });
});

describe('structured Director workflow input', () => {
  it('maps director fields into the verified ComfyUI graph without exposing node ids', () => {
    const { buildStructuredWorkflowPrompt } = loadSut();
    const workflow = {
      prompt: {
        '5': {
          class_type: 'MiniMaxH3Director',
          inputs: {
            global_prompt: 'old',
            seed: 1,
            frame_rate: 24,
            width: 864,
            height: 480,
            ref_max_size: 864,
            total_frames: 372,
            timeline_data: JSON.stringify({
              totalFrames: 372,
              frameRate: 24,
              width: 864,
              height: 480,
              output: { continuityEnabled: true, continuityOverlapFrames: 22 },
              global: { prompt: 'old' },
              segments: [{ id: 's0', prompt: 'old', length: 124, frameCount: 124 }],
            }),
          },
        },
      },
    };

    const prompt = buildStructuredWorkflowPrompt(workflow, {
      prompt: 'A woman opens an umbrella at a rainy bus stop.',
      seed: 77,
      width: 1280,
      height: 720,
      frameRate: 24,
      durationSeconds: 5,
      continuityMode: 'motion_overlap',
      overlapFrames: 22,
    });

    const inputs = prompt['5'].inputs;
    assert.equal(inputs.global_prompt, 'A woman opens an umbrella at a rainy bus stop.');
    assert.equal(inputs.seed, 77);
    assert.equal(inputs.width, 1280);
    assert.equal(inputs.height, 720);
    assert.equal(inputs.total_frames, 120);
    const timeline = JSON.parse(inputs.timeline_data);
    assert.equal(timeline.totalFrames, 120);
    assert.equal(timeline.segments[0].prompt, 'A woman opens an umbrella at a rainy bus stop.');
    assert.equal(timeline.segments[0].frameCount, 120);
    assert.equal(timeline.output.continuityOverlapFrames, 22);
  });

  it('binds a derived continuity anchor as a role-specific H3 reference', () => {
    const { buildStructuredWorkflowPrompt } = loadSut();
    const workflow = { prompt: { '5': { class_type: 'MiniMaxH3Director', inputs: { timeline_data: '{}' } } } };
    const prompt = buildStructuredWorkflowPrompt(workflow, {
      prompt: 'Continue after the door opens.', continuityMode: 'state_anchor',
      referenceImagePath: 'E:/anchors/door-open.png', referenceRole: 'state',
    });
    const node = prompt['5'];
    const timeline = JSON.parse(node.inputs.timeline_data);
    assert.equal(node.inputs.task_type, 'r2v');
    assert.deepEqual(timeline.segments[0].refs, [{ index: 0, imageFile: 'E:/anchors/door-open.png', role: 'state' }]);
    assert.equal(timeline.segments[0].continuityFromPrev, false);
  });

  it('binds all supplied reference images to Ref2VA timeline metadata', () => {
    const { buildStructuredWorkflowPrompt } = loadSut();
    const workflow = { prompt: { '5': { class_type: 'MiniMaxH3Director', inputs: { timeline_data: '{}' } } } };
    const prompt = buildStructuredWorkflowPrompt(workflow, {
      prompt: 'Preserve the character and mountain path from both references.',
      referenceUrls: ['shot13_character_ref.png', 'shot13_scene_ref.png'],
      referenceRoles: ['subject', 'environment'],
      durationSeconds: 5,
    });
    const node = prompt['5'];
    const timeline = JSON.parse(node.inputs.timeline_data);
    assert.equal(node.inputs.task_type, 'r2v');
    assert.deepEqual(timeline.global.refs, [
      { index: 0, imageFile: 'shot13_character_ref.png', role: 'subject' },
      { index: 1, imageFile: 'shot13_scene_ref.png', role: 'environment' },
    ]);
    assert.deepEqual(timeline.segments[0].refs, timeline.global.refs);
  });
});

describe('official H3 Director R2V registry and adapter', () => {
  it('loads the official Sage workflow with explicit capabilities and API format', () => {
    const { loadRegistry, selectWorkflow } = loadSut();
    const registry = loadRegistry(path.resolve(__dirname, '../configs/director-workflows.json'));
    const entry = selectWorkflow(registry, 'minimax_h3_director_r2v');

    assert.equal(entry.family, 'h3_director');
    assert.equal(entry.adapter, 'h3_director_r2v');
    assert.equal(entry.variant, 'official_sage');
    assert.equal(entry.workflowFormat, 'api');
    assert.equal(entry.inputSchemaVersion, 1);
    assert.deepEqual(entry.capabilities.modes, ['single_reference']);
    assert.equal(entry.capabilities.maxReferenceImages, 9);
    assert.equal(entry.capabilities.supportsContinuity, false);
    assert.equal(entry.capabilities.supportsSage, true);
    assert.equal(entry.capabilities.supportsAudio, true);
    assert.ok(entry.requiredNodes.includes('PathchSageAttentionKJ'));
    assert.ok(entry.requiredNodes.includes('MiniMaxH3Director'));
    assert.equal(entry.requiredNodes.includes('RTXVideoSuperResolution'), false);
    assert.equal(entry.customNodes.includes('RTXVideoSuperResolution'), false);
    assert.equal(entry.capabilities.supportsRtxUpscale, undefined);
    assert.equal(entry.capabilities.outputScale, undefined);
  });

  it('routes official Director frames directly to video encoding without RTX upscaling', () => {
    const { loadRegistry, selectWorkflow, readWorkflowTemplate } = loadSut();
    const entry = selectWorkflow(
      loadRegistry(path.resolve(__dirname, '../configs/director-workflows.json')),
      'minimax_h3_director_r2v',
    );
    const prompt = readWorkflowTemplate(entry.workflowPath).prompt;
    const directorEntry = Object.entries(prompt)
      .find(([, node]) => node.class_type === 'MiniMaxH3Director');
    const upscaleEntry = Object.entries(prompt)
      .find(([, node]) => node.class_type === 'RTXVideoSuperResolution');
    const createVideo = Object.values(prompt)
      .find((node) => node.class_type === 'CreateVideo');

    assert.ok(directorEntry);
    assert.equal(upscaleEntry, undefined);
    assert.deepEqual(createVideo.inputs.images, [directorEntry[0], 0]);
    assert.deepEqual(createVideo.inputs.audio, [directorEntry[0], 1]);
    assert.deepEqual(createVideo.inputs.fps, [directorEntry[0], 2]);
  });

  it('builds a single-segment r2v prompt from staged references and disables continuity', () => {
    const { loadRegistry, selectWorkflow, getWorkflowAdapter } = loadSut();
    const registry = loadRegistry(path.resolve(__dirname, '../configs/director-workflows.json'));
    const entry = selectWorkflow(registry, 'minimax_h3_director_r2v');
    const adapter = getWorkflowAdapter(entry);
    const template = loadSut().readWorkflowTemplate(entry.workflowPath);
    const prompt = adapter.buildPrompt(template, {
      prompt: 'A character walks through a misty forest.',
      width: 864,
      height: 480,
      durationSeconds: 5,
      frameRate: 24,
      seed: 42,
    }, [
      { index: 0, comfyFilename: 'ref_abc.png', role: 'subject' },
      { index: 1, comfyFilename: 'ref_def.png', role: 'environment' },
    ]);
    const node = Object.values(prompt).find((candidate) => candidate.class_type === 'MiniMaxH3Director');
    const timeline = JSON.parse(node.inputs.timeline_data);

    assert.equal(node.inputs.task_type, 'r2v');
    assert.equal(timeline.output.continuityEnabled, false);
    assert.equal(timeline.segments.length, 1);
    assert.equal(timeline.segments[0].id, 's0');
    assert.equal(timeline.segments[0].continuityFromPrev, false);
    assert.deepEqual(timeline.segments[0].refs, [
      { index: 0, imageFile: 'ref_abc.png', role: 'subject' },
      { index: 1, imageFile: 'ref_def.png', role: 'environment' },
    ]);
  });

  it('accepts raw reference aliases when staging has not run yet', () => {
    const { loadRegistry, selectWorkflow, getWorkflowAdapter, readWorkflowTemplate } = loadSut();
    const entry = selectWorkflow(loadRegistry(path.resolve(__dirname, '../configs/director-workflows.json')), 'minimax_h3_director_r2v');
    const adapter = getWorkflowAdapter(entry);
    const prompt = adapter.buildPrompt(readWorkflowTemplate(entry.workflowPath), {
      prompt: 'A subject turns toward camera.',
      referenceImageUrls: ['subject.png'],
      continuityMode: 'none',
    });
    const node = Object.values(prompt).find((candidate) => candidate.class_type === 'MiniMaxH3Director');
    assert.equal(JSON.parse(node.inputs.timeline_data).segments[0].refs[0].imageFile, 'subject.png');
  });

  it('fails closed for unknown adapters and invalid reference counts', () => {
    const { getWorkflowAdapter } = loadSut();
    assert.throws(() => getWorkflowAdapter({ adapter: 'missing-adapter' }), /adapter/i);
    const adapter = getWorkflowAdapter({ adapter: 'h3_director_r2v' });
    assert.throws(() => adapter.validate({ prompt: 'x', stagedAssets: [] }), /reference/i);
    assert.throws(() => adapter.validate({ prompt: 'x', stagedAssets: Array.from({ length: 10 }, (_, i) => ({ comfyFilename: `r${i}.png` })) }), /reference/i);
  });

  it('rejects a UI-format graph and a graph missing Sage or ref2va requirements', () => {
    const { loadRegistry, sha256File } = loadSut();
    const { root, workflowPath } = writeWorkflowFixture();
    const uiPath = path.join(root, 'ui.json');
    fs.writeFileSync(uiPath, JSON.stringify({ nodes: [], links: [], groups: [] }));
    const base = registryFor(workflowPath, sha256File(workflowPath));
    const makeEntry = (target, requiredNodes = ['MiniMaxH3Director']) => ({
      ...base.workflows[0], id: 'minimax_h3_director_r2v', workflowPath: target,
      workflowSha256: sha256File(target), family: 'h3_director', adapter: 'h3_director_r2v',
      variant: 'official_sage', workflowFormat: 'api', inputSchemaVersion: 1,
      capabilities: { modes: ['single_reference'], maxReferenceImages: 9, supportsContinuity: false, supportsAudio: true, supportsSage: true },
      requiredNodes,
    });
    const registryPath = path.join(root, 'registry.json');
    fs.writeFileSync(registryPath, JSON.stringify({ version: 1, workflows: [makeEntry(uiPath)] }));
    assert.throws(() => loadRegistry(registryPath), /API|format|prompt/i);
    fs.writeFileSync(registryPath, JSON.stringify({ version: 1, workflows: [makeEntry(workflowPath)] }));
    assert.throws(() => loadRegistry(registryPath), /required|missing|Sage|ref2va/i);
  });
});
