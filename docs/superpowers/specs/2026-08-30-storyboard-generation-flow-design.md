# Storyboard Generation Flow Design

## Goal

Make storyboard image/video generation deterministic and auditable across universal prompts, H3 compilation, references, timing, image display, merge, and TTS.

## Behavior Contract

1. The video drawer keeps the universal segment text as the editable business prompt. A prior H3 compiled prompt is shown separately as read-only history and never silently replaces the business prompt.
2. ChatGPT web image tasks are bound to their target identity. Reference manifests are resolved from the target on the backend and cannot be inherited from another task or shot.
3. A video candidate exposes both actual execution start time and elapsed generation duration. Legacy records without an execution start remain readable.
4. Storyboard image selection treats main images and generated grid images consistently. Grid source images are not accidentally shown as the shot's main image when a split child exists.
5. The full user workflow remains available: image generation, candidate video generation/selection, episode merge, dialogue/narration TTS.

## Scope

Frontend: video drawer/composable, image-generation callers, storyboard media selector.

Backend: candidate projection, image-generation target resolution, task reference binding, video timing persistence/projection.

Testing: focused frontend/backend regression tests plus existing suites and production build.
