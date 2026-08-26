const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const aiClient = require('../src/services/aiClient');

function createConfigDb(baseUrl) {
  const config = {
    id: 42,
    service_type: 'text',
    provider: 'openai',
    api_protocol: 'openai',
    name: 'Tool-call test',
    base_url: baseUrl,
    api_key: 'test-key',
    model: JSON.stringify(['tool-model']),
    default_model: 'tool-model',
    endpoint: '/chat/completions',
    priority: 10,
    is_default: 1,
    is_active: 1,
    settings: JSON.stringify({ max_tokens: 4096 }),
    deleted_at: null,
  };
  return {
    prepare(sql) {
      return {
        all() {
          if (sql.includes('SELECT id, priority')) return [];
          if (sql.includes('SELECT * FROM ai_service_configs')) return [config];
          return [];
        },
        get(key) {
          if (sql.includes('FROM ai_model_map') && key === 'h3_prompt_compile') {
            return { key, service_type: 'text', config_id: 42, model_override: 'tool-model' };
          }
          return null;
        },
      };
    },
  };
}

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((done, reject) => server.close((error) => error ? reject(error) : done())),
  })));
}

test('createChatCompletion preserves a model tool call and sends forced tool options', async () => {
  let requestBody;
  const server = await listen((req, res) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      requestBody = JSON.parse(raw);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: 'call-1',
              type: 'function',
              function: {
                name: 'load_skill',
                arguments: '{"skill_name":"h3-prompt-writing"}',
              },
            }],
          },
        }],
      }));
    });
  });
  const tools = [{ type: 'function', function: { name: 'load_skill', parameters: { type: 'object' } } }];
  const toolChoice = { type: 'function', function: { name: 'load_skill' } };

  try {
    const result = await aiClient.createChatCompletion(
      createConfigDb(server.baseUrl),
      { info() {}, warn() {}, error() {} },
      'text',
      [{ role: 'user', content: 'compile' }],
      {
        scene_key: 'h3_prompt_compile',
        tools,
        tool_choice: toolChoice,
        temperature: 0.2,
        max_tokens: 1800,
      },
    );
    assert.equal(requestBody.stream, false);
    assert.deepEqual(requestBody.tools, tools);
    assert.deepEqual(requestBody.tool_choice, toolChoice);
    assert.deepEqual(requestBody.messages, [{ role: 'user', content: 'compile' }]);
    assert.equal(result.message.tool_calls[0].id, 'call-1');
    assert.equal(result.message.content, null);
    assert.equal(result.model, 'tool-model');
    assert.equal(result.configId, 42);
    assert.equal(typeof result.elapsedMs, 'number');
  } finally {
    await server.close();
  }
});
