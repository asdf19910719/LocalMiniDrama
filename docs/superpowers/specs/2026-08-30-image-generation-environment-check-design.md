# Image Generation Environment Check Design

## Goal

Prevent image-generation tasks from being created or sent when the selected generation channel is not ready, and expose actionable diagnostics in the project page and generation drawer.

## Scope

The check is channel-aware. API generation checks server/configuration/provider readiness; ChatGPT web generation checks the backend, browser-extension bridge, provider tab, conversation binding, content script, composer, and task references. The check never performs a billable image generation request.

## Design

### Three layers

1. Project-page health status performs cheap checks and caches the result for 30 seconds.
2. Generation start runs a mandatory full preflight before creating a task.
3. Queue dispatch runs a lightweight recheck before sending each task. Runtime failures remain a final defense.

### Result contract

The frontend aggregates structured checks into:

```js
{
  canProceed: Boolean,
  channel: 'api' | 'chatgpt_web',
  checkedAt: String,
  checks: [{ key, status: 'ok' | 'failed' | 'skipped', code, message }]
}
```

Backend and extension return technical codes; the frontend maps them to Chinese copy and remediation actions. API keys and other secrets are never returned.

### Queue behavior

If full preflight fails, no image task is created. If a lightweight dispatch check fails after tasks are queued, the queue pauses in memory and leaves queued tasks intact. Existing send-time errors still transition the current task according to the existing retry/error policy.

### UI

The shared project image-task status area shows aggregate health, last-check time, and a recheck action. The drawer shows the same check details and blocks the ChatGPT send action while a mandatory check is pending or failed. API tasks do not require browser-extension checks.

## Acceptance criteria

- Missing or stale extension bridge blocks ChatGPT task creation with a reload/recheck action.
- Missing ChatGPT tab, mismatched conversation, unavailable composer, or invalid reference blocks dispatch with a specific reason.
- API generation is not blocked by ChatGPT conditions.
- A mid-queue environment failure pauses dispatch without converting all queued tasks to failed.
- Health checks are cached, cancellable by a newer run, and safe to repeat.
