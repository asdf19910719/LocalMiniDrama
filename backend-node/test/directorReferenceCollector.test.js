const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { collectStoryboardReferenceImages, generationInput } = require('../src/routes/director');

describe('director storyboard reference collection', () => {
  it('collects scene then selected characters and resolves local storage paths', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aistory-refs-'));
    fs.mkdirSync(path.join(root, 'projects'), { recursive: true });
    fs.writeFileSync(path.join(root, 'projects', 'scene.png'), 'scene');
    fs.writeFileSync(path.join(root, 'projects', 'yun.png'), 'character');
    const queries = {
      'SELECT image_url, local_path FROM scenes WHERE id = ? AND deleted_at IS NULL': { image_url: '', local_path: 'projects/scene.png' },
      'SELECT image_url, local_path FROM characters WHERE id = ? AND deleted_at IS NULL': { image_url: '', local_path: 'projects/yun.png' },
    };
    const db = {
      prepare(sql) {
        return {
          get: (id) => sql.includes('scenes') ? queries[Object.keys(queries)[0]] : (id === 3 ? queries[Object.keys(queries)[1]] : null),
          all: () => [],
        };
      },
    };
    const refs = collectStoryboardReferenceImages(db, { id: 17, scene_id: 10, characters: '[3]' }, { storageRoot: root });
    assert.deepEqual(refs, [
      { imageFile: path.join(root, 'projects', 'scene.png'), role: 'environment' },
      { imageFile: path.join(root, 'projects', 'yun.png'), role: 'subject' },
    ]);
  });

  it('uses collected references when the request does not provide explicit images', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aistory-refs-input-'));
    fs.mkdirSync(path.join(root, 'projects'), { recursive: true });
    fs.writeFileSync(path.join(root, 'projects', 'scene.png'), 'scene');
    fs.writeFileSync(path.join(root, 'projects', 'yun.png'), 'character');
    const db = {
      prepare(sql) {
        return {
          get: (id) => sql.includes('scenes')
            ? { image_url: '', local_path: 'projects/scene.png' }
            : (id === 3 ? { image_url: '', local_path: 'projects/yun.png' } : null),
          all: () => [],
        };
      },
    };
    const result = generationInput({ prompt: 'Yun Qing walks along the mountain path.' }, {
      db, shot: { id: 17, drama_id: 3, scene_id: 10, characters: '[3]' }, groupId: 1, inputs: {}, storageRoot: root,
    });
    assert.deepEqual(result.reference_image_urls, [
      path.join(root, 'projects', 'scene.png'),
      path.join(root, 'projects', 'yun.png'),
    ]);
  });

  it('resolves static image URLs to local files when local_path is absent', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aistory-static-'));
    fs.mkdirSync(path.join(root, 'projects', 'p'), { recursive: true });
    fs.writeFileSync(path.join(root, 'projects', 'p', 'scene.png'), 'scene');
    const db = {
      prepare(sql) {
        return {
          get: () => sql.includes('scenes')
            ? { image_url: 'http://localhost:5679/static/projects/p/scene.png', local_path: '' }
            : null,
          all: () => [],
        };
      },
    };
    const refs = collectStoryboardReferenceImages(db, { id: 1, scene_id: 2, characters: '[]' }, { storageRoot: root });
    assert.deepEqual(refs, [{ imageFile: path.join(root, 'projects', 'p', 'scene.png'), role: 'environment' }]);
  });

  it('normalizes explicit static reference URLs before persisting the generation input', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aistory-explicit-static-'));
    fs.mkdirSync(path.join(root, 'projects', 'p'), { recursive: true });
    fs.writeFileSync(path.join(root, 'projects', 'p', 'character.png'), 'character');
    const result = generationInput({ prompt: 'Keep the character identity.' }, {
      db: { prepare() { return { get: () => null, all: () => [] }; } },
      shot: { id: 1, drama_id: 1 },
      groupId: 'g',
      structured: { prompt: 'Keep the character identity.', referenceImageUrls: ['http://localhost:5679/static/projects/p/character.png'] },
      inputs: {},
      storageRoot: root,
    });
    assert.deepEqual(result.reference_image_urls, [path.join(root, 'projects', 'p', 'character.png')]);
  });
});
