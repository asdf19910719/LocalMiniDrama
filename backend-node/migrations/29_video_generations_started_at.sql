-- Record the local execution start boundary for accurate candidate timing.
ALTER TABLE video_generations ADD COLUMN started_at TEXT;
