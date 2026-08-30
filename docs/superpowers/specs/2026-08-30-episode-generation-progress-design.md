# Episode Generation Progress Design

## Goal

在 FilmCreate 的“一键全流程”下方提供当前集的持久化生图、生视频和整集合成进度视图，并复用现有生图环境检测结果。

## Scope

第一期只聚合当前集的媒体事实，不记录一键流程本身的可恢复步骤。聚合结果从现有 SQLite 表实时计算，因此刷新页面、切换分集或重新打开制作页后仍可查看。环境检测继续由前端现有 `imageGenerationStore` 执行，因为 ChatGPT Web 的扩展、标签页和会话状态只存在浏览器侧。

## Data Model

新增只读接口 `GET /api/v1/episodes/:episodeId/generation-progress`，返回：

```js
{
  episode_id: Number,
  image: {
    total: Number,
    completed: Number,
    active: Number,
    needs_review: Number,
    failed: Number,
    pending: Number,
    percent: Number,
    by_type: {
      characters: { total, completed, active, needs_review, failed, pending, percent },
      scenes: { total, completed, active, needs_review, failed, pending, percent },
      props: { total, completed, active, needs_review, failed, pending, percent },
      storyboard_main: { total, completed, active, needs_review, failed, pending, percent },
      storyboard_first: { total, completed, active, needs_review, failed, pending, percent },
      storyboard_last: { total, completed, active, needs_review, failed, pending, percent }
    }
  },
  video: {
    total: Number,
    completed: Number,
    active: Number,
    failed: Number,
    pending: Number,
    percent: Number,
    active_items: [{ storyboard_id, storyboard_number, status, progress, provider, model, message, error }]
  },
  merge: { status, progress, task_id, message, error },
  generated_at: String
}
```

Image targets are derived from current episode entities. A character, scene, or prop is complete when it has an image URL or local path. A storyboard has a main-image target; first/last-frame targets are included only when the episode/storyboard metadata enables the first/last-frame mode and the storyboard is classic rather than universal. An active or review task is reported independently even when an older image exists, so the user can see newly requested work without losing the completed asset count. The latest failed task is reported as failed only when no usable image is bound.

Video targets are eligible storyboards that have the required reference inputs for their mode. A storyboard is complete when it has a playable video record (`completed`, `review`, or `selected` plus `video_url`/`local_path`). Active records use their persisted async-task progress; failed records are reported only when no playable record exists. Candidate count does not increase the episode denominator. Episode merge is always a separate status row and is not blended into the shot percentage.

## Environment Integration

The existing `imageGenerationStore.environment` and `checkEnvironment()` remain the source of truth for API/ChatGPT Web readiness. The progress panel receives this reactive value and displays it as a separate health row. `environment_blocked`, missing credentials, bridge failures, and stale browser state never increment image `failed` and never reduce the percentage. The existing 30-second environment cache prevents duplicate checks from the task pill and progress panel.

## Frontend Placement and Interaction

Create a focused `EpisodeGenerationProgress` component and mount it directly below the pipeline section in `FilmCreate.vue`, above resource management. The section header identifies the current episode and last refresh time. It contains independent image and video progress bars, count tags for review/failed/active items, a merge status line, environment status, and a compact active-item list. Clicking an active video item scrolls to its storyboard and opens the existing video generation drawer; clicking a review/failed image count opens the existing image task drawer when an active task is available. A manual refresh action is provided, while automatic refresh runs only while the section is mounted and stops on unmount.

The component never owns generation mutations. Cancel/retry actions continue through existing task/video APIs and the next refresh reflects their result. Loading, API failure, empty episode, and stale-data states are explicit; a failed progress request keeps the last successful snapshot and shows a non-blocking warning.

## Data Flow

1. `FilmCreate` loads the selected episode and calls the new progress API.
2. `EpisodeGenerationProgress` polls the endpoint every five seconds while mounted.
3. `ImageGenerationEnvironmentStatus` renders the shared environment object; the existing task pill may refresh the same store cache.
4. Media refresh callbacks after task completion remain unchanged; the next aggregate poll observes the persisted result.

## Error Handling

- Unknown or deleted episode returns 404 through the existing response helper.
- Aggregation query failures return the normal API error envelope; frontend keeps the last snapshot and exposes “刷新失败”.
- Missing optional tables/legacy columns are handled by the existing migration guarantees and conservative empty counts.
- Progress is `0` when `total === 0`; the UI labels this as “暂无可生成目标” rather than “0% 失败”.

## Testing

- Backend service tests cover target discovery, bound uploads, active/review/failed precedence, first/last-frame rules, playable-video detection, async progress, merge status, and empty episodes.
- Route tests cover 200 response shape and 404/500 behavior.
- Frontend utility/component tests cover percent calculation, status labels, environment separation, polling cleanup, stale snapshot fallback, and active-item navigation hooks.
- Run backend and frontend full suites plus frontend production build.

## Future Extension

If exact recovery of a paused one-click pipeline becomes a requirement, add a separate `generation_runs`/`generation_run_steps` model. This design intentionally keeps that higher-risk change out of the first release.
