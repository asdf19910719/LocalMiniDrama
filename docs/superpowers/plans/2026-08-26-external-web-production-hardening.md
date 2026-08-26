# External Web Generation Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make external ChatGPT image generation usable from the real FilmCreate Shot workflow with reliable extension injection and exact Shot/session identity binding.

**Architecture:** Reuse the existing `ExternalWebGenerationPanel` and external-generation API contracts. Add a small pure helper in the FilmCreate view for Shot prompt/reference assembly, render the panel inside each Shot row, and keep all job/attempt/result identifiers in the existing backend model. Package the ChatGPT content script as a browser-loadable bundle and let the MV3 service worker reinject it on ChatGPT tab updates when needed.

**Tech Stack:** Vue 3 + Element Plus, Node test runner, Chrome MV3 extension, esbuild, Express API.

---

### Task 1: Expose external generation in FilmCreate Shot rows

**Files:**
- Create: `frontweb/src/utils/externalGenerationShot.js`
- Modify: `frontweb/src/views/FilmCreate.vue`
- Test: `frontweb/test/filmCreateExternalGeneration.test.js`

- [ ] **Step 1: Write the failing test**

Add a source-level regression test that requires `FilmCreate.vue` to import and render `ExternalWebGenerationPanel`, and requires the helper to preserve the Shot id while collecting only the selected scene/characters/props in deterministic order.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --test frontweb/test/filmCreateExternalGeneration.test.js`
Expected: FAIL because FilmCreate has no external panel and the helper does not exist.

- [ ] **Step 3: Implement the minimal helper and view integration**

Implement `buildExternalGenerationShotContext({ dramaId, storyboard, getScene, getCharacters, getProps, assetImageUrl })` returning `{ dramaId, storyboardId, prompt, references }`, where prompt prefers `image_prompt`, then `polished_prompt`, then `description`, and references are `{ name, mime, url, role, sourceId }` entries ordered scene, characters, props. Import the panel into `FilmCreate.vue` and render it once inside each `.storyboard-row`, passing `dramaId`, `storyboardId`, `initialPrompt`, `references`, `site="chatgpt"`, and `provider="chatgpt-web"`.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `node --test frontweb/test/filmCreateExternalGeneration.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontweb/src/utils/externalGenerationShot.js frontweb/src/views/FilmCreate.vue frontweb/test/filmCreateExternalGeneration.test.js
git commit -m "feat: expose external image generation in film create shots"
```

### Task 2: Make ChatGPT content injection browser-loadable and automatic

**Files:**
- Create: `browser-extension/scripts/build.mjs`
- Create: `browser-extension/src/sites/chatgpt/content.bundle.js`
- Modify: `browser-extension/manifest.json`
- Modify: `browser-extension/src/background.js`
- Modify: `browser-extension/package.json`
- Test: `browser-extension/test/chatgptInjection.test.js`

- [ ] **Step 1: Write the failing test**

Add tests asserting the manifest points at a bundled ChatGPT content script with no unsupported module import, and that `registerBackground` registers a `tabs.onUpdated` listener which calls `scripting.executeScript` for a ChatGPT URL.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- --test-name-pattern="ChatGPT content injection"` from `browser-extension`.
Expected: FAIL because the manifest currently points to `content.js` containing static imports and the background has no tab-update injector.

- [ ] **Step 3: Implement the bundle and injector**

Add esbuild as a dev dependency and a deterministic `npm run build` script that bundles `src/sites/chatgpt/content.js` as an IIFE to `src/sites/chatgpt/content.bundle.js`. Point the manifest at the bundle. Add an exported `injectChatGPTContentScript(chromeApi, tabId, url)` helper that validates ChatGPT hosts and calls `chrome.scripting.executeScript({ target: { tabId }, files: ['src/sites/chatgpt/content.bundle.js'] })`; register it from `tabs.onUpdated` and ignore restricted/inaccessible tabs without breaking the service worker.

- [ ] **Step 4: Build and run focused tests**

Run: `npm run build`; then `npm test -- --test-name-pattern="ChatGPT content injection"`.
Expected: build exits 0 and focused tests pass.

- [ ] **Step 5: Commit**

```bash
git add browser-extension
git commit -m "fix: bundle and reinject chatgpt content bridge"
```

### Task 3: Fresh production verification and real Chrome acceptance

**Files:**
- Modify only if verification exposes a defect in the files above.

- [ ] **Step 1: Run all automated checks**

Run `npm test` in `browser-extension`, `node --test frontweb/test/*.test.js`, `npm run build` in `frontweb`, and the backend external-generation test subset.

- [ ] **Step 2: Verify service routes and processes**

Confirm `GET http://127.0.0.1:5679/health`, `POST http://127.0.0.1:5679/api/v1/external-generation/jobs`, and that port 3013 is serving the feature worktree.

- [ ] **Step 3: Reload the existing isolated Chrome extension**

Use CDP at `http://127.0.0.1:9333`, reload the extension, open `https://chatgpt.com/`, and verify `runtime.sendMessage({ action: 'identity' })` returns a conversation identity instead of “Receiving end does not exist”.

- [ ] **Step 4: Validate one real Shot end to end**

From `http://127.0.0.1:3013/film/<dramaId>?episode=<episodeId>`, prepare one Shot, send through the existing ChatGPT conversation, observe the real assistant result, import the downloaded bytes with SHA-256, select the candidate, refresh, and verify the selected result remains bound to the same `dramaId` and `storyboardId`.

- [ ] **Step 5: Validate same-session continuity**

Run a second Shot through the same ChatGPT tab/conversation and verify the conversation id is unchanged and no new ChatGPT history entry is created.
