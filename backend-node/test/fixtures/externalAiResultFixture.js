'use strict';

function validExternalAiResult() {
  return {
    schema: 'local-mini-drama.external-ai-result',
    version: '2',
    prompt_contract: 'base_prompt',
    package_id: 'extai_task-1',
    generator: { name: '外部 AI', model: 'demo', generated_at: '2026-09-07T10:00:00+08:00' },
    episode: {
      episode_number: 2,
      title: '账本缺页',
      summary: '林晚发现账本缺少关键一页。',
      script: '林晚翻开账本，发现最后一页被撕掉。',
      duration_target_seconds: 12,
    },
    new_assets: {
      characters: [],
      character_variants: [],
      scenes: [],
      props: [],
    },
    storyboards: [{
      local_ref: 'new_sb_01',
      storyboard_number: 1,
      title: '翻开账本',
      description: '林晚在便利店柜台后翻开账本。',
      duration_seconds: 6,
      scene_ref: 'scene_store',
      character_refs: [{
        character_ref: 'char_lin_wan',
        variant_ref: 'variant_lin_wan_default',
        reference_role: 'primary',
        sort_order: 1,
        framing_note: '林晚位于画面中心',
      }],
      prop_refs: ['prop_ledger'],
      shot_type: '近景',
      camera_angle: '平视',
      camera_movement: '缓推',
      composition: '账本在画面前景，林晚居中。',
      action: { start: '林晚拿起账本。', progression: '她逐页翻看。', end: '她停在缺页处。' },
      dialogue: [{ speaker: '林晚', line: '最后一页呢？', performance: '压低声音' }],
      narration: '',
      audio_description: {
        ambience: ['冷柜低鸣'],
        sound_effects: ['翻页声'],
        dialogue_treatment: '对白清晰',
        silence: false,
        music_cue: { mode: 'mute', intensity: 0, start: null, end: null },
      },
      transition: {
        type: 'cut',
        duration: 0,
        visual_description: null,
        audio_bridge: { mode: 'carry', duration_ms: 200, description: '冷柜声延续' },
      },
      base_image_prompt: '便利店柜台后，林晚翻看旧账本，电影近景。',
      base_video_prompt: '林晚翻开账本，镜头缓慢推近缺失的末页。',
      universal_segment_text: '@图片1 是便利店，@图片2 是林晚，@图片3 是账本。',
      is_primary: true,
    }],
  };
}

module.exports = { validExternalAiResult };
