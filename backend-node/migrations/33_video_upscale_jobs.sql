CREATE TABLE IF NOT EXISTS video_upscale_jobs (
  id TEXT PRIMARY KEY,
  episode_id INTEGER,
  video_merge_id INTEGER,
  async_task_id TEXT,
  provider TEXT NOT NULL DEFAULT 'zealman',
  method TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  config_snapshot_json TEXT,
  source_path TEXT NOT NULL,
  source_fingerprint TEXT,
  source_width INTEGER,
  source_height INTEGER,
  source_fps_num INTEGER,
  source_fps_den INTEGER,
  source_frame_count INTEGER,
  source_has_audio INTEGER DEFAULT 0,
  target_width INTEGER,
  target_height INTEGER,
  output_path TEXT,
  remote_input_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  progress INTEGER NOT NULL DEFAULT 0,
  current_stage TEXT,
  error_code TEXT,
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT,
  waiting_since TEXT,
  cancel_requested_at TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_video_upscale_jobs_due
  ON video_upscale_jobs(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_video_upscale_jobs_merge
  ON video_upscale_jobs(video_merge_id, created_at DESC);
CREATE TABLE IF NOT EXISTS video_upscale_segments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  segment_index INTEGER NOT NULL,
  start_frame INTEGER NOT NULL,
  requested_frame_count INTEGER NOT NULL,
  overlap_frames INTEGER NOT NULL DEFAULT 0,
  remote_input_name TEXT,
  client_id TEXT,
  prompt_id TEXT,
  filename_prefix TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  progress INTEGER NOT NULL DEFAULT 0,
  remote_result_json TEXT,
  local_output_path TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  submitted_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(job_id, segment_index),
  FOREIGN KEY(job_id) REFERENCES video_upscale_jobs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_video_upscale_segments_prompt
  ON video_upscale_segments(prompt_id);
CREATE INDEX IF NOT EXISTS idx_video_upscale_segments_status
  ON video_upscale_segments(job_id, status, segment_index);
