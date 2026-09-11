import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

test('T4.6 Rail 更多工具：底部入口展开 自由创作/媒体素材库/AI 配置·高级 三链接，外点与 Esc 可关闭', () => {
  const app = read('src/App.vue')
  assert.match(app, /更多工具/, 'Rail 应有「更多工具」入口（不占用一级导航）')
  assert.match(app, /to="\/quick-create"/, '更多工具应含「自由创作」链接（/quick-create）')
  assert.match(app, /to="\/media-library"/, '更多工具应含「媒体素材库」链接（/media-library）')
  assert.match(app, /to="\/ai-config\/advanced"/, '更多工具应含「AI 配置 · 高级」链接（/ai-config/advanced）')
  assert.match(app, /自由创作/, '「自由创作」文案可见')
  assert.match(app, /媒体素材库/, '「媒体素材库」文案可见')
  assert.match(app, /AI 配置 · 高级/, '「AI 配置 · 高级」文案可见')
  assert.match(app, /addEventListener\('click', this\.onDocClick\)/, '外点关闭应有 document click 监听')
  assert.match(app, /onKeydown[\s\S]*Escape/, 'Esc 应关闭更多工具菜单')
})

test('T4.6 分镜更多菜单：末尾「高级画布」指向该集 canvas 路由', () => {
  const view = read('src/views/productionStudio/studio/StoryboardStage.vue')
  const item = view.match(/@click="openAdvancedCanvas"[^>]*>([^<]*)</)
  assert.ok(item, '更多菜单应有「高级画布」项')
  assert.match(item[1], /高级画布/, '菜单项文案为「高级画布」')
  const method = view.match(/openAdvancedCanvas\(\)\s*\{[\s\S]*?\$router\.push\(([^)]*)\)/)
  assert.ok(method, '应有 openAdvancedCanvas 方法')
  assert.match(
    method[1],
    /`\/projects\/\$\{this\.projectId\}\/episodes\/\$\{this\.episodeId\}\/canvas`/,
    '应 push 该集 canvas 路由'
  )
})

test('T4.6 媒体库路由：/media-library 指向 V2.1 版 productionStudio/MediaLibraryView，旧 Element Plus 页不再被路由引用', () => {
  const router = read('src/router/index.js')
  const seg = router.match(/path: '\/media-library'[\s\S]*?component: \(\) => import\('([^']+)'\)/)
  assert.ok(seg, '应有 /media-library 路由')
  assert.match(seg[1], /productionStudio\/MediaLibraryView\.vue/, '应指向 V2.1 版 MediaLibraryView')
  assert.doesNotMatch(router, /@\/views\/MediaLibrary\.vue/, '路由不得再引用旧版 @/views/MediaLibrary.vue')
  assert.equal(
    fs.existsSync(path.join(root, 'src/views/MediaLibrary.vue')),
    true,
    '旧页面文件保留（仅脱离路由，避免影响可能的直接 import）'
  )
})
