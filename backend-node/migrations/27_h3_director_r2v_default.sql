-- V1 H3 Director default: preserve user-selected non-ComfyUI configurations.
UPDATE ai_service_configs
SET model = CASE
      WHEN model IS NULL OR TRIM(model) = '' THEN '["minimax_h3_director_r2v"]'
      WHEN instr(model, 'minimax_h3_director_r2v') > 0 THEN model
      WHEN substr(TRIM(model), 1, 1) = '[' THEN replace(model, 'h3-continuity-v1', 'minimax_h3_director_r2v')
      ELSE 'minimax_h3_director_r2v'
    END,
    default_model = 'minimax_h3_director_r2v',
    updated_at = datetime('now')
WHERE service_type = 'video'
  AND LOWER(provider) = 'comfyui'
  AND deleted_at IS NULL
  AND is_default = 1
  AND (default_model = 'h3-continuity-v1' OR default_model IS NULL OR default_model = '');
