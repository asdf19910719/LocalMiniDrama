'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const { ensureV21Domain } = require('../src/v21/db.js');
const { createProjectService } = require('../src/v21/projects/projectService.js');

const log = { info() {}, warn() {}, error() {} };

function setup() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');
  runMigrationsAndEnsure(db);
  ensureV21Domain(db);
  const now = '2026-09-12T08:00:00Z';
  db.prepare(`INSERT INTO dramas (id, title, status, created_at, updated_at) VALUES (1, '风格版本项目', 'draft', ?, ?)`).run(now, now);
  return { db, projects: createProjectService(db, { log }) };
}

test('listStyleVersions：applyStyle 每次应用留痕，倒序返回可回看的版本记录', () => {
  const { projects } = setup();
  projects.applyStyle(1, { styleId: 'rh-101-cinematic' });
  projects.applyStyle(1, { styleId: 'rh-102-bw-film' });
  const { items } = projects.listStyleVersions(1);
  assert.equal(items.length, 2);
  assert.equal(items[0].styleId, 'rh-102-bw-film', '最近应用在前');
  assert.equal(items[0].eventType, 'style-applied');
  assert.ok(items[0].createdAt, '带应用时间');
});

test('listStyleVersions：无更换记录时返回空列表（前端据实显示「还没有更换记录」）', () => {
  const { projects } = setup();
  assert.deepEqual(projects.listStyleVersions(1).items, []);
});
