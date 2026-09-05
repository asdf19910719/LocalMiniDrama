#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { randomUUID } = require('node:crypto');
const { getWorkflowAdapter } = require('../src/director/workflowRegistry');

const execFileAsync = promisify(execFile);
const SECRET_KEY = /(api[-_]?key|token|secret|password|authorization|cookie)/i;
const CONTROLLED_DIRECTOR_FIELDS = [
  'global_prompt', 'seed', 'width', 'height', 'frame_rate', 'total_frames',
  'steps', 'sampler', 'scheduler', 'shift_video', 'shift_audio', 'timeline_data',
];

function nodeOf(prompt, type) {
  const nodes = Object.values(prompt || {}).filter((node) => node?.class_type === type);
  if (nodes.length !== 1) throw new Error(`Expected exactly one ${type}, found ${nodes.length}`);
  return nodes[0];
}

function controlledFields(prompt) {
  const director = nodeOf(prompt, 'MiniMaxH3Director').inputs || {};
  const sage = nodeOf(prompt, 'PathchSageAttentionKJ').inputs || {};
  const createVideo = nodeOf(prompt, 'CreateVideo').inputs || {};
  const saveVideo = nodeOf(prompt, 'SaveVideo').inputs || {};
  return {
    director: Object.fromEntries(CONTROLLED_DIRECTOR_FIELDS.map((key) => [key, director[key]])),
    sage: { sage_attention: sage.sage_attention, allow_compile: sage.allow_compile },
    encoding: { bit_depth: createVideo.bit_depth, format: saveVideo.format, codec: saveVideo.codec },
  };
}

function firstDifference(left, right, prefix = '') {
  if (Object.is(left, right)) return null;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return prefix || 'value';
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    const found = firstDifference(left[key], right[key], prefix ? `${prefix}.${key}` : key);
    if (found) return found;
  }
  return null;
}

function assertControlledPair(officialPrompt, tePrompt) {
  const difference = firstDifference(controlledFields(officialPrompt), controlledFields(tePrompt));
  if (difference) throw new Error(`Controlled A/B field differs: ${difference}`);
  return true;
}

function fraction(value) {
  const [numerator, denominator = 1] = String(value || '0').split('/').map(Number);
  return denominator ? numerator / denominator : 0;
}

function normalizeFfprobe(probe = {}) {
  const video = (probe.streams || []).find((stream) => stream.codec_type === 'video');
  const audio = (probe.streams || []).find((stream) => stream.codec_type === 'audio');
  return {
    durationSeconds: Number(probe.format?.duration || 0),
    formatName: probe.format?.format_name || null,
    video: video ? {
      codec: video.codec_name || null,
      width: Number(video.width || 0),
      height: Number(video.height || 0),
      frameRate: fraction(video.avg_frame_rate || video.r_frame_rate),
      frames: Number(video.nb_frames || 0),
    } : null,
    audio: audio ? {
      codec: audio.codec_name || null,
      sampleRate: Number(audio.sample_rate || 0),
      channels: Number(audio.channels || 0),
    } : null,
  };
}

function timingReductionPercent(officialSeconds, teSeconds) {
  const baseline = Number(officialSeconds);
  const accelerated = Number(teSeconds);
  if (!(baseline > 0) || !(accelerated >= 0)) return null;
  return Number((((baseline - accelerated) / baseline) * 100).toFixed(2));
}

function evaluateStability(runs, requiredRuns = 5) {
  const selected = Array.isArray(runs) ? runs.slice(0, requiredRuns) : [];
  const completedRuns = selected.filter((run) => run?.status === 'completed').length;
  return {
    passed: selected.length >= requiredRuns && completedRuns === requiredRuns,
    requiredRuns,
    completedRuns,
    failedRuns: selected.length - completedRuns,
  };
}

function sanitizeUrl(value) {
  try {
    const url = new URL(String(value));
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch (_) {
    return value;
  }
}

function sanitizeReport(value, key = '') {
  if (SECRET_KEY.test(key)) return undefined;
  if (Array.isArray(value)) return value.map((item) => sanitizeReport(item)).filter((item) => item !== undefined);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .map(([childKey, childValue]) => [childKey, sanitizeReport(childValue, childKey)])
      .filter(([, childValue]) => childValue !== undefined));
  }
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) return sanitizeUrl(value);
  return value;
}

