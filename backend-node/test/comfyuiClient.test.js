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
      if (req.method === 'GET' && req.url.startsWith('/view?')) {
        res.setHeader('content-type', 'video/mp4');
        res.end(Buffer.from('fake-mp4'));
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
});
