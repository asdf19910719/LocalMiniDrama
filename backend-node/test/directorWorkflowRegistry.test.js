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
    assert.equal(node.inputs.steps, 20);
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

describe('official H3 Director R2V TE-Speed graph', () => {
  const teWorkflowPath = path.resolve(__dirname, '../configs/workflows/minimax_h3_director_r2v_te_speed.json');

  it('places one original TE-Speed node after Sage and before Director', () => {
    assert.equal(fs.existsSync(teWorkflowPath), true, `missing TE workflow: ${teWorkflowPath}`);
    const workflow = JSON.parse(fs.readFileSync(teWorkflowPath, 'utf8')).prompt;
    const entries = Object.entries(workflow);
    const nodes = (type) => entries.filter(([, node]) => node.class_type === type);
    assert.equal(nodes('TESpeedMiniMaxH3').length, 1);
    const [teId, te] = nodes('TESpeedMiniMaxH3')[0];
    const [sageId, sage] = nodes('PathchSageAttentionKJ')[0];
    const [unetId] = nodes('UNETLoader')[0];
    const [, director] = nodes('MiniMaxH3Director')[0];
    assert.deepEqual(sage.inputs.model, [unetId, 0]);
    assert.deepEqual(te.inputs.model, [sageId, 0]);
    assert.deepEqual(director.inputs.model, [teId, 0]);
    assert.deepEqual({
      processing_control_value: te.inputs.processing_control_value,
      processing_percent_1: te.inputs.processing_percent_1,
      processing_percent_2: te.inputs.processing_percent_2,
      mcs: te.inputs.mcs,
      device: te.inputs.device,
      mode: te.inputs.mode,
    }, {
      processing_control_value: 0.08,
      processing_percent_1: 0.1,
      processing_percent_2: 0.9,
      mcs: 2,
      device: 'auto',
      mode: 'standard',
    });
    assert.equal(director.inputs.steps, 20);
    assert.equal(director.inputs.scheduler, 'simple');
    assert.equal(director.inputs.sampler, 'res_multistep');
  });

  it('registers the verified TE-Speed workflow with immutable original-node provenance', () => {
    const { loadRegistry, selectWorkflow } = loadSut();
    const registry = loadRegistry(path.resolve(__dirname, '../configs/director-workflows.json'));
    const entry = selectWorkflow(registry, 'minimax_h3_director_r2v_te_speed');
    assert.equal(entry.status, 'verified');
    assert.equal(entry.adapterVersion, 'v2');
    assert.equal(entry.capabilities.supportsTESpeed, true);
    assert.equal(entry.capabilities.approximateAcceleration, true);
    assert.ok(entry.requiredNodes.includes('TESpeedMiniMaxH3'));
    assert.equal(entry.acceleration.implementation, 'TE-Speed-MiniMaxH3');
    assert.equal(entry.acceleration.commitSha, 'beda0e4be76367625b5e82500b7c4867c3d8bbd6');
    assert.equal(entry.acceleration.binarySha256, 'sha256:84bb1ba6f82116c764acfada127c3553b238586a8272315337cea3bcb1d0ee9c');
    assert.equal(entry.acceleration.cachePolicy, 'te_node_always_changed');
  });

  it('detects TE-Speed capabilities and rejects unsafe graph variants', () => {
    assert.equal(fs.existsSync(teWorkflowPath), true, `missing TE workflow: ${teWorkflowPath}`);
    const { validateWorkflow, describeCapabilities } = require('../src/director/adapters/h3DirectorR2VAdapter');
    const workflow = JSON.parse(fs.readFileSync(teWorkflowPath, 'utf8'));
    assert.equal(describeCapabilities(workflow).supportsTESpeed, true);
    assert.equal(describeCapabilities(workflow).approximateAcceleration, true);

    const beforeSage = structuredClone(workflow);
    beforeSage.prompt['9'].inputs.model = ['1', 0];
    assert.throws(() => validateWorkflow(beforeSage), /Sage.*TE-Speed|chain|connection/i);

    const duplicate = structuredClone(workflow);
    duplicate.prompt['10'] = structuredClone(duplicate.prompt['9']);
    assert.throws(() => validateWorkflow(duplicate), /exactly one|one TE-Speed/i);

    const spectrum = structuredClone(workflow);
    spectrum.prompt['10'] = { class_type: 'SpectrumApplyMiniMaxH3', inputs: { model: ['9', 0] } };
    assert.throws(() => validateWorkflow(spectrum), /Spectrum/i);
  });

  it('does not expose TE-Speed parameters through business input', () => {
    assert.equal(fs.existsSync(teWorkflowPath), true, `missing TE workflow: ${teWorkflowPath}`);
    const { buildPrompt } = require('../src/director/adapters/h3DirectorR2VAdapter');
    const workflow = JSON.parse(fs.readFileSync(teWorkflowPath, 'utf8'));
    const prompt = buildPrompt(workflow, {
      prompt: 'A subject turns toward camera.',
      referenceImageUrls: ['subject.png'],
      processing_control_value: 1,
      mcs: 10,
      device: 'gpu',
      mode: '4-step LoRA',
    });
    assert.equal(prompt['9'].inputs.processing_control_value, 0.08);
    assert.equal(prompt['9'].inputs.mcs, 2);
    assert.equal(prompt['9'].inputs.device, 'auto');
    assert.equal(prompt['9'].inputs.mode, 'standard');
  });
});