function parseNvidiaCsv(stdout) {
  const fields = String(stdout).trim().split(',').map((field) => Number(field.trim().replace(/[^0-9.\-]/g, '')));
  if (fields.length < 5 || fields.some((field) => !Number.isFinite(field))) return null;
  return {
    capturedAt: new Date().toISOString(),
    temperatureC: fields[0], powerW: fields[1], memoryUsedMiB: fields[2],
    memoryTotalMiB: fields[3], utilizationPercent: fields[4],
  };
}

function startGpuTelemetry(intervalMs = 2000) {
  const samples = [];
  let stopped = false;
  let active = false;
  const sample = async () => {
    if (stopped || active) return;
    active = true;
    try {
      const { stdout } = await execFileAsync('nvidia-smi', [
        '--query-gpu=temperature.gpu,power.draw,memory.used,memory.total,utilization.gpu',
        '--format=csv,noheader,nounits',
      ]);
      const parsed = parseNvidiaCsv(stdout);
      if (parsed) samples.push(parsed);
    } catch (_) {
      // Telemetry is evidence, not a reason to terminate an otherwise valid inference.
    } finally {
      active = false;
    }
  };
  sample();
  const timer = setInterval(sample, intervalMs);
  return async () => {
    stopped = true;
    clearInterval(timer);
    while (active) await new Promise((resolve) => setTimeout(resolve, 25));
    return samples;
  };
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch (_) { body = { text }; }
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${JSON.stringify(body)}`);
  return body;
}

function historyStatus(history, promptId) {
  const entry = history?.[promptId];
  if (!entry) return { status: 'running', entry: null };
  const status = String(entry.status?.status_str || '').toLowerCase();
  if (status === 'error') return { status: 'failed', entry };
  if (status === 'success' || entry.outputs) return { status: 'completed', entry };
  return { status: 'running', entry };
}

function outputDescriptor(entry) {
  for (const output of Object.values(entry?.outputs || {})) {
    for (const key of ['videos', 'gifs', 'images', 'audio']) {
      const item = output?.[key]?.[0];
      if (item?.filename && /\.(mp4|mov|mkv|webm)$/i.test(item.filename)) return item;
    }
  }
  return null;
}

async function ffprobe(filePath) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error', '-show_streams', '-show_format', '-of', 'json', filePath,
  ], { maxBuffer: 8 * 1024 * 1024 });
  return normalizeFfprobe(JSON.parse(stdout));
}

async function runPrompt({ baseUrl, prompt, outputRoot, label, pollIntervalMs = 2000 }) {
  const stopTelemetry = startGpuTelemetry();
  const startedAt = new Date();
  let promptId = null;
  try {
    const submitted = await requestJson(`${baseUrl.replace(/\/$/, '')}/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, client_id: `h3-te-compare-${randomUUID()}` }),
    });
    promptId = submitted.prompt_id;
    if (!promptId) throw new Error(`ComfyUI did not return prompt_id: ${JSON.stringify(submitted)}`);
    while (true) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      const state = historyStatus(await requestJson(`${baseUrl.replace(/\/$/, '')}/history/${promptId}`), promptId);
      if (state.status === 'running') continue;
      if (state.status === 'failed') throw new Error(`ComfyUI prompt failed: ${JSON.stringify(state.entry?.status)}`);
      const descriptor = outputDescriptor(state.entry);
      if (!descriptor) throw new Error('Completed ComfyUI prompt has no video output');
      const outputPath = path.resolve(outputRoot, descriptor.subfolder || '', descriptor.filename);
      return {
        label, promptId, status: 'completed', startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(), elapsedSeconds: (Date.now() - startedAt.getTime()) / 1000,
        outputPath, media: await ffprobe(outputPath), telemetry: await stopTelemetry(),
      };
    }
  } catch (error) {
    return {
      label, promptId, status: 'failed', startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(), elapsedSeconds: (Date.now() - startedAt.getTime()) / 1000,
      error: error.message, telemetry: await stopTelemetry(),
    };
  }
}

