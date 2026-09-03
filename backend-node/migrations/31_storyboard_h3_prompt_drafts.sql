-- 31_storyboard_h3_prompt_drafts.sql
CREATE TABLE IF NOT EXISTS storyboard_h3_prompt_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  storyboard_id INTEGER NOT NULL,
  video_config_id TEXT,
  source_prompt TEXT,
  source_fingerprint TEXT,
  ai_compiled_prompt TEXT,
  final_compiled_prompt TEXT,
  compiled_prompt_hash TEXT,
  prompt_format TEXT,
  skill_version TEXT,
  skill_provenance TEXT,
  reference_snapshot TEXT,
  generation_params TEXT,
  manually_edited INTEGER DEFAULT 0,
  status TEXT DEFAULT 'valid',
  validation_errors TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_h3_draft_lookup ON storyboard_h3_prompt_drafts(storyboard_id, video_config_id, updated_at DESC);
