# Canonical Storyboard Reference Pipeline Design

**Date:** 2026-09-05

## Problem

Imported episode packages correctly create one explicit character variant per imported character and persist storyboard-to-variant links. The editor nevertheless renders the base character image, forgets explicit variant selections after reload, and the ChatGPT image-generation adapter resolves a different legacy character-link table. The visible reference and the submitted reference can therefore disagree.

## Decision

Treat `storyboard_character_variants` plus `referenceSlotService.resolveStoryboardSlots()` as the canonical storyboard character-reference source.

1. The drama payload exposes ordered `character_variant_links` on every storyboard.
2. The editor hydrates explicit selections and link metadata from that payload.
3. Character thumbnails and local Omni fallbacks resolve the selected variant image. An explicit imageless variant remains a placeholder; it must not silently fall back to the base character image.
4. Saving a changed variant preserves imported `reference_role`, `sort_order`, and `framing_note` for existing character links.
5. Storyboard image generation consumes canonical reference slots in scene → variant → prop order. It omits unavailable images without changing each retained reference's canonical slot index.
6. Local files are converted to URLs that the browser extension can fetch: storage-relative paths become `/static/...`; imported external result paths become `/api/v1/external-generation/results/:id/content`; remote URLs stay remote.

## Compatibility

Legacy storyboards without explicit variant links retain the existing resolver fallback that synthesizes default variants from `storyboards.characters`. No database migration is required. Existing API fields remain unchanged; `character_variant_links` is additive.

## Validation

Automated tests cover canonical ordering, external-result URL conversion, drama payload hydration, metadata preservation, explicit imageless variants, and selected-variant thumbnail resolution. Final acceptance uses the live browser and imported episode: continuously enqueue every character, character state, prop, and scene; wait for every task to complete; reload; and verify each generated image renders successfully.
