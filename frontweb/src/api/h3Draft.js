import request from '@/utils/request'

/** H3 提示词草稿三接口:草稿按 (storyboard, video_config, workflow) 精确绑定。 */
export const h3DraftAPI = {
  /** GET /storyboards/:id/h3-prompt-draft?video_config_id=... → { draft|null, freshness:{stale,reasons[]} } */
  getDraft(storyboardId, videoConfigId, workflowId) {
    return request.get(`/storyboards/${storyboardId}/h3-prompt-draft`, {
      params: { video_config_id: videoConfigId, workflow_id: workflowId },
    })
  },
  /** POST /storyboards/:id/h3-prompt-draft/compile body { video_config_id } → { draft, freshness } */
  compileDraft(storyboardId, videoConfigId, workflowId) {
    return request.post(`/storyboards/${storyboardId}/h3-prompt-draft/compile`, {
      video_config_id: videoConfigId,
      workflow_id: workflowId,
    })
  },
  /** PUT /storyboards/:id/h3-prompt-draft body { draft_id, final_text, manually_edited } → { draft, freshness } */
  saveDraft(storyboardId, body) {
    return request.put(`/storyboards/${storyboardId}/h3-prompt-draft`, body || {})
  },
  confirmSemanticReview(storyboardId, draftId, compiledPromptHash) {
    return request.post(`/storyboards/${storyboardId}/h3-prompt-draft/confirm-semantic-review`, {
      draft_id: draftId,
      compiled_prompt_hash: compiledPromptHash,
    })
  },
}
