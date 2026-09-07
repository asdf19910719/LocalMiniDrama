const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');

describe('asset generation modes', () => {
  it('adds persisted asset and task snapshot columns with safe defaults', () => {
    const db = new Database(':memory:');
    runMigrationsAndEnsure(db);

    const column = (table, name) => db.prepare(`PRAGMA table_info(${table})`).all().find((item) => item.name === name);
    assert.equal(column('characters', 'asset_mode').dflt_value, "'TURNAROUND'");
    assert.equal(column('character_variants', 'asset_mode').dflt_value, "'SINGLE'");
    assert.equal(column('character_variants', 'use_identity_reference').dflt_value, '1');
    assert.equal(column('scenes', 'asset_mode').dflt_value, "'NORMAL'");
    assert.ok(column('image_generation_tasks', 'asset_mode'));
    assert.ok(column('image_generation_tasks', 'negative_prompt_snapshot'));
    assert.ok(column('image_generation_tasks', 'style_snapshot'));
    db.close();
  });

  it('normalizes only modes supported by each asset type', () => {
    const modes = require('../src/services/assetGenerationModes');
    assert.equal(modes.defaultAssetMode('character'), 'TURNAROUND');
    assert.equal(modes.defaultAssetMode('character_variant'), 'SINGLE');
    assert.equal(modes.defaultAssetMode('scene'), 'NORMAL');
    assert.equal(modes.normalizeAssetMode('character', 'single'), 'SINGLE');
    assert.equal(modes.normalizeAssetMode('character_variant', 'turnaround'), 'TURNAROUND');
    assert.equal(modes.normalizeAssetMode('scene', 'quad_grid'), 'QUAD_GRID');
    assert.deepEqual(modes.allowedAssetModes('scene'), ['NORMAL', 'QUAD_GRID']);
    assert.throws(() => modes.normalizeAssetMode('scene', 'TURNAROUND'), /Unsupported asset generation mode/);
    assert.throws(() => modes.normalizeAssetMode('character', 'PANORAMA'), /Unsupported asset generation mode/);
  });

  it('adds multi-view layout rules only to turnaround prompts', () => {
    const { buildModePrompt } = require('../src/services/assetGenerationModes');
    const single = buildModePrompt('character_variant', 'SINGLE', '白色衬衫，湿发');
    const turnaround = buildModePrompt('character_variant', 'TURNAROUND', '白色衬衫，湿发');
    assert.equal(single, '白色衬衫，湿发');
    assert.match(turnaround, /正面、正侧面、背面/);
    assert.match(turnaround, /白色衬衫，湿发/);
  });
});