function loadPrompt(workflowPath, input, filenamePrefix) {
  const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
  const adapter = getWorkflowAdapter({ adapter: 'h3_director_r2v' });
  const referenceImages = input.referenceImages || [input.referenceImage];
  const prompt = adapter.buildPrompt(workflow, input, referenceImages.map((comfyFilename, index) => ({
    comfyFilename,
    role: index === 0 ? 'subject' : 'environment',
  })));
  nodeOf(prompt, 'SaveVideo').inputs.filename_prefix = filenamePrefix;
  return prompt;
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    result[argv[index].slice(2)] = argv[index + 1];
    index += 1;
  }
  return result;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  for (const required of ['official', 'te', 'output-root', 'report']) {
    if (!args[required]) throw new Error(`Missing --${required}`);
  }
  const input = {
    prompt: args.prompt || 'A cinematic portrait. The subject slowly turns toward the camera. Natural motion, stable identity, no music.',
    referenceImage: args.reference || 'h3_te_speed_reference.png',
    referenceImages: (args.references || args.reference || 'h3_te_speed_reference.png')
      .split(',').map((value) => value.trim()).filter(Boolean),
    width: Number(args.width || 864), height: Number(args.height || 480),
    durationSeconds: Number(args.duration || 3), frameRate: Number(args.fps || 24),
    seed: Number(args.seed || 20260905), continuityMode: 'none',
  };
  const prefix = `video/h3_te_speed_ab/${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const officialPrompt = loadPrompt(path.resolve(args.official), input, `${prefix}_official`);
  const tePrompt = loadPrompt(path.resolve(args.te), input, `${prefix}_te`);
  assertControlledPair(officialPrompt, tePrompt);
  const baseUrl = args['base-url'] || 'http://127.0.0.1:8191';
  if (String(args['te-only'] || '').toLowerCase() === 'true') {
    const repeat = Math.max(1, Number(args.repeat || 1));
    const runs = [];
    for (let index = 0; index < repeat; index += 1) {
      const runPromptValue = structuredClone(tePrompt);
      const director = nodeOf(runPromptValue, 'MiniMaxH3Director');
      director.inputs.seed = Number(director.inputs.seed) + index;
      nodeOf(runPromptValue, 'SaveVideo').inputs.filename_prefix = `${prefix}_te_${index + 1}`;
      runs.push(await runPrompt({
        baseUrl, prompt: runPromptValue, outputRoot: args['output-root'], label: `official_sage_te_speed_${index + 1}`,
      }));
      runs.at(-1).seed = director.inputs.seed;
      if (runs.at(-1).status !== 'completed') break;
    }
    const report = sanitizeReport({
      schemaVersion: 1, capturedAt: new Date().toISOString(), baseUrl,
      mode: 'te_only_stability', controlled: controlledFields(tePrompt), runs,
      stability: evaluateStability(runs, repeat),
    });
    fs.mkdirSync(path.dirname(path.resolve(args.report)), { recursive: true });
    fs.writeFileSync(path.resolve(args.report), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(report, null, 2));
    if (!report.stability.passed) process.exitCode = 1;
    return report;
  }
  const official = await runPrompt({ baseUrl, prompt: officialPrompt, outputRoot: args['output-root'], label: 'official_sage' });
  const te = official.status === 'completed'
    ? await runPrompt({ baseUrl, prompt: tePrompt, outputRoot: args['output-root'], label: 'official_sage_te_speed' })
    : { label: 'official_sage_te_speed', status: 'skipped', error: 'Official baseline failed' };
  const report = sanitizeReport({
    schemaVersion: 1, capturedAt: new Date().toISOString(), baseUrl, controlled: controlledFields(officialPrompt),
    runs: { official, te },
    timingReductionPercent: official.status === 'completed' && te.status === 'completed'
      ? timingReductionPercent(official.elapsedSeconds, te.elapsedSeconds) : null,
  });
  fs.mkdirSync(path.dirname(path.resolve(args.report)), { recursive: true });
  fs.writeFileSync(path.resolve(args.report), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));
  if (official.status !== 'completed' || te.status !== 'completed') process.exitCode = 1;
  return report;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  assertControlledPair,
  controlledFields,
  normalizeFfprobe,
  timingReductionPercent,
  evaluateStability,
  sanitizeReport,
  parseNvidiaCsv,
  runPrompt,
  main,
};
