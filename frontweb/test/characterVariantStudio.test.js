import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildVariantImageCandidates,
  buildVariantPrimaryPatch,
  findVariantAffectedStoryboards,
} from '../src/utils/characterVariantStudio.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('默认状态标签不会继承空状态占位图的全尺寸样式', () => {
  const source = fs.readFileSync(path.join(root, 'src/views/FilmCreate.vue'), 'utf8')
  assert.match(source, /<span v-else class="char-variant-card-empty">/)
  assert.match(source, /\.char-variant-card-image\s*>\s*\.char-variant-card-empty\s*\{/)
  assert.doesNotMatch(source, /\.char-variant-card-image\s*>\s*span\s*\{/)
})

test('候选历史把当前状态图置顶并去除重复项', () => {
  const candidates = buildVariantImageCandidates({
    image_url: 'https://cdn.example.com/current.png',
    local_path: 'projects/demo/current.png',
    extra_images: JSON.stringify([
      'projects/demo/old-a.png',
      'projects/demo/current.png',
      'https://cdn.example.com/old-b.png',
    ]),
  })

  assert.deepEqual(candidates, [
    { key: 'projects/demo/current.png', path: 'projects/demo/current.png', is_current: true, label: '当前状态图' },
    { key: 'projects/demo/old-a.png', path: 'projects/demo/old-a.png', is_current: false, label: '候选 1' },
    { key: 'https://cdn.example.com/old-b.png', path: 'https://cdn.example.com/old-b.png', is_current: false, label: '候选 2' },
  ])
})

test('选择历史本地图后把旧主图保留为候选且不会混入基础人物图', () => {
  const patch = buildVariantPrimaryPatch({
    image_url: 'https://cdn.example.com/current.png',
    local_path: 'projects/demo/current.png',
    extra_images: ['projects/demo/old-a.png', 'projects/demo/old-b.png'],
  }, 'projects/demo/old-a.png')

  assert.deepEqual(patch, {
    image_url: '',
    local_path: 'projects/demo/old-a.png',
    extra_images: ['projects/demo/current.png', 'projects/demo/old-b.png'],
  })
})

test('选择远程候选图时写入 image_url 而不是伪造 local_path', () => {
  const patch = buildVariantPrimaryPatch({
    image_url: '',
    local_path: 'projects/demo/current.png',
    extra_images: ['https://cdn.example.com/history.png'],
  }, 'https://cdn.example.com/history.png')

  assert.deepEqual(patch, {
    image_url: 'https://cdn.example.com/history.png',
    local_path: null,
    extra_images: ['projects/demo/current.png'],
  })
})

test('状态影响范围只包含显式引用该 variant_id 的分镜', () => {
  const storyboards = [
    { id: 1, storyboard_number: 1, characters: [{ id: 9 }], character_variant_links: [{ character_id: 9, variant_id: 101 }] },
    { id: 2, storyboard_number: 2, characters: [{ id: 9 }], character_variant_links: [{ character_id: 9, variant_id: 102 }] },
    { id: 3, storyboard_number: 3, characters: [{ id: 9 }], character_variant_links: [] },
    { id: 4, storyboard_number: 4, characters: [{ id: 8 }], character_variant_links: [{ character_id: 8, variant_id: 101 }] },
  ]

  assert.deepEqual(findVariantAffectedStoryboards(storyboards, 101).map((item) => item.id), [1, 4])
})
