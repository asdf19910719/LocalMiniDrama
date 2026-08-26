ALTER TABLE video_generations ADD COLUMN source_prompt TEXT;
ALTER TABLE video_generations ADD COLUMN compiled_prompt TEXT;
ALTER TABLE video_generations ADD COLUMN prompt_format TEXT;
ALTER TABLE video_generations ADD COLUMN prompt_compiler_version TEXT;
ALTER TABLE video_generations ADD COLUMN prompt_compile_status TEXT;
ALTER TABLE video_generations ADD COLUMN prompt_compile_error TEXT;
