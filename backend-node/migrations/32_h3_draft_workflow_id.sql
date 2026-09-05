-- 32_h3_draft_workflow_id.sql
ALTER TABLE storyboard_h3_prompt_drafts ADD COLUMN workflow_id TEXT;
CREATE INDEX IF NOT EXISTS idx_h3_draft_workflow_lookup
  ON storyboard_h3_prompt_drafts(storyboard_id, video_config_id, workflow_id, updated_at DESC);
