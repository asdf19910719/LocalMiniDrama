import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { refKey, identityKeys, findConflictingItem } from '../src/v21/libraryIdentity.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

// ---------- Part A · 来源指纹（与后端 libraryDedup.identityKeys 对齐） ----------

test('refKey：路径引用归一化（/static 前缀、反斜杠、前导斜杠）', () => {
  assert.equal(refKey('/static/uploads/a.png'), 'path:uploads/a.png')
  assert.equal(refKey('uploads/a.png'), 'path:uploads/a.png')
  assert.equal(refKey('\\uploads\\a.png'), 'path:uploads/a.png')
  assert.equal(refKey(''), '')
})

test('refKey：http(s) 与 data: 引用各自成键', () => {
  assert.equal(refKey('https://cdn.example.com/x.png'), 'url:https://cdn.example.com/x.png')
  assert.match(refKey('data:image/png;base64,AAAA'), /^data:/)
})

test('identityKeys：source 键需 source_type 与 source_id 齐备，文件引用各自成键', () => {
  const keys = identityKeys({
    source_type: 'local-import',
    source_id: 'hero.png',
    image_url: '/static/uploads/a.png',
    local_path: null,
  })
  assert.equal(keys.size, 2)
  assert.ok(keys.has('source:local-import:hero.png'))
  assert.ok(keys.has('path:uploads/a.png'))
  assert.equal(identityKeys({ source_type: 'x', source_id: '', image_url: '' }).size, 0)
})

test('findConflictingItem：同 source 命中；仅换 source_id 但同图仍命中（ANY 键语义）；换 source_id 且换图才绕开', () => {
  const existing = [
    { id: 1, source_type: 'local-import', source_id: 'hero.png', image_url: '/static/uploads/a.png', local_path: null },
  ]
  // 同来源：source 键直接命中
  assert.equal(findConflictingItem(existing, {
    source_type: 'local-import', source_id: 'hero.png', image_url: '/static/uploads/b.png',
  }), existing[0])
  // 仅改 source_id、复用同一张图：path 键仍命中 → 副本需连文件引用一起区分
  assert.equal(findConflictingItem(existing, {
    source_type: 'local-import', source_id: 'hero.png-1700000000000', image_url: '/static/uploads/a.png',
  }), existing[0])
  // 改 source_id 且换新文件路径（本地导入重新上传即新路径）：完全绕开
  assert.equal(findConflictingItem(existing, {
    source_type: 'local-import', source_id: 'hero.png-1700000000000', image_url: '/static/uploads/b.png',
  }), null)
})

test('findConflictingItem：不同 source_type 的同名来源不冲突，空引用不误伤', () => {
  const existing = [
    { id: 1, source_type: 'project-asset', source_id: 'character:7', image_url: '', local_path: null },
  ]
  assert.equal(findConflictingItem(existing, {
    source_type: 'local-import', source_id: 'character:7', image_url: '',
  }), null)
  assert.equal(findConflictingItem(existing, {
    source_type: 'project-asset', source_id: 'character:8', image_url: '',
  }), null)
  assert.equal(findConflictingItem(existing, {
    source_type: 'project-asset', source_id: 'character:7', image_url: '',
  }), existing[0])
})

// ---------- Part B · LibraryView 合同断言 ----------

const view = () => read('src/views/productionStudio/LibraryView.vue')

test('① 入口按钮绑定选择器，不再是 comingSoon 占位', () => {
  const src = view()
  assert.match(src, /@click="openAddSelector"/, '「添加到资产库」按钮应绑定 openAddSelector')
  assert.doesNotMatch(src, /comingSoon\('添加到资产库'\)/, '不得保留 comingSoon 占位')
  const open = src.match(/openAddSelector\(\) \{[\s\S]*?\n    \},/)
  assert.ok(open, 'openAddSelector 方法存在')
  assert.match(open[0], /addOpen = true/, '应打开选择器弹窗')
})

test('② 选择器含两条路径卡与取消', () => {
  const src = view()
  assert.match(src, /从本地文件添加/)
  assert.match(src, /从现有项目保存/)
  assert.match(src, /@click="chooseAddPath\('local'\)"/)
  assert.match(src, /@click="chooseAddPath\('project'\)"/)
  assert.match(src, /@click="closeAdd"/, '选择器应有取消/关闭入口')
})

test('③ 本地导入向导三步结构与上传回显', () => {
  const src = view()
  for (const step of [1, 2, 3]) {
    assert.match(src, new RegExp(`localStep === ${step}`), `缺少本地向导第 ${step} 步`)
  }
  // 文件选择必须经上传处理函数（走 /api/v1/upload/image），不得只存本地状态
  assert.match(src, /@change="onLocalFileChange"/)
  const upload = src.match(/onLocalFileChange\([\s\S]*?\) \{[\s\S]*?\n    \},/)
  assert.ok(upload, 'onLocalFileChange 方法存在')
  assert.match(upload[0], /upload\/image/, '应走通用图片上传端点')
  // 上传成功回显缩略与「已上传」，失败有错误行
  assert.match(src, /已上传/)
  assert.match(src, /localForm\.upload\.url/, '上传成功后应回显缩略图')
  assert.match(src, /localUploadError/)
  // 步骤 2 确认入库：未上传时禁用
  const confirmBtn = src.match(/<button[^>]*>确认入库<\/button>/)
  assert.ok(confirmBtn, '确认入库按钮存在')
  assert.match(confirmBtn[0], /:disabled="[^"]*localForm\.upload/, '未上传时应禁用确认入库')
  // 每步可返回上一步
  assert.match(src, /localStep = 1/, '第 2 步应可返回第 1 步')
})

