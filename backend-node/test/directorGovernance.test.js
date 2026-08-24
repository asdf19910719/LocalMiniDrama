const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  assertAllowedLocalPath,
  validateWorkflowGovernance,
  compareRuntimeLock,
  createGovernanceSnapshot,
} = require('../src/director/directorGovernance');

function governanceFixture() {
  return {
    provenance: {
      provider: 'MiniMax',
      modelFamily: 'MiniMax H3',
      source: 'local model files',
      license: { status: 'review_required', evidence: 'docs/research/h3-model-license-review.md' },
    },
    runtimeLock: {
      comfyUIVersion: '0.33.1',
      models: [{
        fileName: 'h3.safetensors',
        relativePath: 'diffusion_models/h3.safetensors',
        sha256: 'c'.repeat(64),
        fileSizeBytes: 123,
      }],
      customNodes: [{
        name: 'ComfyUI_MiniMaxH3_Director',
        files: [{ path: '__init__.py', sha256: 'a'.repeat(64) }],
      }],
    },
  };
}

describe('Director production governance', () => {
  it('allows paths under configured roots and rejects traversal or outside paths', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'director-allowed-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'director-outside-'));
    const input = path.join(root, 'input.mp4');
    fs.writeFileSync(input, 'media');

    assert.equal(assertAllowedLocalPath(input, [root], { mustExist: true }), fs.realpathSync(input));
    assert.throws(
      () => assertAllowedLocalPath(path.join(outside, 'escape.mp4'), [root], { mustExist: false }),
      /allowed local roots/i,
    );
    assert.throws(
      () => assertAllowedLocalPath(path.join(root, '..', path.basename(outside), 'escape.mp4'), [root], { mustExist: false }),
      /allowed local roots/i,
    );
  });

  it('requires explicit provenance, license state, and runtime hashes', () => {
    const valid = governanceFixture();
    assert.doesNotThrow(() => validateWorkflowGovernance(valid, 'h3-v1'));
    assert.throws(
      () => validateWorkflowGovernance({ ...valid, provenance: { ...valid.provenance, license: null } }, 'h3-v1'),
      /license/i,
    );
    const invalidHash = governanceFixture();
    invalidHash.runtimeLock.customNodes[0].files[0].sha256 = 'not-a-hash';
    assert.throws(() => validateWorkflowGovernance(invalidHash, 'h3-v1'), /sha256/i);
    const filenameOnly = governanceFixture();
    filenameOnly.runtimeLock.models[0] = { fileName: 'h3.safetensors', integrity: 'filename-only' };
    assert.throws(() => validateWorkflowGovernance(filenameOnly, 'h3-v1'), /sha256|relativePath|file size/i);
  });

  it('reports runtime drift and creates an immutable artifact snapshot', () => {
    const governance = governanceFixture();
    const comparison = compareRuntimeLock(governance.runtimeLock, {
      comfyUIVersion: '0.34.0',
      models: [{ fileName: 'h3.safetensors' }],
      customNodes: [{
        name: 'ComfyUI_MiniMaxH3_Director',
        files: [{ path: '__init__.py', sha256: 'b'.repeat(64) }],
      }],
    });
    assert.equal(comparison.compatible, false);
    assert.match(comparison.mismatches.join('\n'), /ComfyUI|custom node/i);

    const snapshot = createGovernanceSnapshot({ id: 'h3-v1', workflowSha256: 'sha256:abc', ...governance });
    governance.runtimeLock.comfyUIVersion = 'changed-after-snapshot';
    assert.equal(snapshot.workflowId, 'h3-v1');
    assert.equal(snapshot.runtimeLock.comfyUIVersion, '0.33.1');
    assert.equal(snapshot.provenance.license.status, 'review_required');
  });
});
