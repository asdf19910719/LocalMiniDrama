import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

const view = () => read('src/views/productionStudio/ProjectAssetsView.vue')

test('B7 删除确认先行：删除按钮不再直连 deleteAsset，走自建确认弹窗', () => {
  const src = view()
  // 模板与脚本里全流程只允许出现一次 deleteAsset 调用（确认后才删）
  const calls = src.match(/v21\.deleteAsset\(/g) || []
  assert.equal(calls.length, 1, 'deleteAsset 全流程只调一次')
  // 删除按钮绑定确认入口，不再直连 remove/deleteAsset
  assert.match(src, /@click="askRemove"/, '删除按钮应绑定 askRemove 确认入口')
  assert.doesNotMatch(src, /@click="remove"/, '删除按钮不得直连 remove')
  // 存在自建确认弹窗状态位与确认执行方法
  assert.match(src, /removeOpen/, '存在删除确认弹窗状态位 removeOpen')
  assert.match(src, /confirmRemove/, '存在确认删除方法 confirmRemove')
  // 弹窗文案：回收站语义 + 可恢复说明，取消/确认两按钮
  assert.match(src, /移入回收站/, '弹窗标题为「移入回收站」')
  assert.match(src, /可恢复删除|高级数据工具恢复/, '弹窗说明包含可恢复语义')
  assert.match(src, /confirmRemove\(\)[\s\S]*?已移入回收站|已移入回收站[\s\S]*?confirmRemove\(\)/, '删除成功后有提示')
})

test('P0-7 生成确认 Sheet：两个生成入口都改为打开确认 Sheet，确认后才生成', () => {
  const src = view()
  // 两个生成入口（候选行 + 与页脚按钮）都绑定 openGenSheet，不再直连 generate
  assert.doesNotMatch(src, /@click="generate"/, '生成入口不得直连 generate')
  const entries = src.match(/@click="openGenSheet"/g) || []
  assert.equal(entries.length, 2, '候选行"+"与页脚「生成候选」两个入口都绑定 openGenSheet')
  // Sheet 状态位与确认方法存在
  assert.match(src, /genSheetOpen/, '存在生成确认 Sheet 状态位 genSheetOpen')
  assert.match(src, /confirmGenerate/, '存在确认生成方法 confirmGenerate')
  // Sheet 固定顺序内容：对象 → 生成通道 → 参数 → 任务与费用摘要
  assert.match(src, /生成通道/, 'Sheet 展示生成通道')
  assert.match(src, /本地生成/, '通道口径为本地生成（mock 默认）')
  assert.match(src, /不产生 API 费用/, '费用摘要标注本地生成不产生 API 费用')
  assert.match(src, /画布尺寸/, 'Sheet 展示画布尺寸参数')
  assert.match(src, /genPrompt/, 'Sheet 内提示词可编辑（genPrompt）')
  assert.match(src, /1 个生成任务/, 'Sheet 展示任务与费用摘要')
  // 确认方法调用 generateAssetCandidate 且提交 Sheet 内编辑后的 prompt
  const fn = src.match(/async confirmGenerate\(\)[\s\S]*?\n    \},\n/)
  assert.ok(fn, '能定位 confirmGenerate 方法体')
  assert.match(fn[0], /v21\.generateAssetCandidate\(/, 'confirmGenerate 调用 generateAssetCandidate')
  assert.match(fn[0], /prompt: this\.genPrompt/, '提交 Sheet 内编辑后的 prompt')
  // 成功提示与防重复提交
  assert.match(fn[0], /已生成候选/, '生成成功提示「已生成候选」')
  assert.match(src, /:disabled="generating"/, '提交中按钮禁用防重复提交')
})

test('评审修复：失败/阻塞呈现在弹窗体内（removeError/genError），原生弹窗清零', () => {
  const src = view()
  // 删除确认弹窗体内含 removeError 错误行；生成 Sheet 体内含 genError 错误行
  const removeModal = src.match(/<!-- 删除确认 Modal[\s\S]*?<!-- 生成确认 Sheet/)
  assert.ok(removeModal, '定位删除确认 Modal 块')
  assert.match(removeModal[0], /v-if="removeError"/, '删除弹窗体内含 removeError 错误行')
  const genSheet = src.match(/<!-- 生成确认 Sheet[\s\S]*<\/template>/)
  assert.ok(genSheet, '定位生成确认 Sheet 块')
  assert.match(genSheet[0], /v-if="genError"/, '生成 Sheet 体内含 genError 错误行')
  // 弹窗打开期间的失败/阻塞走弹窗内错误行，不再置页面级 notice（被遮罩遮挡感知不到）
  const fnRemove = src.match(/async confirmRemove\(\)[\s\S]*?\n    \},\n/)
  assert.ok(fnRemove, '能定位 confirmRemove 方法体')
  assert.match(fnRemove[0], /this\.removeError = result\.message/, 'confirmRemove 的 blocked 分支走弹窗内错误行')
  assert.doesNotMatch(fnRemove[0], /this\.notice = e\.message/, 'confirmRemove 的 catch 不再把失败写进被遮罩的页面 notice')
  const fnGen = src.match(/async confirmGenerate\(\)[\s\S]*?\n    \},\n/)
  assert.ok(fnGen, '能定位 confirmGenerate 方法体')
  assert.match(fnGen[0], /this\.genError = /, 'confirmGenerate 的 catch 走 Sheet 内错误行')
  assert.doesNotMatch(fnGen[0], /this\.notice = e\.message/, 'confirmGenerate 不再把失败写进被遮罩的页面 notice')
  // Minor：useCandidate 补 catch；comingSoon 不再用原生 alert
  const fnUse = src.match(/async useCandidate\(candidate\)[\s\S]*?\n    \},\n/)
  assert.ok(fnUse, '能定位 useCandidate 方法体')
  assert.match(fnUse[0], /catch/, 'useCandidate 补 catch 提示')
  assert.doesNotMatch(src, /\balert\(|window\.confirm|window\.prompt/, '本视图原生弹窗清零')
  assert.match(src.match(/comingSoon\(name\)[\s\S]*?\n    \},\n/)[0], /this\.notice = /, 'comingSoon 改走 notice 提示条')
})

