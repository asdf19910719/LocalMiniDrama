import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getSbImagesList,
  resolveSbFirstImageRecord,
  resolveSbLastImageRecord,
  resolveSbMainImageRecord,
} from '../src/utils/storyboardMedia.js'

const sb = { id: 8 }

test('filters grid source images but keeps generated panel images available', () => {
  const images = {
    8: [
      { id: 90, status: 'completed', frame_type: 'nine_grid', local_path: 'grid.jpg' },
      { id: 91, status: 'completed', frame_type: 'nine_panel_4', local_path: 'panel-4.jpg' },
      { id: 92, status: 'completed', frame_type: null, local_path: 'main.jpg' },
    ],
  }

  assert.deepEqual(getSbImagesList(images, 8).map((item) => item.id), [91, 92])
})

test('main image prefers a normal storyboard image over a grid panel or frame image', () => {
  const images = {
    8: [
      { id: 91, status: 'completed', frame_type: 'nine_panel_4', local_path: 'panel-4.jpg' },
      { id: 92, status: 'completed', frame_type: 'storyboard_last', local_path: 'last.jpg' },
      { id: 93, status: 'completed', frame_type: 'storyboard_first', local_path: 'first.jpg' },
      { id: 94, status: 'completed', frame_type: null, local_path: 'main.jpg' },
    ],
  }

  assert.equal(resolveSbMainImageRecord(sb, images).id, 94)
})

test('main image uses a stable panel fallback when only split panels exist', () => {
  const images = {
    8: [
      { id: 93, status: 'completed', frame_type: 'nine_panel_8', local_path: 'panel-8.jpg' },
      { id: 91, status: 'completed', frame_type: 'nine_panel_0', local_path: 'panel-0.jpg' },
      { id: 92, status: 'completed', frame_type: 'nine_panel_4', local_path: 'panel-4.jpg' },
    ],
  }

  assert.equal(resolveSbMainImageRecord(sb, images).id, 91)
})

test('main image honors the storyboard-selected grid panel', () => {
  const images = {
    8: [
      { id: 91, status: 'completed', frame_type: 'nine_panel_0', local_path: 'panel-0.jpg' },
      { id: 95, status: 'completed', frame_type: 'nine_panel_4', local_path: 'panel-4.jpg' },
    ],
  }

  assert.equal(resolveSbMainImageRecord({ ...sb, main_panel_idx: 4 }, images).id, 95)
})

test('first and last frame resolvers do not select ordinary main image as a typed frame', () => {
  const images = {
    8: [
      { id: 94, status: 'completed', frame_type: null, local_path: 'main.jpg' },
    ],
  }

  assert.equal(resolveSbFirstImageRecord(sb, images), null)
  assert.equal(resolveSbLastImageRecord(sb, images), null)
})