test('④ 两路径确认均最终调用 addToLibrary 且带正确 source_type / source_id', () => {
  const src = view()
  // 本地导入：pending 携带 local-import 来源与上传文件标识，确认走统一入库入口
  const localPending = src.match(/pendingFromLocal\(\) \{[\s\S]*?\n    \},/)
  assert.ok(localPending, 'pendingFromLocal 方法存在')
  assert.match(localPending[0], /source_type: 'local-import'/)
  const localConfirm = src.match(/confirmLocalImport\(\) \{[\s\S]*?\n    \},/)
  assert.ok(localConfirm, 'confirmLocalImport 方法存在')
  assert.match(localConfirm[0], /createLibraryEntry\(pending\)/, '本地确认应走统一入库入口')

  // 从项目保存：pending 携带 project-asset 来源与 <type>:<assetId>
  const projPending = src.match(/pendingFromProject\(\) \{[\s\S]*?\n    \},/)
  assert.ok(projPending, 'pendingFromProject 方法存在')
  assert.match(projPending[0], /source_type: 'project-asset'/)
  assert.match(projPending[0], /assetType\}:\$\{[^}]*\.id\}/, 'source_id 应为 <type>:<assetId>')
  const projConfirm = src.match(/confirmProjectSave\(\) \{[\s\S]*?\n    \},/)
  assert.ok(projConfirm, 'confirmProjectSave 方法存在')
  assert.match(projConfirm[0], /createLibraryEntry\(pending\)/, '项目确认应走统一入库入口')

  // 统一入库入口：真正调用 v21.addToLibrary 并透传 source_type
  const create = src.match(/async createLibraryEntry\(pending\) \{[\s\S]*?\n    \},/)
  assert.ok(create, 'createLibraryEntry 方法存在')
  assert.match(create[0], /v21\.addToLibrary\(pending\.kind/, '应调用 addToLibrary')
  assert.match(create[0], /source_type: pending\.source_type/)

  // 项目路径：选择项目后拉取素材列表（v2 listProjects 默认仅未删除 = 排除归档）
  const chooseProject = src.match(/async chooseProject\(\) \{[\s\S]*?\n    \},/)
  assert.ok(chooseProject, 'chooseProject 方法存在')
  assert.match(chooseProject[0], /listAssets/, '选择项目后应拉取素材列表')
})

test('⑤ 冲突呈现双版本并排 + 使用已有不写入 + 仍创建改 source_id 与名称', () => {
  const src = view()
  // 冲突弹层：现有/待保存并排
  assert.match(src, /库中已有同来源条目|已有同来源条目/, '冲突提示文案')
  assert.match(src, /conflict\.existing/, '应展示现有条目')
  assert.match(src, /conflict\.pending/, '应展示待保存条目')
  // 响应 duplicated 契约：addToLibrary 返回 duplicated 时也进入冲突呈现
  const create = src.match(/async createLibraryEntry\(pending\) \{[\s\S]*?\n    \},/)
  assert.ok(create, 'createLibraryEntry 方法存在')
  assert.match(create[0], /duplicated/, '应处理响应 duplicated 标记')
  assert.match(create[0], /openConflict/, 'duplicated 时应转入冲突呈现')
  // 使用已有条目：不写入
  const useExisting = src.match(/useExistingItem\(\) \{[\s\S]*?\n    \},/)
  assert.ok(useExisting, 'useExistingItem 方法存在')
  assert.doesNotMatch(useExisting[0], /addToLibrary/, '使用已有条目不得再写入')
  assert.match(useExisting[0], /已使用现有条目/)
  // 仍创建独立条目：名称加（副本）可编辑 + source_id 追加时间戳绕开同源判定
  assert.match(src, /conflictName/, '副本名称应可编辑')
  const still = src.match(/stillCreateIndependent\(\) \{[\s\S]*?\n    \},/)
  assert.ok(still, 'stillCreateIndependent 方法存在')
  assert.match(still[0], /（副本）/, '名称应自动加（副本）后缀')
  assert.match(still[0], /Date\.now\(\)/, 'source_id 应追加时间戳绕开同源判定')
  assert.match(still[0], /createLibraryEntry/, '仍创建应再次走入库调用（含 addToLibrary 契约）')
  // 成功后刷新库列表并 toast
  assert.match(src, /已保存到个人资产库/)
  const success = src.match(/finishAddSuccess\(\) \{[\s\S]*?\n    \},/)
  assert.ok(success, 'finishAddSuccess 方法存在')
  assert.match(success[0], /load\(\)/, '成功后应刷新库列表')
})
