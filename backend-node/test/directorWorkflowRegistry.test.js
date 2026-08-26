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
