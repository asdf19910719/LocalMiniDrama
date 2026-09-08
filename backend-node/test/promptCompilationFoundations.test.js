const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { resolvePromptLanguage, selectStylePrompt } = require('../src/services/promptLanguageResolver');
const { createReferenceRegistry } = require('../src/services/referenceRegistry');
const { validateGenerationCapabilities } = require('../src/services/modelCapabilityValidator');
const { freezeGenerationSnapshot, markSnapshotSubmitted } = require('../src/services/generationSnapshotService');

const style = { id: 'rh-101-cinematic', version: 1, promptZh: '中文电影风格', promptEn: 'English cinematic style', recommendedCapabilities: { preferredPromptLanguage: 'zh', renderType: 'realistic' } };

test('prompt language follows explicit model, capability, style, then mixed precedence', () => {
  assert.equal(resolvePromptLanguage({ modelConfig: { prompt_language: 'en' }, modelCapabilities: { promptLanguage: 'zh' }, style }), 'en');
  assert.equal(resolvePromptLanguage({ modelCapabilities: { promptLanguage: 'mixed' }, style }), 'mixed');
  assert.equal(resolvePromptLanguage({ style }), 'zh');
  assert.equal(resolvePromptLanguage({}), 'mixed');
  assert.match(selectStylePrompt(style, 'mixed'), /中文电影风格[\s\S]+English cinematic style/);
});

test('reference registry produces stable provider order and language labels', () => {
  const refs = createReferenceRegistry([
    { path: 'b.png', name: '场景', sortOrder: 2 },
    { path: 'a.png', name: '人物', sortOrder: 1, realPerson: true },
  ], 'en');
  assert.deepEqual(refs.promptLabels, ['@Image1', '@Image2']);
  assert.deepEqual(refs.providerImages.map((item) => item.source), ['a.png', 'b.png']);
  assert.equal(refs.entries[0].realPerson, true);
});

test('capability validator blocks limits and forbidden real people without changing models', () => {
  const references = createReferenceRegistry([{ path: 'a', realPerson: true }, { path: 'b' }]);
  const result = validateGenerationCapabilities({ mediaType: 'video', references, capabilities: { maxReferences: 1, allowRealPerson: false, supportsVideo: true } });
  assert.equal(result.status, 'blocked');
  assert.deepEqual(result.errors.map((item) => item.code), ['REFERENCE_LIMIT_EXCEEDED', 'REAL_PERSON_REFERENCE_FORBIDDEN']);
});

test('snapshot is frozen before submission and can transition exactly once', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE generation_style_snapshots (id TEXT PRIMARY KEY, drama_id INTEGER, target_type TEXT, target_id TEXT, media_type TEXT, style_id TEXT, style_version INTEGER, language TEXT, final_prompt TEXT, negative_prompt TEXT, references_json TEXT, sections_json TEXT, capability_validation_json TEXT, status TEXT, created_at TEXT, submitted_at TEXT);`);
  const snapshot = freezeGenerationSnapshot(db, { dramaId: 1, targetType: 'scene', targetId: 3, mediaType: 'image', style, language: 'en', finalPrompt: 'final', references: [], sections: {}, capabilityValidation: { status: 'ok', errors: [], warnings: [] } });
  assert.equal(db.prepare('SELECT status FROM generation_style_snapshots WHERE id=?').get(snapshot.id).status, 'compiled');
  assert.equal(markSnapshotSubmitted(db, snapshot.id).status, 'submitted');
  assert.throws(() => markSnapshotSubmitted(db, snapshot.id), (error) => error.code === 'SNAPSHOT_STATE_CONFLICT');
  assert.throws(() => freezeGenerationSnapshot(db, { ...snapshot, id: 'blocked', capabilityValidation: { status: 'blocked', errors: [{ code: 'NO' }] } }), (error) => error.code === 'CAPABILITY_VALIDATION_FAILED');
});
