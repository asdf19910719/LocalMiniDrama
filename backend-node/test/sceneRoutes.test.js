const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const sceneService = require('../src/services/sceneService');
const createSceneRoutes = require('../src/routes/scenes');

function createResponseRecorder() {
  return {
    statusCode: null,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

async function invoke(handler, { body = {}, params = {} } = {}) {
  const res = createResponseRecorder();
  await handler({ body, params }, res);
  return res;
}

function createSceneDb(assetMode = 'NORMAL') {
  return {
    prepare(sql) {
      assert.match(sql, /SELECT id, asset_mode FROM scenes/);
      return { get: () => ({ id: 17, asset_mode: assetMode }) };
    },
  };
}

function installGenerationStubs() {
  const originals = {
    generateSceneFourViewImage: sceneService.generateSceneFourViewImage,
    generateSceneSingleImage: sceneService.generateSceneSingleImage,
    generateScenePromptOnly: sceneService.generateScenePromptOnly,
    generateSceneSinglePromptOnly: sceneService.generateSceneSinglePromptOnly,
  };

  sceneService.generateSceneFourViewImage = async () => ({
    ok: true,
    image_generation: { id: 'four-view-image' },
  });
  sceneService.generateSceneSingleImage = async () => ({
    ok: true,
    image_generation: { id: 'single-image' },
  });
  sceneService.generateScenePromptOnly = async () => ({
    ok: true,
    polished_prompt: 'four-view-prompt',
  });
  sceneService.generateSceneSinglePromptOnly = async () => ({
    ok: true,
    polished_prompt_single: 'single-image-prompt',
  });

  return () => Object.assign(sceneService, originals);
}

describe('scene generation route mode selection', { concurrency: false }, () => {
  test('uses the single-image generator when use_quad_grid is false', async () => {
    const restore = installGenerationStubs();
    try {
      const routes = createSceneRoutes(createSceneDb(), console, {});
      const res = await invoke(routes.generateImage, {
        body: { scene_id: 17, use_quad_grid: false },
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.payload.data.message, '场景单图生成任务已提交');
      assert.equal(res.payload.data.image_generation.id, 'single-image');
    } finally {
      restore();
    }
  });

  test('defaults the general scene image endpoint to a single image', async () => {
    const restore = installGenerationStubs();
    try {
      const routes = createSceneRoutes(createSceneDb(), console, {});
      const res = await invoke(routes.generateImage, { body: { scene_id: 17 } });

      assert.equal(res.statusCode, 200);
      assert.equal(res.payload.data.message, '场景单图生成任务已提交');
      assert.equal(res.payload.data.image_generation.id, 'single-image');
    } finally {
      restore();
    }
  });

  test('uses the four-view generator only when use_quad_grid is explicitly true', async () => {
    const restore = installGenerationStubs();
    try {
      const routes = createSceneRoutes(createSceneDb(), console, {});
      const res = await invoke(routes.generateImage, {
        body: { scene_id: 17, use_quad_grid: true },
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.payload.data.message, '场景四视图生成任务已提交');
      assert.equal(res.payload.data.image_generation.id, 'four-view-image');
    } finally {
      restore();
    }
  });

  test('uses the single-image prompt generator for mode single', async () => {
    const restore = installGenerationStubs();
    try {
      const routes = createSceneRoutes({}, console, {});
      const res = await invoke(routes.generatePrompt, {
        params: { scene_id: '17' },
        body: { mode: 'single' },
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.payload.data.message, '单图提示词已生成');
      assert.equal(res.payload.data.polished_prompt_single, 'single-image-prompt');
      assert.equal('polished_prompt' in res.payload.data, false);
    } finally {
      restore();
    }
  });

  test('keeps the existing four-view prompt behavior when mode is omitted', async () => {
    const restore = installGenerationStubs();
    try {
      const routes = createSceneRoutes({}, console, {});
      const res = await invoke(routes.generatePrompt, {
        params: { scene_id: '17' },
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.payload.data.message, '提示词已生成');
      assert.equal(res.payload.data.polished_prompt, 'four-view-prompt');
    } finally {
      restore();
    }
  });
});
