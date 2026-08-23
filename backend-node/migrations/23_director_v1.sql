CREATE TABLE IF NOT EXISTS director_jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_number INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  lease_expires_at TEXT,
  error_code TEXT,
  error_message TEXT,
  input_json TEXT NOT NULL DEFAULT '{}',
  workflow_id TEXT,
  workflow_version TEXT,
  artifact_path TEXT,
  artifact_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_director_jobs_status_lease
  ON director_jobs(status, lease_expires_at);

CREATE TABLE IF NOT EXISTS director_artifacts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  artifact_path TEXT NOT NULL,
  parent_artifact_id TEXT,
  sha256 TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  ffprobe_json TEXT,
  manifest_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  ready_at TEXT,
  UNIQUE(job_id, version)
);

CREATE INDEX IF NOT EXISTS idx_director_artifacts_job
  ON director_artifacts(job_id, version);

CREATE TABLE IF NOT EXISTS director_candidate_groups (
  id TEXT PRIMARY KEY,
  shot_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  selected_candidate_id TEXT,
  selected_artifact_id TEXT,
  selected_by TEXT,
  selected_at TEXT,
  selection_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS director_candidates (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  job_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(group_id, artifact_id)
);

CREATE INDEX IF NOT EXISTS idx_director_candidates_group
  ON director_candidates(group_id, status);

CREATE TABLE IF NOT EXISTS director_anchors (
  id TEXT PRIMARY KEY,
  source_artifact_id TEXT NOT NULL,
  derived_artifact_id TEXT NOT NULL,
  frame_number INTEGER NOT NULL,
  reference_role TEXT NOT NULL,
  reference_use TEXT NOT NULL,
  prompt_label TEXT,
  source_sha256 TEXT NOT NULL,
  parameters_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_director_anchors_source
  ON director_anchors(source_artifact_id, frame_number);

CREATE TABLE IF NOT EXISTS director_timelines (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'validated',
  input_json TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  ffmpeg_command TEXT NOT NULL,
  output_path TEXT,
  output_sha256 TEXT,
  ffprobe_json TEXT,
  created_at TEXT NOT NULL
);