// ---- Task 3.1：五标签抽屉 / 候选撤销 / 人物状态卡 ----

test('P0-5 详情抽屉五标签：固定五个标签定义与真实切换结构', () => {
  const src = view()
  const tabs = src.match(/drawerTabs:\s*\[[\s\S]*?\]/)
  assert.ok(tabs, '存在 drawerTabs 五标签定义')
  const expectations = [
    ['overview', '概览'],
    ['versions', '版本与候选'],
    ['usage', '使用位置'],
    ['records', '生成记录'],
    ['advanced', '高级'],
  ]
  for (const [key, label] of expectations) {
    assert.match(tabs[0], new RegExp(`key: '${key}'`), `drawerTabs 含 ${key}`)
    assert.match(tabs[0], new RegExp(`label: '${label}'`), `drawerTabs 含中文标签 ${label}`)
    assert.match(src, new RegExp(`activeTab === '${key}'`), `存在 ${key} 标签面板切换条件`)
  }
  assert.match(src, /activeTab: 'overview'/, '当前标签名存组件 state（activeTab）')
  assert.match(src, /@click="activeTab = t\.key"/, '点击标签切换真实内容')
  // 高级标签：只读信息 + 危险区复用既有删除确认
  const advanced = src.match(/<!-- 标签 5：高级[\s\S]*?(?=<\/aside>|<!-- 标签)/)
  assert.ok(advanced, '定位高级标签面板')
  assert.match(advanced[0], /素材 ID/, '高级标签展示只读信息')
  assert.match(advanced[0], /@click="askRemove"/, '危险区按钮复用既有删除确认入口')
})

test('P0-8 候选撤销：点击候选出现「已设为当前图｜撤销」横条，撤销回传 previous url', () => {
  const src = view()
  assert.match(src, /undoStrip/, '存在撤销横条状态 undoStrip')
  assert.match(src, /已设为当前图/, '横条文案「已设为当前图」')
  assert.match(src, /@click="undoUseCandidate"/, '横条提供撤销按钮')
  const fnUndo = src.match(/async undoUseCandidate\(\)[\s\S]*?\n    \},\n/)
  assert.ok(fnUndo, '能定位 undoUseCandidate 方法体')
  assert.match(fnUndo[0], /v21\.useCandidate\(/, '撤销调用 useCandidate')
  assert.match(fnUndo[0], /const previousUrl = this\.undoStrip\.previousUrl/, '撤销取横条暂存的旧指针 previous url')
  assert.match(fnUndo[0], /imageUrl: previousUrl/, '撤销传回旧指针作为 imageUrl')
  // 换图后暂存旧指针 + 5 秒自动收起
  const fnApply = src.match(/applyCurrentResult\(result\) \{[\s\S]*?\n    \},\n/)
  assert.ok(fnApply, '存在换图后统一同步方法 applyCurrentResult')
  assert.match(fnApply[0], /previousUrl: result\.previous\.imageUrl/, '从响应 previous 字段取旧指针')
  assert.match(fnApply[0], /5000/, '横条 5 秒后自动收起')
})

