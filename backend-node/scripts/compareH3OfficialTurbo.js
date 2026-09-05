'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const { h3DirectorR2VAdapter } = require('../src/director/adapters/h3DirectorR2VAdapter');
const { parseFfmpegProbe } = require('../src/director/comfyuiClient');
const { enforceCrispMotionPrompt } = require('./h3TestPromptPolicy');

const APP_URL = 'http://127.0.0.1:5679/api/v1';
const COMFY_URL = 'http://127.0.0.1:8188';
const COMFY_ROOT = 'E:/AI/ComfyUI_windows_portable/ComfyUI';
const OUTPUT_ROOT = path.resolve(__dirname, '../../docs/research/_artifacts/h3-official-turbo-ab-2026-09-04');
const OFFICIAL_TEMPLATE = path.resolve(__dirname, '../configs/workflows/minimax_h3_director_r2v.json');
const TURBO_TEMPLATE = 'E:/AI/h3_director_test/api_09_zealman_u06_h3_rtx2x_wuxia_10s.json';
const FFMPEG_PATH = 'E:/AI/ComfyUI_windows_portable/python_embeded/Lib/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe';
const WIDTH = 1280;
const HEIGHT = 704;
const FPS = 24;
const SEED = 42;
const KNOWN_RUNS = {
  shot1_official_sage: { promptId: '8c0c1c31-a36d-4fbb-b0b7-937982390f5d', wallSeconds: 265 },
  shot2_official_sage: { promptId: '9b794a02-6c11-4bba-983a-f1985ff3a486', wallSeconds: 267.804 },
  shot1_turbo09: { promptId: 'bdfa71b5-2c32-410c-9aeb-f5a868c5a368', wallSeconds: 171.546 },
  shot2_turbo09: { promptId: '3bbbc398-11c9-4c6d-a8c6-d2790b4f86c4', wallSeconds: 225.98 },
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!response.ok) throw new Error(`${response.status} ${url}: ${text.slice(0, 1000)}`);
  return body;
}

function validTurboFrames(durationSeconds) {
  const base = Math.max(5, Math.round(durationSeconds * FPS));
  return base + ((5 - (base % 17)) + 17) % 17;
}

async function uploadReference(filePath, name) {
  const bytes = fs.readFileSync(filePath);
  const form = new FormData();
  form.append('image', new Blob([bytes]), name);
  form.append('overwrite', 'true');
  const uploaded = await jsonRequest(`${COMFY_URL}/upload/image`, { method: 'POST', body: form });
  return uploaded.name || name;
}

function addOfficialRawOutput(prompt, prefix) {
  prompt['10'] = {
    class_type: 'CreateVideo',
    inputs: { images: ['5', 0], fps: ['5', 2], audio: ['5', 1], bit_depth: 8 },
  };
  prompt['11'] = {
    class_type: 'SaveVideo',
    inputs: { video: ['10', 0], filename_prefix: `${prefix}_raw`, format: 'auto', codec: 'auto' },
  };
  prompt['7'].inputs.filename_prefix = `${prefix}_rtx2x`;
}

function forceOfficialFrameCount(prompt, frames, durationSeconds) {
  const director = prompt['5'];
  director.inputs.total_frames = frames;
  const timeline = JSON.parse(director.inputs.timeline_data);
  timeline.totalFrames = frames;
  timeline.gen = { ...(timeline.gen || {}), defaultFrameCount: frames };
  timeline.segments = (timeline.segments || []).map((segment) => ({
    ...segment,
    start: 0,
    length: frames,
    frameCount: frames,
    durationSec: durationSeconds,
  }));
  director.inputs.timeline_data = JSON.stringify(timeline);
}

function buildOfficial(shot, uploadedNames, { sage = true } = {}) {
  const template = JSON.parse(fs.readFileSync(OFFICIAL_TEMPLATE, 'utf8'));
  const prompt = h3DirectorR2VAdapter.buildPrompt(template, {
    prompt: shot.prompt,
    durationSeconds: shot.duration,
    frameRate: FPS,
    width: WIDTH,
    height: HEIGHT,
    seed: SEED,
    continuityMode: 'none',
  }, uploadedNames.map((comfyFilename, index) => ({
    comfyFilename,
    role: index === 0 ? 'environment' : 'subject',
  })));
  const frames = validTurboFrames(shot.duration);
  forceOfficialFrameCount(prompt, frames, shot.duration);
  const variant = sage ? 'official_sage' : 'official_nosage';
  if (!sage) {
    prompt['5'].inputs.model = ['1', 0];
    delete prompt['8'];
  }
  addOfficialRawOutput(prompt, `ab_20260904/shot${shot.number}_${variant}`);
  return { prompt, frames };
}

function addTurboRawOutput(prompt, prefix) {
  prompt['733'] = clone(prompt['732']);
  prompt['733'].inputs.images = ['1307', 0];
  prompt['733'].inputs.filename_prefix = `${prefix}_raw`;
  prompt['732'].inputs.filename_prefix = `${prefix}_rtx2x`;
}

