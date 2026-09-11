import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

test('B6 自由创作加入个人资产库：接 character/scene/prop-library create，原生弹窗清除', () => {
  const api = read('src/v21/api.js')
  assert.match(api, /addToLibrary/, 'api 应有 addToLibrary')
  assert.match(api, /\$\{kind\}-library/, '复用 v1 资产库 create 端点')
  const view = read('src/views/productionStudio/QuickCreateView.vue')
  assert.match(view, /addToLibrary/, '入库按钮真实调用')
  assert.match(view, /libraryKind/, '可选择角色/场景/道具库')
  assert.match(view, /source_type: 'quick-create'/, '入库来源可追溯')
  assert.match(view, /abandonOpen/, '放弃确认走专用 Modal')
  assert.doesNotMatch(view, /comingSoon|window\.confirm|window\.prompt|alert\(/, '本视图占位与原生弹窗清除')
})

// ---- Task 4.5：自由创作配置字段 / 费用确认步 / 会话历史 / 结果去向补全 ----

function readQuickCreate() {
  return read('src/views/productionStudio/QuickCreateView.vue')
}

test('4.5-1 配置抽屉：画幅/分辨率/数量三组段选存在，默认 16:9 / 720p / 1，预检为真实口径', () => {
  const view = readQuickCreate()
  assert.match(view, /aspectRatio: '16:9'/, '画幅默认 16:9')
  assert.match(view, /resolution: '720p'/, '分辨率默认 720p')
  assert.match(view, /genCount: 1/, '生成数量默认 1')
  assert.match(view, /'16:9'[\s\S]*?'9:16'/, '画幅含 16:9 与 9:16 两个选项')
  assert.match(view, /'720p'[\s\S]*?'1080p'/, '分辨率含 720p 与 1080p 两个选项')
  assert.match(view, /genCount = 2[\s\S]*genCount = 3/, '生成数量提供 1/2/3 段选')
  assert.match(view, /能力 ✓（本地 mock 通道）· 参数已校验/, '预检行改为真实口径')
})

test('4.5-2 费用/耗时确认步：配置"下一步"→确认抽屉→"确认生成"才调用 mockQuickGenerate，执行中防重复', () => {
  const view = readQuickCreate()
  assert.match(view, /@click="goConfirm"[^>]*>下一步/, '配置抽屉提交按钮为"下一步"')
  assert.match(view, /@click="confirmGenerate"[^>]*>确认生成/, '确认抽屉按钮为"确认生成"')
  assert.doesNotMatch(view, /@click="submit"/, '旧的单步 submit 不应存在')
  const goConfirm = view.match(/goConfirm\(\)\s*\{([\s\S]*?)\n    \},/)
  assert.ok(goConfirm, '应有 goConfirm 方法')
  assert.match(goConfirm[1], /confirmOpen = true/, '下一步应打开确认抽屉')
  assert.doesNotMatch(goConfirm[1], /mockQuickGenerate/, 'goConfirm 不得直接触发生成')
  const confirmGenerate = view.match(/confirmGenerate\(\)\s*\{([\s\S]*?)\n    \},/)
  assert.ok(confirmGenerate, '应有 confirmGenerate 方法')
  assert.match(confirmGenerate[1], /if \(!prompt\.trim\(\) \|\| busy\) return|if \(this\.busy\) return/, '执行中防重复')
  assert.match(confirmGenerate[1], /mockQuickGenerate/, '确认后才调用 mockQuickGenerate')
  assert.match(confirmGenerate[1], /mockQuickComplete/, '并等待完成')
  assert.match(view, /本地生成（mock）/, '确认抽屉标注通道为本地生成（mock）')
  assert.match(view, /本地生成，不产生 API 费用/, '确认抽屉标注费用')
  assert.match(view, /当前通道单次生成 1 个结果，数量将在真实通道生效/, '数量>1 时诚实标注 mock 契约')
})

test('4.5-3 会话生成历史区：成功后追加，含时间/类型/状态/缩略/打开结果，注明仅本次会话', () => {
  const view = readQuickCreate()
  assert.match(view, /本次会话生成历史/, '历史区标题存在')
  assert.match(view, /仅保留本次会话记录/, '注明内存态、刷新即清')
  assert.match(view, /history: \[\]/, 'history 为内存态数组')
  const confirmGenerate = view.match(/confirmGenerate\(\)\s*\{([\s\S]*?)\n    \},/)
  assert.ok(confirmGenerate, '应有 confirmGenerate 方法')
  assert.match(confirmGenerate[1], /pushHistory\(/, '生成成功后自动入历史')
  assert.match(view, /pushHistory\(status\)|pushHistory\('已生成'\)/, 'pushHistory 记录状态')
  assert.match(view, /已归档/, '历史状态含已归档')
  assert.match(view, /已放弃/, '历史状态含已放弃')
  assert.match(view, /openHistoryItem/, '提供打开结果')
})

test('4.5-4 绑定项目素材：两步目标选择（项目→素材单选），确认后 uploadAssetCandidate 写候选，支持新建素材回退', () => {
  const view = readQuickCreate()
  assert.match(view, /bindOpen/, '绑定走专用弹窗')
  const openBind = view.match(/openBind\(\)\s*\{([\s\S]*?)\n    \},/)
  assert.ok(openBind, '应有 openBind 方法')
  const bindProject = view.match(/onBindProject\(\)|async onBindProject\(\)/)
  assert.ok(bindProject, '选择项目后加载素材')
  assert.match(view, /v21\.listAssets\(this\.bindProjectId/, '选素材用 listAssets 单选')
  const bindConfirm = view.match(/bindConfirm\(\)|async bindConfirm\(\)/)
  assert.ok(bindConfirm, '应有 bindConfirm 确认方法')
  assert.match(view, /v21\.uploadAssetCandidate\(/, '选中素材后用 uploadAssetCandidate 写入 URL 候选')
  assert.match(view, /bindMode/, '弹窗内提供新建素材回退选项')
  assert.match(view, /v21\.createAsset\(this\.bindProjectId/, '新建素材保留自动创建路径')
  assert.match(view, /bindNewLocation/, '场景类型新建素材带 location')
  assert.match(view, />绑定项目素材</, '入口按钮保留')
})

test('4.5-5 加入分镜候选：项目→剧集→镜头链路 + uploadShotImage，视频结果禁用并说明', () => {
  const view = readQuickCreate()
  assert.match(view, /shotOpen/, '分镜候选走专用弹窗')
  assert.match(view, /v21\.listEpisodes\(this\.shotProjectId/, '选择剧集')
  assert.match(view, /v21\.getStoryboard\(this\.shotEpisodeId/, '加载镜头列表')
  assert.match(view, /v21\.uploadShotImage\(this\.shotShotId, \{ imageUrl: this\.result\.url \}\)/, 'URL 上传为镜头分镜候选')
  assert.match(view, /作为该镜头分镜图候选，可在分镜页设为当前/, '确认弹窗注明语义')
  assert.match(view, /:disabled="kind !== 'image'"[^>]*@click="openShot"|:disabled="kind !== 'image'"[^>]*>加入分镜候选/, '视频结果禁用该去向')
  assert.match(view, /mock 视频暂无候选上传端点/, '禁用时给出说明')
})

test('4.5-6 加入短片时间线：诚实禁用 + 说明，不做死按钮', () => {
  const view = readQuickCreate()
  assert.match(view, /<button class="btn sm" disabled[^>]*>加入短片时间线</, '短片时间线为禁用项')
  assert.match(view, /合成素材暂不支持直接加入短片，请在分镜页采用镜头后合成/, '禁用项附说明')
})

test('4.5-7 scene 入库带 location（P3.4 遗留修复）', () => {
  const view = readQuickCreate()
  const addToLibrary = view.match(/async addToLibrary\(\)\s*\{([\s\S]*?)\n    \},/)
  assert.ok(addToLibrary, '应有 addToLibrary 方法')
  assert.match(addToLibrary[1], /location/, 'scene 分支应补 location 字段')
})
