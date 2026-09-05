const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const aiClient = require('../src/services/aiClient');

function createConfigDb(baseUrl) {
  const config = {
    id: 1,
    service_type: 'text',
    provider: 'deepseek',
    api_protocol: 'openai',
    name: 'DeepSeek test',
    base_url: baseUrl,
    api_key: 'test-key',
    model: JSON.stringify(['deepseek-v4-flash']),
    default_model: 'deepseek-v4-flash',
    endpoint: '/chat/completions',
    priority: 10,
    is_default: 1,
    is_active: 1,
    settings: JSON.stringify({ deepseek_thinking: 'enabled', deepseek_reasoning_effort: 'high' }),
    deleted_at: null,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  };

  return {
    prepare(sql) {
      return {
        all() {
          if (sql.includes('SELECT id, priority')) return [];
          if (sql.includes('SELECT * FROM ai_service_configs')) return [config];
          return [];
        },
        get() {
          return null;
        },
      };
    },
  };
}

function silentLog() {
  return { info() {}, warn() {}, error() {} };
}

async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve())),
  };
}

function sendSse(res, events) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  for (const event of events) res.write(`data: ${JSON.stringify(event)}\n\n`);
  res.end('data: [DONE]\n\n');
}

test('streaming text appends each content delta exactly once', async () => {
  const server = await listen((_req, res) => sendSse(res, [
    { choices: [{ delta: { content: 'hello ' } }] },
    { choices: [{ delta: { content: 'world' }, finish_reason: 'stop' }] },
  ]));

  try {
    const result = await aiClient.generateText(
      createConfigDb(server.baseUrl), silentLog(), 'text', 'prompt', '', {}
    );
    assert.equal(result, 'hello world');
  } finally {
    await server.close();
  }
});

test('streaming text preserves a UTF-8 character split across response chunks', async () => {
  const expected = '苏妍（@图片2）站在门外';
  const server = await listen(async (_req, res) => {
    const payload = Buffer.from(`data: ${JSON.stringify({
      choices: [{ delta: { content: expected }, finish_reason: 'stop' }],
    })}\n\ndata: [DONE]\n\n`, 'utf8');
    const splitAfter = payload.indexOf(Buffer.from('）', 'utf8')) + 1;
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' });
    res.write(payload.subarray(0, splitAfter));
    await new Promise((resolve) => setTimeout(resolve, 10));
    res.end(payload.subarray(splitAfter));
  });

  try {
    const result = await aiClient.generateText(
      createConfigDb(server.baseUrl), silentLog(), 'text', 'prompt', '', {}
    );
    assert.equal(result, expected);
    assert.equal(result.includes('\uFFFD'), false);
  } finally {
    await server.close();
  }
});

test('thinking stream retries once without thinking when reasoning has no final content', async () => {
  const requestBodies = [];
  const server = await listen((req, res) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const body = JSON.parse(raw);
      requestBodies.push(body);
      if (requestBodies.length === 1) {
        sendSse(res, [
          { choices: [{ delta: { reasoning_content: '先分析剧情结构' } }] },
          { choices: [{ delta: {}, finish_reason: 'length' }] },
        ]);
      } else {
        sendSse(res, [
          { choices: [{ delta: { content: '[{"shot_number":1}]' }, finish_reason: 'stop' }] },
        ]);
      }
    });
  });

  try {
    const result = await aiClient.generateText(
      createConfigDb(server.baseUrl), silentLog(), 'text', 'prompt', '', {}
    );
    assert.equal(result, '[{"shot_number":1}]');
    assert.equal(requestBodies.length, 2);
    assert.deepEqual(requestBodies[0].thinking, { type: 'enabled' });
    assert.deepEqual(requestBodies[1].thinking, { type: 'disabled' });
    assert.equal(requestBodies[1].reasoning_effort, undefined);
  } finally {
    await server.close();
  }
});

test('reasoning progress never replays unchanged content to the storyboard stream callback', async () => {
  const server = await listen((_req, res) => sendSse(res, [
    { choices: [{ delta: { reasoning_content: '先规划镜头' } }] },
    { choices: [{ delta: { content: '[{"shot_number":1}]' } }] },
    { choices: [{ delta: { reasoning_content: '检查完成' }, finish_reason: 'stop' }] },
  ]));
  const streamedContents = [];

  try {
    const result = await aiClient.generateText(
      createConfigDb(server.baseUrl), silentLog(), 'text', 'prompt', '', {
        streamCallback: (content) => streamedContents.push(content),
      }
    );
    assert.equal(result, '[{"shot_number":1}]');
    assert.deepEqual(streamedContents, ['[{"shot_number":1}]']);
  } finally {
    await server.close();
  }
});
