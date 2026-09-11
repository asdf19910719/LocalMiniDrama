import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

test('C5 AI 辅助下拉：续写/润色恒有，选区存在时追加改写/扩写/缩写', () => {
  const view = read('src/views/productionStudio/studio/ScriptStage.vue')
  assert.match(view, /aiMenuAction\('continue'\)/, '下拉：续写')
  assert.match(view, /aiMenuAction\('polish'\)/, '下拉：润色')
  assert.match(view, /aiMenuAction\('rewrite'\)/, '下拉：改写选段')
  assert.match(view, /aiMenuAction\('expand'\)/, '下拉：扩写选段')
  assert.match(view, /aiMenuAction\('shorten'\)/, '下拉：缩写选段')
  assert.match(view, /v-if="selectionText"/, '选区相关项仅在有选区时出现')
  assert.match(view, /selectionText/, '选区文本被跟踪')
})

test('C2 剧本编辑器排版化：排版/编辑双态，台词行加粗与选段高亮', () => {
  const view = read('src/views/productionStudio/studio/ScriptStage.vue')
  assert.match(view, /editMode/, '编辑器具备排版/编辑模式状态')
  assert.match(view, /layout-view|排版预览/, '排版视图容器')
  assert.match(view, /ln-scene/, '场景标题行样式')
  assert.match(view, /ln-dialogue/, '台词行样式（角色名加粗）')
  assert.match(view, /sel-hl/, '选段高亮')
})
