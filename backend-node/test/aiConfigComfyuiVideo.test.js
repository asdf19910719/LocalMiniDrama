const { test } = require('node:test');
const assert = require('node:assert/strict');
const aiConfigService = require('../src/services/aiConfigService');
const aiConfigRoutes = require('../src/routes/aiConfig');

function createDb() {
  const rows = [];
  return {
    prepare(sql) {
      if (sql.startsWith('INSERT INTO ai_service_configs')) {
        return {
          run(...values) {
            const [service_type, provider, api_protocol, name, base_url, api_key, model, default_model,
              endpoint, query_endpoint, priority, is_default, settings, created_at, updated_at] = values;
            const id = rows.length + 1;
            rows.push({ id, service_type, provider, api_protocol, name, base_url, api_key, model, default_model,
              endpoint, query_endpoint, priority, is_default, is_active: 1, settings, created_at, updated_at, deleted_at: null });
            return { lastInsertRowid: id };
          },
        };
      }
      if (sql.startsWith('SELECT * FROM ai_service_configs WHERE id')) {
        return { get(id) { return rows.find((row) => row.id === id && row.deleted_at == null); } };
      }
      if (sql.startsWith('SELECT id, priority')) {
        return { all(serviceType) { return rows.filter((row) => row.service_type === serviceType && row.is_default && row.deleted_at == null); } };
      }
      if (sql.startsWith('UPDATE ai_service_configs SET is_default = 0')) {
        return { run(serviceType, exceptId) {
          rows.filter((row) => row.service_type === serviceType && row.id !== exceptId && row.deleted_at == null)
            .forEach((row) => { row.is_default = 0; });
          return { changes: 0 };
        } };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

const log = { info() {}, error() {}, errorw() {} };

function responseRecorder() {
  const result = {};
  return {
    result,
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; return this; },
  };
}

test('creates a ComfyUI video config with an empty key, local URL, workflow, and numeric dimensions', () => {
  const db = createDb();
  const config = aiConfigService.createConfig(db, log, {
    service_type: 'video',
    provider: 'comfyui',
    name: 'ComfyUI 视频',
    base_url: '',
    api_key: '',
    model: ['h3-continuity-v1'],
    default_model: 'h3-continuity-v1',
    settings: JSON.stringify({ width: '1280', height: '704' }),
    is_default: true,
  });

  assert.equal(config.base_url, 'http://127.0.0.1:8188');
  assert.equal(config.api_key, '');
  assert.deepEqual(config.model, ['h3-continuity-v1']);
  assert.equal(config.default_model, 'h3-continuity-v1');
  assert.deepEqual(JSON.parse(config.settings), { width: 1280, height: 704 });
});

test('uses the shared ComfyUI provider for a read-only connection check and returns Chinese checks', async () => {
  const calls = [];
  const routes = aiConfigRoutes(createDb(), log, {}, {
    providerRegistry: {
      get(name) {
        assert.equal(name, 'comfyui');
        return {
          async testConnection(context) {
            calls.push(context);
            return {
              providerTaskId: null,
              status: 'completed',
              progress: 100,
              output: {
                workflow: { id: 'h3-continuity-v1', sha256: 'sha256:abc' },
                queue: { queue_running: [] },
                nodes: { required: ['SaveVideo'] },
                models: { required: ['minimax-h3.safetensors'] },
                vram: { totalVramMb: 24576, availableVramMb: 24064 },
                inferenceStarted: false,
              },
            };
          },
        };
      },
    },
  });
  const res = responseRecorder();

  await routes.testConnection({ body: {
    service_type: 'video', provider: 'comfyui', base_url: 'http://127.0.0.1:8188', api_key: '',
    model: 'h3-continuity-v1', settings: JSON.stringify({ width: 1280, height: 704 }),
  } }, res);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, 'h3-continuity-v1');
  assert.equal(calls[0].base_url, 'http://127.0.0.1:8188');
  assert.deepEqual(calls[0].config.settings, { width: 1280, height: 704 });
  assert.deepEqual(res.result.body.data, {
    ok: true,
    provider: 'comfyui',
    checks: [
      { name: '工作流', ok: true, message: '工作流 h3-continuity-v1 校验通过' },
      { name: '队列', ok: true, message: '已读取 ComfyUI 队列状态' },
      { name: '节点', ok: true, message: '必需节点已就绪' },
      { name: '模型', ok: true, message: '必需模型已就绪' },
      { name: '显存', ok: true, message: '可用显存 24064 MB' },
    ],
    message: 'ComfyUI 连接检查通过，未启动推理任务',
  });
});
