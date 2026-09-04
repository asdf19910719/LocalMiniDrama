const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createComfyUIClient, parseFfmpegProbe } = require('../src/director/comfyuiClient');

describe('ComfyUI Director client', () => {
  let server;
  let baseUrl;
  let requests;
  let outputDir;

  before(async () => {
    requests = [];
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyui-client-'));
    server = http.createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      requests.push({ method: req.method, url: req.url, body });
      if (req.method === 'POST' && req.url === '/prompt') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ prompt_id: 'prompt-1', number: 4 }));
        return;
      }
      if (req.method === 'GET' && req.url === '/history/prompt-1') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ 'prompt-1': { status: { completed: true, status_str: 'success' }, outputs: { '7': { gifs: [{ filename: 'shot.mp4', subfolder: 'director', type: 'output' }] } } } }));
        return;
      }
      if (req.method === 'GET' && req.url === '/history/prompt-running') {
        res.setHeader('content-type', 'application/json');
        res.end('{}');
        return;
      }
      if (req.method === 'GET' && req.url === '/history/prompt-interrupted') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          'prompt-interrupted': {
            prompt: [3, 'prompt-interrupted', {}, { client_id: 'video-1' }, []],
            outputs: {},
            status: {
              status_str: 'error',
              completed: false,
              messages: [
                ['execution_start', { prompt_id: 'prompt-interrupted' }],
                ['execution_interrupted', {
                  prompt_id: 'prompt-interrupted', node_id: '5', node_type: 'MiniMaxH3Director', executed: [],
                }],
              ],
            },
          },
        }));
        return;
      }
      if (req.method === 'GET' && req.url === '/system_stats') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ devices: [{ name: 'test-gpu', vram_total: 1024 }] }));
        return;
      }
      if (req.method === 'GET' && req.url === '/queue') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ queue_running: [[1, 'prompt-running', {}]], queue_pending: [] }));
        return;
      }
      if (req.method === 'GET' && req.url === '/object_info') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ MiniMaxH3Director: {}, SaveVideo: {} }));
        return;
      }
      if (req.method === 'GET' && req.url === '/models/diffusion_models') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(['minimax-h3.safetensors']));
        return;
      }
      if (req.method === 'GET' && req.url.startsWith('/view?')) {
        res.setHeader('content-type', 'video/mp4');
        res.end(Buffer.from('fake-mp4'));
        return;
      }
      if (req.method === 'POST' && (req.url === '/queue' || req.url === '/interrupt')) {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'not found' }));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(outputDir, { recursive: true, force: true });
  });

  it('submits a registry-selected workflow, polls history, and downloads the output', async () => {
    const client = createComfyUIClient({
      baseUrl,
      pollIntervalMs: 0,
      outputDir,
      probeMedia: async (artifactPath) => ({
        format: { filename: artifactPath, duration: '1.5' },
        streams: [{ codec_type: 'video', width: 864, height: 480 }],
      }),
    });
    const registry = {
      workflows: [
        { id: 'verified-workflow', status: 'verified', workflowSha256: 'sha256:abc', workflowPath: 'unused' },
        { id: 'invalid-workflow', status: 'invalid', workflowSha256: 'sha256:def' },
        { id: 'configured-workflow', status: 'configured', workflowSha256: 'sha256:ghi', workflowPath: 'unused' },
      ],
    };
    const result = await client.runWorkflow({
      registry,
      workflowId: 'verified-workflow',
      prompt: { '1': { class_type: 'SaveVideo', inputs: {} } },
      inputs: { prompt: 'rainy street', seed: 11 },
      outputFileName: 'shot.mp4',
    });

    assert.equal(result.promptId, 'prompt-1');
    assert.equal(result.workflowId, 'verified-workflow');
    assert.equal(fs.readFileSync(result.artifactPath, 'utf8'), 'fake-mp4');
    assert.equal(result.ffprobe.format.duration, '1.5');
    const submitted = JSON.parse(requests.find((request) => request.url === '/prompt').body);
    assert.equal(submitted.extra_data.director_workflow_id, 'verified-workflow');
    assert.equal(submitted.extra_data.director_workflow_sha256, 'sha256:abc');
    assert.equal(submitted.prompt['1'].class_type, 'SaveVideo');
    assert.equal(submitted.extra_data.inputs.seed, 11);
    await assert.rejects(
      () => client.runWorkflow({ registry, workflowId: 'invalid-workflow', prompt: {} }),
      /invalid workflow/i
    );
    await assert.rejects(
      () => client.runWorkflow({ registry, workflowId: 'configured-workflow', prompt: {} }),
      /experimental/i
    );
  });

  it('fails a stuck ComfyUI request with a stable timeout error', async () => {
    const client = createComfyUIClient({
      fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      }),
      requestTimeoutMs: 10,
    });
    const registry = {
      workflows: [{ id: 'verified-workflow', status: 'verified', workflowSha256: 'sha256:abc', workflowPath: 'unused' }],
    };

    await assert.rejects(
      () => client.submitWorkflow({
        registry,
        workflowId: 'verified-workflow',
        prompt: { '1': { class_type: 'SaveVideo', inputs: {} } },
      }),
      (error) => error.code === 'COMFYUI_TIMEOUT' && /timed out/i.test(error.message)
    );
  });

  it('parses duration and audio/video streams from ffmpeg fallback output', () => {
    const result = parseFfmpegProbe(`
      Duration: 00:00:15.29, start: 0.000000, bitrate: 1281 kb/s
      Stream #0:0: Video: h264 (High), yuv420p, 864x480, 24 fps
      Stream #0:1: Audio: aac (LC), 32000 Hz, stereo
    `);
    assert.equal(result.format.duration, '15.29');
    assert.deepEqual(result.streams, [
      { codec_type: 'video', codec_name: 'h264', width: 864, height: 480, r_frame_rate: '24/1' },
      { codec_type: 'audio', codec_name: 'aac' },
    ]);
  });

  it('deletes a prompt from the ComfyUI queue and interrupts active execution', async () => {
    const client = createComfyUIClient({ baseUrl });
    const result = await client.cancel('prompt-to-cancel');
    assert.deepEqual(result, { promptId: 'prompt-to-cancel', cancelled: true });
    const queueRequest = requests.findLast((request) => request.url === '/queue');
    const interruptRequest = requests.findLast((request) => request.url === '/interrupt');
    assert.deepEqual(JSON.parse(queueRequest.body), { delete: ['prompt-to-cancel'] });
    assert.deepEqual(JSON.parse(interruptRequest.body), { prompt_id: 'prompt-to-cancel' });
  });

  it('provides non-inference diagnostics and one-shot prompt status reads', async () => {
    const client = createComfyUIClient({ baseUrl });
    const promptRequestsBefore = requests.filter((request) => request.url === '/prompt').length;

    assert.equal((await client.getSystemStats()).devices[0].name, 'test-gpu');
    assert.equal((await client.getQueue()).queue_running[0][1], 'prompt-running');
    assert.ok((await client.getObjectInfo()).MiniMaxH3Director);
    assert.deepEqual(await client.getModels(['diffusion_models']), {
      diffusion_models: ['minimax-h3.safetensors'],
    });
    assert.deepEqual(await client.getPromptStatus('prompt-running'), {
      status: 'running', progress: 0, history: null,
    });
    assert.equal(requests.filter((request) => request.url === '/prompt').length, promptRequestsBefore);
  });

  it('recognizes a realistic ComfyUI execution_interrupted history as interrupted', async () => {
    const client = createComfyUIClient({ baseUrl });

    const result = await client.getPromptStatus('prompt-interrupted');

    assert.equal(result.status, 'interrupted');
    assert.equal(result.progress, 100);
    assert.equal(result.history.status.status_str, 'error');
    assert.equal(result.history.status.messages[1][0], 'execution_interrupted');
  });

  it('extracts execution timing and the node error from ComfyUI history messages', async () => {
    const timedBaseUrl = 'http://timed-comfy.test';
    const client = createComfyUIClient({
      baseUrl: timedBaseUrl,
      fetchImpl: async () => new Response(JSON.stringify({
        'prompt-timed-failure': {
          status: {
            status_str: 'error',
            completed: false,
            messages: [
              ['execution_start', { prompt_id: 'prompt-timed-failure', timestamp: 1788495534244 }],
              ['execution_error', {
                prompt_id: 'prompt-timed-failure',
                timestamp: 1788495540244,
                exception_message: 'Fault failed: 2',
                node_type: 'RTXVideoSuperResolution',
              }],
            ],
          },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    });

    const result = await client.getPromptStatus('prompt-timed-failure');

    assert.equal(result.status, 'failed');
    assert.equal(result.error.code, 'COMFYUI_WORKFLOW_FAILED');
    assert.equal(result.error.message, 'Fault failed: 2');
    assert.deepEqual(result.executionTiming, {
      startedAt: '2026-09-04T04:18:54.244Z',
      completedAt: '2026-09-04T04:19:00.244Z',
    });
  });
});
