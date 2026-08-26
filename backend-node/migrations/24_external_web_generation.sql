-- External web generation jobs, browser sessions, attempts, and result provenance.
-- IDs are application-owned UUIDs so records remain unambiguous across providers.
CREATE TABLE IF NOT EXISTS external_generation_jobs (
  id                         TEXT PRIMARY KEY,
  drama_id                   INTEGER NOT NULL,
  storyboard_id              INTEGER,
  asset_type                 TEXT NOT NULL DEFAULT 'image',
  provider                   TEXT NOT NULL DEFAULT '',
  site                       TEXT NOT NULL,
  conversation_id            TEXT,
  prompt_snapshot            TEXT NOT NULL,
  prompt_hash                TEXT NOT NULL,
  reference_manifest_hash    TEXT,
  reference_manifest_json    TEXT,
  reference_package_path     TEXT,
  status                     TEXT NOT NULL DEFAULT 'pending',
  created_at                 TEXT NOT NULL,
  updated_at                 TEXT NOT NULL,
  completed_at               TEXT
);

CREATE INDEX IF NOT EXISTS idx_external_generation_jobs_drama
  ON external_generation_jobs (drama_id, created_at);

CREATE TABLE IF NOT EXISTS external_generation_sessions (
  id                  TEXT PRIMARY KEY,
  drama_id            INTEGER NOT NULL,
  site                TEXT NOT NULL,
  browser_profile_id  TEXT,
  tab_id              TEXT,
  conversation_id     TEXT,
  status              TEXT NOT NULL DEFAULT 'active',
  last_seen_at        TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  UNIQUE (drama_id, site)
);

CREATE TABLE IF NOT EXISTS external_generation_attempts (
  id                            TEXT PRIMARY KEY,
  job_id                        TEXT NOT NULL,
  conversation_id               TEXT,
  user_message_id               TEXT,
  assistant_message_id          TEXT,
  request_id                    TEXT,
  sent_prompt_hash              TEXT,
  sent_reference_manifest_hash  TEXT,
  status                        TEXT NOT NULL DEFAULT 'pending',
  sequence                      INTEGER NOT NULL,
  created_at                    TEXT NOT NULL,
  updated_at                    TEXT NOT NULL,
  completed_at                  TEXT,
  UNIQUE (job_id, sequence),
  FOREIGN KEY (job_id) REFERENCES external_generation_jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_external_generation_attempts_job
  ON external_generation_attempts (job_id, sequence);

CREATE TABLE IF NOT EXISTS external_generation_results (
  id                    TEXT PRIMARY KEY,
  attempt_id            TEXT NOT NULL,
  result_set_id         TEXT,
  provider_result_id    TEXT,
  result_index          INTEGER NOT NULL,
  node_fingerprint      TEXT,
  source_url            TEXT,
  source_mime           TEXT,
  source_width          INTEGER,
  source_height         INTEGER,
  download_hash         TEXT,
  image_generation_id   INTEGER,
  asset_id              INTEGER,
  status                TEXT NOT NULL DEFAULT 'pending',
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  UNIQUE (attempt_id, result_index),
  FOREIGN KEY (attempt_id) REFERENCES external_generation_attempts(id)
);

CREATE INDEX IF NOT EXISTS idx_external_generation_results_attempt
  ON external_generation_results (attempt_id, result_index);

CREATE TABLE IF NOT EXISTS external_generation_events (
  id                TEXT PRIMARY KEY,
  attempt_id        TEXT NOT NULL,
  idempotency_key   TEXT NOT NULL UNIQUE,
  sequence          INTEGER NOT NULL,
  event_type        TEXT NOT NULL,
  payload_json      TEXT NOT NULL DEFAULT '{}',
  created_at        TEXT NOT NULL,
  UNIQUE (attempt_id, sequence),
  FOREIGN KEY (attempt_id) REFERENCES external_generation_attempts(id)
);

CREATE INDEX IF NOT EXISTS idx_external_generation_events_attempt
  ON external_generation_events (attempt_id, sequence);
