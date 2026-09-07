#!/usr/bin/env node

const projectDeletionService = require('../src/services/projectDeletionService');
const fs = require('node:fs');
const path = require('node:path');
const storageLayout = require('../src/services/storageLayout');

function isStorageSafe(storage, cfg = {}) {
  if (!storage?.directory || storage.cleanup_status === 'unsafe') return false;
  const storageRoot = path.resolve(cfg?.storage?.local_path || './data/storage');
  const projectsRoot = path.resolve(storageRoot, storageLayout.PROJECTS);
  const directory = path.resolve(storage.directory);
  const lexicalRelative = path.relative(projectsRoot, directory);
  if (!lexicalRelative || lexicalRelative.startsWith('..') || path.isAbsolute(lexicalRelative) || path.dirname(directory) !== projectsRoot) return false;
  if (!fs.existsSync(directory)) return true;
  try {
    const realRoot = fs.realpathSync(projectsRoot);
    const realDirectory = fs.realpathSync(directory);
    const realRelative = path.relative(realRoot, realDirectory);
    return Boolean(realRelative) && !realRelative.startsWith('..') && !path.isAbsolute(realRelative) && path.dirname(realDirectory) === realRoot;
  } catch (_) {
    return false;
  }
}

function parseArgs(argv = []) {
  let dramaId = null;
  let execute = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--execute') {
      execute = true;
      continue;
    }
    if (arg === '--drama-id') {
      if (dramaId !== null || argv[index + 1] == null) throw new Error('--drama-id is required and must have a value');
      dramaId = argv[++index];
      continue;
    }
    throw new Error(`unsupported argument: ${arg}`);
  }
  if (dramaId === null || !/^\d+$/.test(String(dramaId)) || !Number.isSafeInteger(Number(dramaId)) || Number(dramaId) <= 0) {
    throw new Error('--drama-id is required and must be a positive integer');
  }
  return { dramaId: Number(dramaId), execute };
}

function write(stream, value) {
  stream?.write?.(`${value}\n`);
}

async function run(argv = [], dependencies = {}) {
  const stdout = dependencies.stdout || process.stdout;
  const stderr = dependencies.stderr || process.stderr;
  try {
    const options = parseArgs(argv);
    const db = dependencies.db;
    if (!db) throw new Error('database dependency is required');
    const cfg = dependencies.cfg || {};
    const service = dependencies.service || projectDeletionService;
    const target = db.prepare('SELECT id, deleted_at FROM dramas WHERE id = ?').get(options.dramaId);
    if (!target) throw new Error(`project ${options.dramaId} was not found`);
    if (!target.deleted_at) {
      throw new Error(`project ${options.dramaId} is live; only soft-deleted projects may be cleaned`);
    }

    const includeDeleted = { includeDeleted: true };
    let result;
    if (options.execute) {
      const preview = service.previewProjectDeletion(db, cfg, options.dramaId, includeDeleted);
      if (!preview) throw new Error(`project ${options.dramaId} could not be previewed`);
      if (preview.storage?.cleanup_status === 'unsafe' || !isStorageSafe(preview.storage, cfg)) {
        throw new Error(`project ${options.dramaId} has unsafe storage; refusing permanent cleanup`);
      }
      const latestTarget = db.prepare('SELECT deleted_at FROM dramas WHERE id = ?').get(options.dramaId);
      if (!latestTarget?.deleted_at) {
        throw new Error(`project ${options.dramaId} is no longer soft-deleted; refusing permanent cleanup`);
      }
      result = service.deleteProjectPermanently(db, cfg, dependencies.log || console, options.dramaId, includeDeleted);
    } else {
      result = service.previewProjectDeletion(db, cfg, options.dramaId, includeDeleted);
    }
    if (!result) throw new Error(`project ${options.dramaId} could not be cleaned`);
    write(stdout, JSON.stringify({ mode: options.execute ? 'execute' : 'preview', drama_id: options.dramaId, result }));
    return 0;
  } catch (error) {
    write(stderr, `cleanup-deleted-project: ${error.message}`);
    return 1;
  }
}

if (require.main === module) {
  const { loadConfig } = require('../src/config');
  const { getDb } = require('../src/db');
  const cfg = loadConfig();
  run(process.argv.slice(2), { cfg, db: getDb(cfg.database) }).then((code) => {
    process.exitCode = code;
  });
}

module.exports = { isStorageSafe, parseArgs, run };