test('P0-6 人物状态卡：状态条渲染 states/默认标记/状态图缩略 + 生成该状态候选入口', () => {
  const src = view()
  assert.match(src, /v-for="s in detail\?\.states \|\| \[\]"/, '状态条遍历 states 渲染')
  assert.match(src, /s\.isDefault/, '状态卡有默认标记')
  assert.match(src, /默认/, '默认标记文案')
  assert.match(src, /v-if="s\.imageUrl"/, '状态卡展示该状态当前图缩略（无图占位）')
  assert.match(src, /@click\.stop="openStateGenSheet\(s\)"/, '每状态有「生成该状态候选」入口（.stop 防冒泡到状态卡应用）')
  assert.match(src, /生成该状态候选/, '入口文案「生成该状态候选」')
  const fnOpen = src.match(/openStateGenSheet\(s\) \{[\s\S]*?\n    \},\n/)
  assert.ok(fnOpen, '能定位 openStateGenSheet 方法体')
  assert.match(fnOpen[0], /s\.name/, '打开生成 Sheet 时 prompt 注入状态名')
  assert.match(fnOpen[0], /genStateId = s\.id/, '记录待生成状态 id')
  // 确认生成透传 stateId（后端提示词注入状态名）
  const fnGen = src.match(/async confirmGenerate\(\)[\s\S]*?\n    \},\n/)
  assert.match(fnGen[0], /stateId: this\.genStateId/, 'confirmGenerate 透传 stateId')
  // 点击状态卡把该状态图应用为人物当前图（useCandidate 传状态 imageUrl）
  assert.match(src, /@click="applyStateToCurrent\(s\)"/, '状态卡点击应用为人物当前图')
  const fnState = src.match(/async applyStateToCurrent\(s\)[\s\S]*?\n    \},\n/)
  assert.ok(fnState, '能定位 applyStateToCurrent 方法体')
  assert.match(fnState[0], /v21\.useCandidate\(/, '状态卡应用调用 useCandidate')
  assert.match(fnState[0], /imageUrl: s\.imageUrl/, 'useCandidate 传该状态 imageUrl')
})

test('概览标签：资料编辑保存调用 PATCH 端点，保存中/失败在标签内呈现', () => {
  const src = view()
  assert.match(src, /@click="saveProfile"/, '概览标签有保存按钮')
  const fn = src.match(/async saveProfile\(\)[\s\S]*?\n    \},\n/)
  assert.ok(fn, '能定位 saveProfile 方法体')
  assert.match(fn[0], /v21\.updateAsset\(/, '保存调用 PATCH 封装 updateAsset')
  assert.match(fn[0], /this\.editForm\.name/, '提交编辑中的名称')
  assert.match(fn[0], /this\.editForm\.description/, '提交编辑中的描述')
  assert.match(fn[0], /savingProfile/, '保存中状态（保存中…）')
  assert.match(fn[0], /profileError = e\.message/, '失败呈现在标签内（profileError）')
  // api 封装补 PATCH 方法
  const api = read('src/v21/api.js')
  assert.match(api, /updateAsset: \(type, assetId, body\) => patch\(`\/assets\/\$\{type\}\/\$\{assetId\}`, body\)/, 'api.js 提供 updateAsset PATCH 封装')
})

// ---- Task 3.2（P0-9）：人物音色管理 ----

test('P0-9 人物音色区：版本与候选标签内渲染音色区/试听元素/设置入口，仅人物显示', () => {
  const src = view()
  const versions = src.match(/<!-- 标签 2：版本与候选[\s\S]*?(?=<!-- 标签 3)/)
  assert.ok(versions, '定位版本与候选标签面板')
  assert.match(versions[0], /人物音色/, '版本与候选标签内存在「人物音色」区')
  assert.match(versions[0], /detail\?\.assetType === 'character'/, '音色区仅人物素材显示')
  assert.match(src, /<audio[^>]*controls/, '存在试听元素（audio controls）')
  assert.match(src, /@click="openVoiceSheet"/, '存在「设置音色」入口')
  assert.match(src, /设置音色/, '设置音色文案')
})