function buildTurbo(shot, uploadedNames) {
  const prompt = JSON.parse(fs.readFileSync(TURBO_TEMPLATE, 'utf8'));
  prompt['136'].inputs.prompt = shot.prompt;
  prompt['136'].inputs.width = WIDTH;
  prompt['136'].inputs.height = HEIGHT;
  prompt['132'].inputs.value = shot.duration;
  prompt['727'].inputs.noise_seed = SEED;
  const referenceInputs = ['ref_images.ref_image_0', 'ref_images.ref_image_1', 'ref_images.ref_image_2'];
  const loadNodeIds = ['137', '139', '144'];
  for (let index = 0; index < referenceInputs.length; index += 1) {
    if (uploadedNames[index]) {
      prompt[loadNodeIds[index]].inputs.image = uploadedNames[index];
      prompt['136'].inputs[referenceInputs[index]] = [loadNodeIds[index], 0];
    } else {
      delete prompt['136'].inputs[referenceInputs[index]];
      delete prompt[loadNodeIds[index]];
    }
  }
  addTurboRawOutput(prompt, `ab_20260904/shot${shot.number}_turbo09`);
  return { prompt, frames: validTurboFrames(shot.duration) };
}

function executionError(history) {
  const messages = history?.status?.messages || [];
  const item = [...messages].reverse().find((entry) => entry?.[0] === 'execution_error')?.[1];
  return item ? `${item.exception_type || 'Error'}: ${item.exception_message || 'unknown'}` : 'unknown ComfyUI error';
}

