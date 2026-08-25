CREATE TABLE IF NOT EXISTS external_generation_idempotency (
  idempotency_key TEXT PRIMARY KEY,
  operation TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

ALTER TABLE external_generation_results ADD COLUMN candidate_index INTEGER;
ALTER TABLE external_generation_results ADD COLUMN selected INTEGER NOT NULL DEFAULT 0;

ALTER TABLE image_generations ADD COLUMN external_job_id TEXT;
ALTER TABLE image_generations ADD COLUMN external_attempt_id TEXT;
ALTER TABLE image_generations ADD COLUMN external_result_id TEXT;
ALTER TABLE image_generations ADD COLUMN source_hash TEXT;
ALTER TABLE image_generations ADD COLUMN source_url TEXT;

CREATE INDEX IF NOT EXISTS idx_external_generation_results_selected
  ON external_generation_results (attempt_id, selected, result_index);
