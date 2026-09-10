-- V2.1 Production Studio 领域事实源（增量建表，均为 CREATE IF NOT EXISTS，可重复执行）

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- 阶段内容状态（三层状态机之一；blocked 属于 Gate 计算，不入库为状态）
CREATE TABLE IF NOT EXISTS production_stage_states (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drama_id INTEGER NOT NULL,
  episode_id INTEGER NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('script','assets','storyboard','cut')),
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','in_progress','ready_for_review','approved','stale')),
  content_revision INTEGER NOT NULL DEFAULT 0,
  source_fingerprint TEXT NOT NULL DEFAULT '',
  blocker_json TEXT,
  approved_revision INTEGER,
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_v21_stage_states_episode_stage ON production_stage_states(episode_id, stage);

-- 阶段历史事件（不可变审计）
CREATE TABLE IF NOT EXISTS production_stage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id INTEGER NOT NULL,
  stage TEXT NOT NULL,
  event_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  revision INTEGER,
  actor TEXT NOT NULL DEFAULT 'local-user',
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_v21_stage_events_episode ON production_stage_events(episode_id, stage);

-- 剧本版本（draft/approved/superseded；运行期唯一写入事实源）
CREATE TABLE IF NOT EXISTS episode_script_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready_for_review','approved','superseded')),
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  parent_revision_id INTEGER,
  scene_count INTEGER NOT NULL DEFAULT 0,
  word_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,
  approved_at TEXT,
  approved_by TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_v21_script_revisions_episode_rev ON episode_script_revisions(episode_id, revision);
CREATE INDEX IF NOT EXISTS idx_v21_script_revisions_episode_status ON episode_script_revisions(episode_id, status);

-- 剧本叙事场次（场次—分镜—时段：场次层）
CREATE TABLE IF NOT EXISTS story_scenes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id INTEGER NOT NULL,
  script_revision_id INTEGER,
  scene_key TEXT NOT NULL DEFAULT '',
  scene_number INTEGER NOT NULL DEFAULT 1,
  heading TEXT NOT NULL DEFAULT '',
  interior_exterior TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  time_of_day TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  characters_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_v21_story_scenes_episode_number ON story_scenes(episode_id, scene_number);

-- 分镜时段（时码/画面/对白/声音/资产生效范围；单时段合法）
CREATE TABLE IF NOT EXISTS storyboard_segments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  storyboard_id INTEGER NOT NULL,
  seq INTEGER NOT NULL DEFAULT 1,
  start_seconds REAL NOT NULL DEFAULT 0,
  end_seconds REAL NOT NULL DEFAULT 0,
  visual TEXT NOT NULL DEFAULT '',
  dialogue TEXT NOT NULL DEFAULT '',
  sound TEXT NOT NULL DEFAULT '',
  asset_refs_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_v21_storyboard_segments_board ON storyboard_segments(storyboard_id, seq);

-- 本集设定引用（assetId + stateId + mediaVersionId 引用指针，不复制资料）
CREATE TABLE IF NOT EXISTS episode_asset_selections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id INTEGER NOT NULL,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('character','scene','prop')),
  asset_id INTEGER NOT NULL,
  state_id TEXT NOT NULL DEFAULT '',
  media_version_id INTEGER,
  selected_at TEXT,
  updated_at TEXT,
  UNIQUE (episode_id, asset_type, asset_id)
);

-- 本集素材集合快照（进入分镜时事务写入的不可变快照）
CREATE TABLE IF NOT EXISTS episode_asset_set_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id INTEGER NOT NULL,
  script_revision_id INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','failed')),
  fingerprint TEXT NOT NULL DEFAULT '',
  items_json TEXT NOT NULL DEFAULT '[]',
  error_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_v21_asset_snapshots_episode ON episode_asset_set_snapshots(episode_id, status);

-- 成片版本（审片+合片：vN 历史，互不覆盖）
CREATE TABLE IF NOT EXISTS episode_cut_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id INTEGER NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'composing' CHECK (status IN ('composing','ready','failed','exported')),
  settings_json TEXT NOT NULL DEFAULT '{}',
  shots_json TEXT NOT NULL DEFAULT '[]',
  file_path TEXT,
  duration_seconds REAL NOT NULL DEFAULT 0,
  task_id TEXT,
  error_message TEXT,
  exported_at TEXT,
  export_path TEXT,
  export_sha256 TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_v21_cut_versions_episode_version ON episode_cut_versions(episode_id, version);

-- Gate 豁免（不可变决策记录；输入变化自动过期）
CREATE TABLE IF NOT EXISTS gate_waivers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gate TEXT NOT NULL,
  owner_type TEXT NOT NULL,
  owner_id INTEGER NOT NULL,
  owner_revision INTEGER,
  blocker_code TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'local-user',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_on_change INTEGER NOT NULL DEFAULT 1,
  input_fingerprint TEXT NOT NULL DEFAULT '',
  revoked_at TEXT
);

-- 项目画面风格版本事件（应用风格只影响之后的新生成的审计依据）
CREATE TABLE IF NOT EXISTS project_style_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drama_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  style_id TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