async function runPrompt(label, prompt) {
  const submittedAt = Date.now();
  const submit = await jsonRequest(`${COMFY_URL}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, client_id: `ab-${crypto.randomUUID()}` }),
  });
  if (!submit.prompt_id) throw new Error(`${label}: ComfyUI did not return prompt_id`);
  process.stdout.write(`${label}: submitted ${submit.prompt_id}\n`);
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const body = await jsonRequest(`${COMFY_URL}/history/${encodeURIComponent(submit.prompt_id)}`);
    const history = body[submit.prompt_id];
    if (!history) {
      const elapsed = Math.round((Date.now() - submittedAt) / 1000);
      if (elapsed % 30 < 3) process.stdout.write(`${label}: running ${elapsed}s\n`);
      continue;
    }
    if (history.status?.status_str === 'error') throw new Error(`${label}: ${executionError(history)}`);
    if (history.status?.completed === true || history.status?.status_str === 'success') {
      process.stdout.write(`${label}: completed in ${Math.round((Date.now() - submittedAt) / 1000)}s\n`);
      return { promptId: submit.prompt_id, history, wallSeconds: (Date.now() - submittedAt) / 1000 };
    }
  }
}

async function freeComfyMemory() {
  await jsonRequest(`${COMFY_URL}/free`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ unload_models: true, free_memory: true }),
  });
  await new Promise((resolve) => setTimeout(resolve, 3000));
}

function flattenOutputs(history) {
  const files = [];
  for (const [nodeId, output] of Object.entries(history.outputs || {})) {
    for (const value of Object.values(output || {})) {
      if (!Array.isArray(value)) continue;
      for (const item of value) {
        if (item?.filename) files.push({ nodeId, ...item });
      }
    }
  }
  return files;
}

function probe(filePath) {
  const result = spawnSync(FFMPEG_PATH, ['-hide_banner', '-i', filePath], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  const parsed = parseFfmpegProbe(`${result.stderr || ''}\n${result.stdout || ''}`);
  if (!parsed.streams.length) throw new Error(`Unable to probe ${filePath}`);
  return parsed;
}

function copyOutputs(label, run) {
  const copied = [];
  for (const output of flattenOutputs(run.history)) {
    if (!/\.mp4$/i.test(output.filename)) continue;
    const sourcePath = path.join(COMFY_ROOT, output.type || 'output', output.subfolder || '', output.filename);
    if (!fs.existsSync(sourcePath)) continue;
    const tag = output.filename.includes('_raw') ? 'raw' : 'rtx2x';
    const destination = path.join(OUTPUT_ROOT, `${label}_${tag}.mp4`);
    fs.copyFileSync(sourcePath, destination);
    const metadata = probe(destination);
    copied.push({
      tag,
      path: destination,
      bytes: fs.statSync(destination).size,
      probe: metadata,
      source: output,
    });
  }
  return copied;
}

function copyExistingOutputs(label) {
  const outputDir = path.join(COMFY_ROOT, 'output', 'ab_20260904');
  if (!fs.existsSync(outputDir)) return [];
  const files = fs.readdirSync(outputDir)
    .filter((name) => name.startsWith(`${label}_`) && /\.mp4$/i.test(name))
    .map((name) => ({ name, filePath: path.join(outputDir, name), mtimeMs: fs.statSync(path.join(outputDir, name)).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  const copied = [];
  for (const tag of ['raw', 'rtx2x']) {
    const match = files.find((file) => file.name.includes(`_${tag}`));
    if (!match) continue;
    const destination = path.join(OUTPUT_ROOT, `${label}_${tag}.mp4`);
    fs.copyFileSync(match.filePath, destination);
    copied.push({
      tag,
      path: destination,
      bytes: fs.statSync(destination).size,
      probe: probe(destination),
      source: { filename: match.name, subfolder: 'ab_20260904', type: 'output' },
    });
  }
  return copied;
}

async function loadShot(storyboardId, number) {
  const [videos, refs] = await Promise.all([
    jsonRequest(`${APP_URL}/videos?storyboard_id=${storyboardId}&page=1&page_size=100`),
    jsonRequest(`${APP_URL}/storyboards/${storyboardId}/reference-slots`),
  ]);
  const items = videos?.data?.items || [];
  const selected = items.find((item) => item.status === 'selected' && item.prompt) || items.find((item) => item.prompt);
  if (!selected) throw new Error(`shot ${number}: no prompt-bearing video found`);
  const slots = refs?.data?.slots || [];
  if (!slots.length || slots.some((slot) => !slot.image_available)) throw new Error(`shot ${number}: reference slots unavailable`);
  return {
    number,
    storyboardId,
    duration: Number(selected.duration),
    prompt: enforceCrispMotionPrompt(selected.prompt),
    promptSourceVideoId: selected.id,
    references: slots.map((slot) => ({ type: slot.type, name: slot.name, filePath: slot.image_url })),
  };
}

async function main() {
  fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
  const queue = await jsonRequest(`${COMFY_URL}/queue`);
  if ((queue.queue_running || []).length || (queue.queue_pending || []).length) {
    throw new Error('ComfyUI queue is not empty; refusing to contaminate an active run');
  }
  const shots = [await loadShot(20, 1), await loadShot(21, 2)];
  for (const shot of shots) {
    shot.uploadedNames = [];
    for (let index = 0; index < shot.references.length; index += 1) {
      const ext = path.extname(shot.references[index].filePath) || '.png';
      shot.uploadedNames.push(await uploadReference(
        shot.references[index].filePath,
        `ab_20260904_shot${shot.number}_ref${index + 1}${ext}`,
      ));
    }
  }

  const plan = [];
  for (const shot of shots) {
    plan.push({ label: `shot${shot.number}_official_sage`, shot, workflow: 'official_sage', ...buildOfficial(shot, shot.uploadedNames) });
  }
  for (const shot of shots) {
    plan.push({ label: `shot${shot.number}_official_nosage`, shot, workflow: 'official_nosage', ...buildOfficial(shot, shot.uploadedNames, { sage: false }) });
  }
  for (const shot of shots) {
    plan.push({ label: `shot${shot.number}_turbo09`, shot, workflow: 'turbo09', ...buildTurbo(shot, shot.uploadedNames) });
  }

  const results = [];
  for (const item of plan) {
    fs.writeFileSync(path.join(OUTPUT_ROOT, `${item.label}_api.json`), JSON.stringify(item.prompt, null, 2));
    let run;
    let outputs = copyExistingOutputs(item.label);
    if (outputs.length >= 2) {
      run = KNOWN_RUNS[item.label] || { promptId: null, wallSeconds: null };
      process.stdout.write(`${item.label}: reused existing raw + rtx2x outputs\n`);
    } else {
      await freeComfyMemory();
      run = await runPrompt(item.label, item.prompt);
      outputs = copyOutputs(item.label, run);
    }
    if (!outputs.some((output) => output.tag === 'raw') || !outputs.some((output) => output.tag === 'rtx2x')) {
      throw new Error(`${item.label}: expected both raw and rtx2x outputs, got ${outputs.map((x) => x.tag).join(', ')}`);
    }
    results.push({
      label: item.label,
      workflow: item.workflow,
      shot: item.shot.number,
      storyboardId: item.shot.storyboardId,
      promptSourceVideoId: item.shot.promptSourceVideoId,
      durationRequested: item.shot.duration,
      frames: item.frames,
      width: WIDTH,
      height: HEIGHT,
      seed: SEED,
      references: item.shot.references,
      promptId: run.promptId,
      wallSeconds: run.wallSeconds,
      outputs: outputs.map((output) => ({
        tag: output.tag,
        path: output.path,
        bytes: output.bytes,
        format: output.probe.format,
        streams: output.probe.streams,
      })),
    });
  }
  const reportPath = path.join(OUTPUT_ROOT, 'run-report.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    controls: { width: WIDTH, height: HEIGHT, fps: FPS, seed: SEED, samePromptAndReferences: true },
    results,
  }, null, 2));
  process.stdout.write(`REPORT ${reportPath}\n`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
