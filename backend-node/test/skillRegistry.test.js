const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadSkillPackage, safeResourcePath } = require('../src/services/skillRegistry');

describe('skill registry', () => {
  it('loads the complete base-mode skill package', () => {
    for (const mode of ['T2VA', 'I2VA', 'FL2VA', 'L2VA']) {
      const result = loadSkillPackage('h3-prompt-writing', { mode });
      assert.deepEqual(result.resources.map((item) => item.name), [
        'SKILL.md',
        'references/base-en.txt',
      ]);
      assert.match(result.resources[1].content, /integrated_multimodal_description/);
    }
  });

  it('loads the complete Ref2VA skill package with stable provenance', () => {
    const first = loadSkillPackage('h3-prompt-writing', { mode: 'Ref2VA' });
    const second = loadSkillPackage('h3-prompt-writing', { mode: 'Ref2VA' });
    assert.deepEqual(first.resources.map((item) => item.name), [
      'SKILL.md',
      'references/ref-en.txt',
    ]);
    assert.match(first.resources[1].content, /subject_definitions/);
    assert.match(first.sha256, /^[a-f0-9]{64}$/);
    assert.equal(first.sha256, second.sha256);
  });

  it('rejects non-allowlisted and path-like skill names', () => {
    for (const name of ['../h3-prompt-writing', path.resolve('h3-prompt-writing'), 'unknown']) {
      assert.throws(
        () => loadSkillPackage(name, { mode: 'T2VA' }),
        (error) => error.code === 'SKILL_NOT_ALLOWLISTED',
      );
    }
  });

  it('rejects unsupported modes before reading resources', () => {
    assert.throws(
      () => loadSkillPackage('h3-prompt-writing', { mode: 'UNKNOWN' }),
      (error) => error.code === 'SKILL_RESOURCE_INVALID',
    );
  });

  it('reports a missing skill root with a stable resource error', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-skill-root-'));
    fs.rmSync(root, { recursive: true, force: true });
    assert.throws(
      () => safeResourcePath('h3-prompt-writing', 'SKILL.md', root),
      (error) => error.code === 'SKILL_RESOURCE_MISSING',
    );
  });
});
