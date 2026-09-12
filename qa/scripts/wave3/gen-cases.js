// Wave3 用例 YAML 生成器：按执行结果生成 qa/cases/<MODULE>/TC-*.yml（schema 同 wave1/2）
const fs = require('fs');
const path = require('path');

const ROOT = 'E:/project/LocalMiniDrama';

// [module, id, title, priority, level, reqIds, purpose, file, testId, notes]
const CASES = [
  // ASSET（feature-inventory §4）
  ['ASSET', 'TC-ASSET-001', '角色 CRUD 闭环：批量保存创建→详情→更新→删除→读取 404', 'P0', 'system', ['INV-4.1'], 'functional', 'qa/scripts/wave3/run-asset.js', 'ASSET_001_character_crud', ''],
  ['ASSET', 'TC-ASSET-002', '角色列表排序：按 sort_order,name；sort_order 无任何 API 写入口（观察项）', 'P1', 'system', ['INV-4.1'], 'functional', 'qa/scripts/wave3/run-asset.js', 'ASSET_002_character_sort', '观察项：排序能力不可达（创建恒 sort_order=0，updateCharacter 白名单无 sort_order），与 inventory COMPLETE 标注有出入'],
  ['ASSET', 'TC-ASSET-003', '角色主图上传（真实 PNG multipart）：文件落盘、URL 可访问、image_url 绑定', 'P0', 'system', ['INV-4.3'], 'functional', 'qa/scripts/wave3/run-asset.js', 'ASSET_003_upload_main_image', '执行失败→BUG-L3-301：上传响应 local_path 未持久化'],
  ['ASSET', 'TC-ASSET-004', '主图绑定：PUT /characters/:id/image 换图生效；仅传 ref_image 不清空主图', 'P1', 'system', ['INV-4.3'], 'functional', 'qa/scripts/wave3/run-asset.js', 'ASSET_004_image_binding', ''],
  ['ASSET', 'TC-ASSET-005', '角色额外图片：extra_images JSON 落库并经项目角色列表回读', 'P1', 'system', ['INV-4.4'], 'functional', 'qa/scripts/wave3/run-asset.js', 'ASSET_005_extra_images', ''],
  ['ASSET', 'TC-ASSET-006', '角色状态变体 CRUD：创建（默认/自定义 source_key）→列表→更新→同 source_key 409→删除', 'P0', 'system', ['INV-4.7'], 'functional', 'qa/scripts/wave3/run-asset.js', 'ASSET_006_variant_crud', ''],
  ['ASSET', 'TC-ASSET-007', '默认变体互斥：is_default 切换后同人物仅一个默认', 'P1', 'system', ['INV-4.7'], 'functional', 'qa/scripts/wave3/run-asset.js', 'ASSET_007_default_variant_exclusive', ''],
  ['ASSET', 'TC-ASSET-008', '场景 CRUD：创建（地点/时间/氛围/描述）→详情→更新→删除→404', 'P0', 'system', ['INV-4.10'], 'functional', 'qa/scripts/wave3/run-asset.js', 'ASSET_008_scene_crud', ''],
  ['ASSET', 'TC-ASSET-009', '道具 CRUD：缺参 400→创建→更新→删除→404', 'P0', 'system', ['INV-4.12'], 'functional', 'qa/scripts/wave3/run-asset.js', 'ASSET_009_prop_crud', ''],
  ['ASSET', 'TC-ASSET-010', '角色描述/提示词润色（真实 DeepSeek）：polished_prompt 生成并落库回读', 'P0', 'system', ['INV-4.2'], 'functional', 'qa/scripts/wave3/run-asset.js', 'ASSET_010_polish_real', '本 wave ASSET 流唯一在案真实 DeepSeek 调用（12.2s）'],
  ['ASSET', 'TC-ASSET-011', '润色异常路径：不存在角色 404、不存在场景 404（均不触发模型调用）', 'P1', 'system', ['INV-4.2'], 'exception', 'qa/scripts/wave3/run-asset.js', 'ASSET_011_polish_error_paths', ''],
  ['ASSET', 'TC-ASSET-012', '公共角色素材库：角色入库→库列表可见→从库应用主图到另一角色（导入项目）', 'P1', 'system', ['INV-4.13'], 'functional', 'qa/scripts/wave3/run-asset.js', 'ASSET_012_character_library', '数据流断言：库条目→目标角色主图'],
  ['ASSET', 'TC-ASSET-013', '公共场景素材库：场景入库→库列表可见→字段一致', 'P1', 'system', ['INV-4.14'], 'functional', 'qa/scripts/wave3/run-asset.js', 'ASSET_013_scene_library', ''],
  ['ASSET', 'TC-ASSET-014', '公共道具素材库：本剧库与公共素材库双入口入库→prop_libraries 可见', 'P1', 'system', ['INV-4.15'], 'functional', 'qa/scripts/wave3/run-asset.js', 'ASSET_014_prop_library', '入库前置：道具需有形象图片'],
  ['ASSET', 'TC-ASSET-015', '素材库直连 CRUD：POST/PUT/DELETE /character-library 全链路', 'P2', 'integration', ['INV-4.13'], 'functional', 'qa/scripts/wave3/run-asset.js', 'ASSET_015_library_direct_crud', ''],
  ['ASSET', 'TC-ASSET-016', '角色四视图接口契约：风格覆盖拒绝 400、已润色角色受理 200、任务记录落库', 'P2', 'system', ['INV-4.5'], 'functional', 'qa/scripts/wave3/run-asset.js', 'ASSET_016_four_view_contract', '有 polished_prompt 时不触发文本模型；图像通道 18080 离线为真实外部状态，成功路径由 E2E 阶段覆盖'],
  ['ASSET', 'TC-ASSET-017', '角色批量生成图像接口契约：空列表 400、超上限 400、合法列表受理 count 一致', 'P1', 'system', ['INV-4.3'], 'exception', 'qa/scripts/wave3/run-asset.js', 'ASSET_017_batch_contract', ''],
  ['ASSET', 'TC-ASSET-018', '前端 addToTeamLibrary 声明路由后端不存在（BROKEN 陈旧契约按真实行为验证）', 'P2', 'system', ['INV-4.17'], 'regression', 'qa/scripts/wave3/run-asset.js', 'ASSET_018_stale_team_library', '观察项：与 inventory BROKEN 标注一致'],
  // EPSET（v2.1 验收矩阵 A-A01/A-A03，docs/superpowers/specs/2026-09-08-production-studio-v2.1-e2e-acceptance-matrix.md）
  ['EPSET', 'TC-EPSET-001', '本集引用投影：已确认剧本按名匹配项目人物并入投影（QA-006 修复路径），未引用人物不出现', 'P0', 'system', ['A-A01'], 'functional', 'qa/scripts/wave3/run-epset.js', 'EPSET_001_projection_name_match', 'episodeAssetsService.js:74-105（QA-006 注释处）'],
  ['EPSET', 'TC-EPSET-002', '本集引用投影：episode_id 场景入 scenes Tab、storyboard_props 绑定道具入 props Tab', 'P1', 'system', ['A-A01'], 'functional', 'qa/scripts/wave3/run-epset.js', 'EPSET_002_projection_scene_prop', ''],
  ['EPSET', 'TC-EPSET-003', '就绪状态流转：script-unapproved → needs-attention（缺图）→ ready（全部必需项有图）', 'P0', 'system', ['A-A01'], 'functional', 'qa/scripts/wave3/run-epset.js', 'EPSET_003_readiness_flow', ''],
  ['EPSET', 'TC-EPSET-004', '进入分镜：needs-attention 放行但不写快照；ready 时事务写入 active 快照与指纹', 'P0', 'system', ['A-A01'], 'functional', 'qa/scripts/wave3/run-epset.js', 'EPSET_004_enter_storyboard_gate', 'GATE-201；DB episode_asset_set_snapshots 断言'],
  ['EPSET', 'TC-EPSET-005', '媒体生成守卫：未 ready 时 enabled=false 并给恢复入口；ready 后 enabled=true', 'P1', 'system', ['A-A01'], 'functional', 'qa/scripts/wave3/run-epset.js', 'EPSET_005_media_guard', ''],
  ['EPSET', 'TC-EPSET-006', '音色抽屉：selection 保存音色指针→投影 voice 回显→清除置空', 'P1', 'system', ['A-A03'], 'functional', 'qa/scripts/wave3/run-epset.js', 'EPSET_006_voice_drawer', 'B4 voice_json 列'],
  ['EPSET', 'TC-EPSET-007', '本集选择指针：stateId+mediaVersionId 保存→投影覆盖默认值（状态/版本语义）', 'P1', 'system', ['A-A01'], 'functional', 'qa/scripts/wave3/run-epset.js', 'EPSET_007_selection_pointer', ''],
  ['EPSET', 'TC-EPSET-008', '边界：不存在剧集的投影/进入分镜/守卫均 404', 'P2', 'system', ['A-A01'], 'exception', 'qa/scripts/wave3/run-epset.js', 'EPSET_008_not_found', ''],
  ['EPSET', 'TC-EPSET-009', '软删角色退出本集投影：删除后按名匹配不再命中', 'P1', 'system', ['A-A01'], 'functional', 'qa/scripts/wave3/run-epset.js', 'EPSET_009_deleted_character_exits', ''],
  // STORYBOARD（feature-inventory §5）
  ['STORYBOARD', 'TC-STORYBOARD-001', '从剧本结构创建分镜（场次→镜头+时段）：镜头数=场次数、标题取场次标题、每镜 6 秒时段', 'P0', 'system', ['INV-5.1'], 'functional', 'qa/scripts/wave3/run-storyboard.js', 'STORYBOARD_001_create_from_script', 'v2.1 非LLM结构创建；story_scenes 数据流断言'],
  ['STORYBOARD', 'TC-STORYBOARD-002', '结构创建前置：无已确认剧本 409 SCRIPT_NOT_APPROVED', 'P1', 'system', ['INV-5.1'], 'exception', 'qa/scripts/wave3/run-storyboard.js', 'STORYBOARD_002_requires_approved', ''],
  ['STORYBOARD', 'TC-STORYBOARD-003', '结构 diff：剧本新增场次后 preview 标记 added；apply-structure-diff 落为新镜头', 'P1', 'system', ['INV-5.1'], 'functional', 'qa/scripts/wave3/run-storyboard.js', 'STORYBOARD_003_structure_diff', ''],
  ['STORYBOARD', 'TC-STORYBOARD-004', '手动新增分镜：全字段创建→v1 列表按镜号有序回读', 'P0', 'system', ['INV-5.2'], 'functional', 'qa/scripts/wave3/run-storyboard.js', 'STORYBOARD_004_manual_create', '观察项：API 不自动编号，漏传 storyboard_number 默认 0'],
  ['STORYBOARD', 'TC-STORYBOARD-005', '分镜插入/删除：insert-before 后续镜号整体后移；删除软删且列表不再可见', 'P0', 'system', ['INV-5.2'], 'functional', 'qa/scripts/wave3/run-storyboard.js', 'STORYBOARD_005_insert_delete', ''],
  ['STORYBOARD', 'TC-STORYBOARD-006', '镜号排序完整性：多次插入/删除后镜号无重复且按序排列', 'P1', 'system', ['INV-5.2'], 'functional', 'qa/scripts/wave3/run-storyboard.js', 'STORYBOARD_006_number_integrity', ''],
  ['STORYBOARD', 'TC-STORYBOARD-007', '行内编辑全字段：旁白/动作/对白/景别/机位/运镜/氛围/情绪/转场/提示词 PUT 回读一致', 'P0', 'system', ['INV-5.3'], 'functional', 'qa/scripts/wave3/run-storyboard.js', 'STORYBOARD_007_inline_edit', 'transition 按 AV 契约规范化为结构化 JSON'],
  ['STORYBOARD', 'TC-STORYBOARD-008', '绑定角色：character_ids 写入 JSON 投影（权威事实源）；storyboard_characters 同步异常记录为观察', 'P1', 'system', ['INV-5.4', 'INV-15.2'], 'functional', 'qa/scripts/wave3/run-storyboard.js', 'STORYBOARD_008_bind_characters', '观察项：syncStoryboardCharacterLinks 写库条目 id/跳过真实角色（表 LEGACY，与 §15 一致）'],
  ['STORYBOARD', 'TC-STORYBOARD-009', '绑定角色状态变体：character_variant_links 落 storyboard_character_variants 并被投影回读', 'P1', 'system', ['INV-5.4'], 'functional', 'qa/scripts/wave3/run-storyboard.js', 'STORYBOARD_009_bind_variants', ''],
  ['STORYBOARD', 'TC-STORYBOARD-010', '绑定道具：prop_ids 整表替换语义（创建路径与 POST /storyboards/:id/props 一致）', 'P1', 'system', ['INV-5.4'], 'functional', 'qa/scripts/wave3/run-storyboard.js', 'STORYBOARD_010_bind_props', ''],
  ['STORYBOARD', 'TC-STORYBOARD-011', '绑定场景：scene_id 持久化，删除场景时分镜 scene_id 置空（不悬挂）', 'P1', 'system', ['INV-5.4'], 'functional', 'qa/scripts/wave3/run-storyboard.js', 'STORYBOARD_011_bind_scene', ''],
  ['STORYBOARD', 'TC-STORYBOARD-012', '引用槽位：场景+角色状态按序解析为槽位，指纹稳定可复核', 'P1', 'system', ['INV-5.5'], 'functional', 'qa/scripts/wave3/run-storyboard.js', 'STORYBOARD_012_reference_slots', '变体图需先经 update 写入（create 不收 image_url）'],
  ['STORYBOARD', 'TC-STORYBOARD-013', '首/尾帧提示词：手动保存 first/last → 列表回读；非法 frame_type 400', 'P1', 'system', ['INV-5.6'], 'functional', 'qa/scripts/wave3/run-storyboard.js', 'STORYBOARD_013_frame_prompts', '仅手存路径；frame-prompt 异步生成为 LLM 端点，按预算不真实调用'],
  ['STORYBOARD', 'TC-STORYBOARD-014', '尾帧衔接契约：缺参 400；无已完成视频 400（成功路径依赖视频生成，属 VIDEO/E2E 范围）', 'P1', 'system', ['INV-5.6'], 'exception', 'qa/scripts/wave3/run-storyboard.js', 'STORYBOARD_014_tail_frame_contract', ''],
  ['STORYBOARD', 'TC-STORYBOARD-015', '从剧集生成分镜（真实 DeepSeek 异步）：任务受理→完成→结构化镜头落库', 'P0', 'system', ['INV-5.1'], 'functional', 'qa/scripts/wave3/run-storyboard.js', 'STORYBOARD_015_generate_real', '本 wave STORYBOARD 流唯一在案真实 DeepSeek 调用（25.1s，3 镜）'],
  ['STORYBOARD', 'TC-STORYBOARD-016', '生成前置校验（零模型调用）：不存在剧集与空剧本均在任务创建前拒绝', 'P1', 'system', ['INV-5.1'], 'boundary', 'qa/scripts/wave3/run-storyboard.js', 'STORYBOARD_016_generate_preconditions', '观察项：业务前置错误以 500 返回（语义应为 400）'],
  ['STORYBOARD', 'TC-STORYBOARD-017', 'v2 分镜列表：shots 与 completion 完成度结构', 'P1', 'system', ['INV-5.1'], 'functional', 'qa/scripts/wave3/run-storyboard.js', 'STORYBOARD_017_v2_list_completion', ''],
  ['STORYBOARD', 'TC-STORYBOARD-018', 'v2 镜头详情与段编辑：segments 读写（visual/dialogue/sound）回读一致', 'P1', 'integration', ['INV-5.3'], 'functional', 'qa/scripts/wave3/run-storyboard.js', 'STORYBOARD_018_v2_segment_edit', ''],
  ['STORYBOARD', 'TC-STORYBOARD-019', '分镜 Excel 导出：真实前端导出工具以 API 实时数据构建 24 列工作表并落盘', 'P0', 'integration', ['INV-5.11'], 'functional', 'qa/scripts/wave3/run-storyboard.js', 'STORYBOARD_019_excel_export', '产物 qa/run/wave3-artifacts/TC-STORYBOARD-019-storyboard-sheet.xls；DOM 下载步骤浏览器专属'],
  ['STORYBOARD', 'TC-STORYBOARD-020', 'SRT 导出：无成片版本 API 如实拒绝；真实 buildSrt 以本集镜头数据产出合法 SRT 产物', 'P0', 'integration', ['INV-5.12'], 'functional', 'qa/scripts/wave3/run-storyboard.js', 'STORYBOARD_020_srt_export', '产物 qa/run/wave3-artifacts/TC-STORYBOARD-020-episode.srt；SRT 成功导出的成片前置由 AUDIO/VIDEO 波次覆盖'],
  ['STORYBOARD', 'TC-STORYBOARD-021', '批量推理接口：按镜头字段推断运动/光效/景深并回填；overwrite=false 不覆盖已有值', 'P1', 'system', ['INV-5.9'], 'functional', 'qa/scripts/wave3/run-storyboard.js', 'STORYBOARD_021_batch_infer', '摄影参数推断（规则引擎），非图像推理'],
  ['STORYBOARD', 'TC-STORYBOARD-022', '分镜 404 契约：getOne/PUT/DELETE/insert-before 不存在均 404', 'P2', 'system', ['INV-5.2'], 'exception', 'qa/scripts/wave3/run-storyboard.js', 'STORYBOARD_022_not_found', ''],
  // MEDIA（feature-inventory §13）
  ['MEDIA', 'TC-MEDIA-001', '通用资产列表/详情：创建资产→列表可见→详情回读→/static 真实文件预览', 'P0', 'system', ['INV-13.1'], 'functional', 'qa/scripts/wave3/run-media.js', 'MEDIA_001_list_detail_preview', ''],
  ['MEDIA', 'TC-MEDIA-002', '类型过滤：type=image / type=video 各自命中；音频类型空集', 'P1', 'system', ['INV-13.2'], 'functional', 'qa/scripts/wave3/run-media.js', 'MEDIA_002_type_filter', ''],
  ['MEDIA', 'TC-MEDIA-003', '关键词搜索：keyword 参数被服务端忽略、结果不过滤（与 inventory BROKEN 标注一致）', 'P0', 'system', ['INV-13.3'], 'regression', 'qa/scripts/wave3/run-media.js', 'MEDIA_003_keyword_search_broken', '观察项：BROKEN 根因在服务端不消费 keyword（inventory 归因前端转发，净效果相同）'],
  ['MEDIA', 'TC-MEDIA-004', '媒体上传：/upload/image 仅存文件不写 assets 表，刷新后媒体库不可见（与 inventory BROKEN 一致）', 'P0', 'system', ['INV-13.4'], 'regression', 'qa/scripts/wave3/run-media.js', 'MEDIA_004_upload_not_in_assets', '观察项：routes/upload.js 无 assets INSERT'],
  ['MEDIA', 'TC-MEDIA-005', '资产字段更新：description/thumbnail_url/is_favorite 更新 500（列不存在）；name/url 更新正常', 'P0', 'system', ['INV-13.7'], 'regression', 'qa/scripts/wave3/run-media.js', 'MEDIA_005_update_sql_fail', '观察项：service 白名单与实库 schema 不一致（data-model §2 已记录）'],
  ['MEDIA', 'TC-MEDIA-006', '删除：软删后列表不可见；物理文件仍保留（未同步回收，与 inventory PARTIAL 一致）', 'P1', 'system', ['INV-13.5'], 'functional', 'qa/scripts/wave3/run-media.js', 'MEDIA_006_soft_delete_file_kept', ''],
  ['MEDIA', 'TC-MEDIA-007', '批量删除：后端无批量端点，逐条 DELETE（前端循环调用）+ 不存在 id 404', 'P1', 'system', ['INV-13.5'], 'functional', 'qa/scripts/wave3/run-media.js', 'MEDIA_007_batch_delete_contract', '观察项：前端循环单删无事务性'],
  ['MEDIA', 'TC-MEDIA-008', '分页：page_size 生效、翻页不重不漏、超范围页为空', 'P1', 'system', ['INV-13.1'], 'boundary', 'qa/scripts/wave3/run-media.js', 'MEDIA_008_pagination', '响应分页元数据位于 data.pagination'],
  ['MEDIA', 'TC-MEDIA-009', '项目隔离：drama_id 过滤互不可见', 'P1', 'system', ['INV-13.1'], 'functional', 'qa/scripts/wave3/run-media.js', 'MEDIA_009_drama_isolation', ''],
  ['MEDIA', 'TC-MEDIA-010', '创建校验：缺 name 落默认「未命名」；不存在的 drama_id 也被接受（无外键约束观察）', 'P2', 'system', ['INV-13.1'], 'boundary', 'qa/scripts/wave3/run-media.js', 'MEDIA_010_create_validation', '孤儿资产行 id 保留供复核（无项目归属，不经项目删除清理）'],
  ['MEDIA', 'TC-MEDIA-011', '上传格式过滤：非图片 MIME 被拒绝（multer fileFilter）', 'P2', 'system', ['INV-13.4'], 'exception', 'qa/scripts/wave3/run-media.js', 'MEDIA_011_mime_filter', '实际以 500 返回（multer 错误走 error 中间件）——拒绝语义成立'],
  ['MEDIA', 'TC-MEDIA-012', '上传存储布局：携带 drama_id 时文件落入 projects/<项目目录>/uploads/ 子目录', 'P1', 'system', ['INV-13.4'], 'functional', 'qa/scripts/wave3/run-media.js', 'MEDIA_012_storage_layout', ''],
  ['MEDIA', 'TC-MEDIA-013', '外部结果导入资产库：image_generations 记录经 /assets/import/image 落入 assets 并在媒体库可见', 'P1', 'system', ['INV-13.6'], 'functional', 'qa/scripts/wave3/run-media.js', 'MEDIA_013_import_from_generation', '数据流断言：生成记录→assets→媒体库可见'],
];

