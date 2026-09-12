import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = () => fs.readFileSync(path.join(root, 'src/views/productionStudio/studio/ScriptStage.vue'), 'utf8')

test('剧本本地快照：编辑时节流写 localStorage 快照，保存成功后清除', () => {
  const view = read()
  assert.match(view, /v21\.script\.snapshot\.\$\{this\.episodeId\}/, '快照键按剧集隔离')
  assert.match(view, /localStorage\.setItem\(/, '编辑时写入快照')
  assert.match(view, /localStorage\.removeItem\(/, '保存成功后清快照')
  assert.match(view, /writeLocalSnapshot/, '存在快照写入方法')
})

test('剧本恢复入口：检测到与服务端草稿不同的本地副本时提供恢复 Modal 与三动作', () => {
  const view = read()
  assert.match(view, /hasLocalSnapshot/, '存在本地副本检测')
  assert.match(view, /snapModalOpen/, '存在恢复 Modal 状态')
  assert.match(view, /恢复本地副本/, '动作一：恢复本地副本')
  assert.match(view, /丢弃本地副本/, '动作二：丢弃本地副本')
  assert.match(view, /discardLocalSnapshot/, '丢弃走显式方法')
  assert.match(view, /检测到未保存的本地副本/, '用户语言提示')
})

test('恢复动作不静默覆盖：恢复后标记 dirty 由用户确认保存，卸载不清快照', () => {
  const view = read()
  const restorePart = view.slice(view.indexOf('restoreLocalSnapshot'))
  assert.match(restorePart, /this\.dirty = true/, '恢复后置 dirty，不自动写库')
  const unmountPart = view.slice(view.indexOf('beforeUnmount'))
  assert.match(unmountPart, /clearTimeout\(this\.snapTimer\)/, '卸载清理快照定时器')
})
