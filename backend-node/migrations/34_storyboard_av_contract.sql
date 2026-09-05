-- Canonical episode/storyboard audiovisual contract.
-- Every statement is additive so the migration runner can safely skip existing columns.
ALTER TABLE episodes ADD COLUMN audio_plan TEXT;
ALTER TABLE episodes ADD COLUMN production_profile TEXT;
ALTER TABLE storyboards ADD COLUMN is_primary INTEGER DEFAULT 0;
ALTER TABLE storyboards ADD COLUMN production_metadata TEXT;
ALTER TABLE scenes ADD COLUMN atmosphere TEXT;
ALTER TABLE storyboard_h3_prompt_drafts ADD COLUMN coverage_manifest TEXT;
ALTER TABLE storyboard_h3_prompt_drafts ADD COLUMN semantic_review_status TEXT;
ALTER TABLE storyboard_h3_prompt_drafts ADD COLUMN semantic_review_confirmed INTEGER DEFAULT 0;