function yml(c, status) {
  const [module, id, title, priority, level, reqIds, purpose, file, testId, notes] = c;
  const noteLine = notes ? `\nnotes: "${notes.replace(/"/g, '\\"')}"` : '\nnotes: ""';
  return `id: ${id}
title: "${title}"
state: active
feature_id: F-${module}
requirement_ids: [${reqIds.join(', ')}]
level: ${level}
purpose: ${purpose}
priority: ${priority}
preconditions:
  - "后端 http://127.0.0.1:5679 运行中（L3 共享环境）"
  - "真实数据约束：不 mock 外部服务；测试数据 QA-L3- 前缀"
test_data:
  prefix: "QA-L3-"
  cleanup: "用例自建项目结束后软删（可复核）；导出产物保留 qa/run/wave3-artifacts/"
steps:
  - "由 qa/scripts/wave3 自动化脚本真实调用 HTTP API 执行（automation.test_id 对应用例块）"
expected:
  - "全部断言通过（状态码/响应结构/DB 副本三层核对；BROKEN/PARTIAL 项按 feature-inventory 文档行为验证并记录观察项）"
assertions:
  - "以脚本内 cs.eq/cs.expect 断言为准，逐条断言写入执行日志 evidence"
automation:
  status: implemented
  framework: node
  file: ${file}
  test_id: ${testId}
targets:
  files: []
  symbols: []
  generated_by: "wave3-designer"
  generated_at: "2026-09-12"
regression_tags: [${module.toLowerCase()}, wave3, l3]${noteLine}
`;
}

let written = 0;
for (const c of CASES) {
  const [module, id] = c;
  const dir = path.join(ROOT, 'qa/cases', module);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, id + '.yml'), yml(c), 'utf8');
  written++;
}
console.log('written', written, 'case ymls');
