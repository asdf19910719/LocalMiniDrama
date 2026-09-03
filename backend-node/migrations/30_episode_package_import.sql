-- 30_episode_package_import.sql
CREATE TABLE IF NOT EXISTS character_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL,
  source_key TEXT,
  name TEXT NOT NULL,
  description TEXT,
  appearance TEXT,
  image_prompt TEXT,
  negative_prompt TEXT,
  image_url TEXT,
  local_path TEXT,
  extra_images TEXT,
  is_default INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT,
  deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_character_variants_key ON character_variants(character_id, source_key);
CREATE TABLE IF NOT EXISTS storyboard_character_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  storyboard_id INTEGER NOT NULL,
  character_id INTEGER NOT NULL,
  variant_id INTEGER NOT NULL,
  reference_role TEXT,
  sort_order INTEGER,
  framing_note TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sbv_variant ON storyboard_character_variants(storyboard_id, variant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sbv_sort ON storyboard_character_variants(storyboard_id, sort_order) WHERE sort_order IS NOT NULL;
CREATE TABLE IF NOT EXISTS episode_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id INTEGER NOT NULL,
  schema_name TEXT,
  schema_version TEXT,
  source_filename TEXT,
  source_sha256 TEXT,
  raw_json TEXT,
  normalized_json TEXT,
  match_decisions TEXT,
  generator_metadata TEXT,
  imported_at TEXT
);
ALTER TABLE characters ADD COLUMN source_key TEXT;
ALTER TABLE scenes ADD COLUMN source_key TEXT;
ALTER TABLE scenes ADD COLUMN state TEXT;
ALTER TABLE props ADD COLUMN source_key TEXT;
ALTER TABLE storyboards ADD COLUMN source_key TEXT;
ALTER TABLE storyboards ADD COLUMN audio_description TEXT;
ALTER TABLE storyboards ADD COLUMN transition TEXT;