test('P0-9 音色设置弹窗：上传/手动两个来源 tab + 提取置灰 + 保存走 PATCH voice', () => {
  const src = view()
  assert.match(src, /voiceSheetOpen/, '存在音色设置弹窗状态位 voiceSheetOpen')
  assert.match(src, /voiceTab === 'upload'/, '来源 tab：上传音频')
  assert.match(src, /voiceTab === 'manual'/, '来源 tab：手动填写')
  assert.match(src, /type="file"/, '上传 tab 有文件选择')
  assert.match(src, /accept="audio\/\*"/, '文件选择仅收音频')
  // 「从音视频提取」保持禁用态（P2 Provider 依赖），不得假装可用
  assert.match(src, /从音视频提取/, '存在「从音视频提取」按钮')
  assert.match(src, /依赖语音 Provider，暂未开放/, '置灰按钮旁有禁用原因提示')
  assert.match(src, /<button[^>]*disabled[^>]*>[^<]*从音视频提取/, '提取按钮必须 disabled 置灰')
  // 保存：PATCH voice，成功提示、失败呈现在弹窗体内
  const fnSave = src.match(/async saveVoice\(\)[\s\S]*?\n    \},\n/)
  assert.ok(fnSave, '能定位 saveVoice 方法体')
  assert.match(fnSave[0], /v21\.updateAsset\(/, '保存调 PATCH 封装 updateAsset')
  assert.match(fnSave[0], /\{ voice \}/, 'PATCH 提交 voice 对象')
  assert.match(fnSave[0], /音色已更新/, '成功提示「音色已更新」')
  assert.match(fnSave[0], /this\.voiceError = /, '失败写弹窗内错误行 voiceError')
})

test('P0-9 音色上传走 /api/v1/upload/audio，成功后回填 url + 文件名', () => {
  const api = read('src/v21/api.js')
  assert.match(api, /uploadAudio/, 'api.js 提供 uploadAudio 封装')
  assert.match(api, /\/api\/v1\/upload\/audio/, '上传端点为 /api/v1/upload/audio')
  const src = view()
  const fnUp = src.match(/async uploadVoiceFile\(event\)[\s\S]*?\n    \},\n/)
  assert.ok(fnUp, '能定位 uploadVoiceFile 方法体')
  assert.match(fnUp[0], /v21\.uploadAudio\(/, '上传走 api 封装')
  assert.match(fnUp[0], /filename/, '成功后回填文件名')
  assert.match(fnUp[0], /voiceForm\.url = /, '成功后回填 url')
  assert.match(fnUp[0], /this\.voiceError = /, '上传失败呈现在弹窗内错误行')
})

test('P0-9 清除音色确认先行：确认弹窗后才 PATCH voice=null', () => {
  const src = view()
  assert.match(src, /@click="askClearVoice"/, '清除按钮绑定确认入口 askClearVoice')
  assert.match(src, /voiceClearOpen/, '存在清除确认弹窗状态位 voiceClearOpen')
  const fn = src.match(/async confirmClearVoice\(\)[\s\S]*?\n    \},\n/)
  assert.ok(fn, '能定位 confirmClearVoice 方法体')
  assert.match(fn[0], /voice: null/, '确认后 PATCH voice=null 清除')
  assert.match(fn[0], /this\.voiceClearError = /, '失败呈现在弹窗内错误行')
})

test('P0-9 集级联动提示：音色区含「本集使用音色在单集设定中另行选择」说明', () => {
  const src = view()
  assert.match(src, /本集使用音色在单集设定中另行选择/, 'muted 联动提示文案')
})

test('使用位置/生成记录标签：渲染对应数据源字段、用户语言与空态', () => {
  const src = view()
  // 使用位置
  assert.match(src, /v-for="u in detail\?\.usage \|\| \[\]"/, 'usage 列表渲染')
  assert.match(src, /u\.episodeNumber/, '使用位置展示集号')
  for (const label of ['出演', '场景', '道具', '本集引用']) {
    assert.match(src, new RegExp(label), `kind 用户语言含「${label}」`)
  }
  assert.match(src, /\/script`/, '每项 router-link 到该集 script 阶段')
  assert.match(src, /尚未被任何剧集使用/, 'usage 空态说明')
  // 生成记录
  assert.match(src, /v-for="r in detail\?\.records \|\| \[\]"/, 'records 列表渲染')
  assert.match(src, /r\.prompt/, '生成记录展示提示词')
  assert.match(src, /r\.provider/, '生成记录展示通道')
  assert.match(src, /还没有生成或上传记录/, 'records 空态说明')
})
