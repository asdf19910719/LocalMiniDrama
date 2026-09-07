const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const characterLibraryService = require('../src/services/characterLibraryService');
const sceneService = require('../src/services/sceneService');
const characterRoutes = require('../src/routes/characters');
const sceneRoutes = require('../src/routes/scenes');

const log = { info() {}, warn() {}, error() {} };

function responseRecorder() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function modeDb(characterMode = 'TURNAROUND', sceneMode = 'NORMAL') {
  return {
    prepare(sql) {
      return {
        get() {
          if (sql.includes('FROM characters')) return { id: 7, asset_mode: characterMode };
          if (sql.includes('FROM scenes')) return { id: 9, asset_mode: sceneMode };
          return null;
        },
      };
    },
  };
}

describe('asset generation route mode dispatch', () => {
  it('dispatches a character SINGLE request to the single-image generator', async () => {
    const originalSingle = characterLibraryService.generateCharacterImage;
    const originalTurnaround = characterLibraryService.generateCharacterFourViewImage;
    const calls = [];
    characterLibraryService.generateCharacterImage = async () => {
      calls.push('SINGLE');
      return { ok: true, image_generation: { id: 1 } };
    };
    characterLibraryService.generateCharacterFourViewImage = async () => {
      calls.push('TURNAROUND');
      return { ok: true, image_generation: { id: 2 } };
    };
    try {
      const res = responseRecorder();
      await characterRoutes(modeDb(), {}, log, {}).generateImage(
        { params: { id: '7' }, body: { asset_mode: 'SINGLE' } },
        res
      );
      assert.equal(res.statusCode, 200);
      assert.deepEqual(calls, ['SINGLE']);
      assert.match(res.body.data.message, /单图/);
    } finally {
      characterLibraryService.generateCharacterImage = originalSingle;
      characterLibraryService.generateCharacterFourViewImage = originalTurnaround;
    }
  });

  it('uses the persisted character mode when a request omits asset_mode', async () => {
    const originalSingle = characterLibraryService.generateCharacterImage;
    const originalTurnaround = characterLibraryService.generateCharacterFourViewImage;
    const calls = [];
    characterLibraryService.generateCharacterImage = async () => ({ ok: true, image_generation: { id: 1 } });
    characterLibraryService.generateCharacterFourViewImage = async () => {
      calls.push('TURNAROUND');
      return { ok: true, image_generation: { id: 2 } };
    };
    try {
      const res = responseRecorder();
      await characterRoutes(modeDb('TURNAROUND'), {}, log, {}).generateImage(
        { params: { id: '7' }, body: {} },
        res
      );
      assert.equal(res.statusCode, 200);
      assert.deepEqual(calls, ['TURNAROUND']);
    } finally {
      characterLibraryService.generateCharacterImage = originalSingle;
      characterLibraryService.generateCharacterFourViewImage = originalTurnaround;
    }
  });

  it('rejects an unsupported character mode instead of returning 500', async () => {
    const res = responseRecorder();
    await characterRoutes(modeDb(), {}, log, {}).generateImage(
      { params: { id: '7' }, body: { asset_mode: 'PANORAMA' } },
      res
    );
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error.message, /Unsupported asset generation mode/);
  });

  it('dispatches scene QUAD_GRID and preserves the legacy boolean fallback', async () => {
    const originalSingle = sceneService.generateSceneSingleImage;
    const originalQuad = sceneService.generateSceneFourViewImage;
    const calls = [];
    sceneService.generateSceneSingleImage = async () => ({ ok: true, image_generation: { id: 1 } });
    sceneService.generateSceneFourViewImage = async () => {
      calls.push('QUAD_GRID');
      return { ok: true, image_generation: { id: 2 } };
    };
    try {
      const routes = sceneRoutes(modeDb(), log, {});
      const explicitRes = responseRecorder();
      await routes.generateImage({ body: { scene_id: 9, asset_mode: 'QUAD_GRID' } }, explicitRes);
      const legacyRes = responseRecorder();
      await routes.generateImage({ body: { scene_id: 9, use_quad_grid: true } }, legacyRes);
      assert.equal(explicitRes.statusCode, 200);
      assert.equal(legacyRes.statusCode, 200);
      assert.deepEqual(calls, ['QUAD_GRID', 'QUAD_GRID']);
    } finally {
      sceneService.generateSceneSingleImage = originalSingle;
      sceneService.generateSceneFourViewImage = originalQuad;
    }
  });

  it('rejects an unsupported scene mode instead of returning 500', async () => {
    const res = responseRecorder();
    await sceneRoutes(modeDb(), log, {}).generateImage(
      { body: { scene_id: 9, asset_mode: 'TOP_DOWN' } },
      res
    );
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error.message, /Unsupported asset generation mode/);
  });
});
