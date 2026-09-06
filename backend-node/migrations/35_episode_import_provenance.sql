ALTER TABLE scenes ADD COLUMN description TEXT;
ALTER TABLE episode_imports ADD COLUMN import_report TEXT;
CREATE INDEX IF NOT EXISTS idx_episode_imports_episode_time
  ON episode_imports(episode_id, imported_at DESC, id DESC);
