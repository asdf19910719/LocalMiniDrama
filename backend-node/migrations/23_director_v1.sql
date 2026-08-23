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
