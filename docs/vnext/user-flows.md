# LocalMiniDrama VNext User Flows

> 所有流程统一采用 `Trigger → Action → Feedback → State Change → Result`。领域状态名称以 [state-model.md](./state-model.md) 为准。

## 1. 从想法创建项目

| 阶段 | 规格 |
|---|---|
| Trigger | 用户只有故事想法，希望建立可编辑剧本 |
| Action | 在 Start Page 选择“从想法开始”，输入内容、目标集数/风格等必要约束并提交 |
| Feedback | 输入限制、Provider 可用性、生成预检、Job 内联进度和任务入口 |
| State Change | `no_project → project_created → script_job_running → draft_revision_ready / job_failed / unknown` |
| Result | 进入 Script Page，得到可编辑 Draft Revision；不会自动成为 Approved |

失败时保留用户输入和 Job ID。Provider 超时进入 unknown/reconciling，不自动重复提交。

## 2. 导入剧本、小说或剧集包

| 阶段 | 规格 |
|---|---|
| Trigger | 用户已有文本、小说、结构化剧集包或项目 ZIP |
| Action | 选择来源，拖拽/选择文件；系统在 Import Modal 中验证并生成 Preview；用户确认映射 |
| Feedback | 文件、schema 版本、集/场预览、媒体缺失、冲突、将新增/更新/跳过数量 |
| State Change | `file_selected → validating → preview_ready → importing → import_succeeded / partial_success / failed` |
| Result | 创建或更新 Project/Episode；生成 Draft Revision、ImportRecord 和 Provenance |

导入不在预览前写正式实体。Partial Success 保留成功部分和可下载报告，失败项可修复后重试。

## 3. 编辑、保存和批准剧本

| 阶段 | 规格 |
|---|---|
| Trigger | 用户进入 Script Page 或编辑已批准内容 |
| Action | 按 Story Scene 定位并编辑；保存草稿；点击“批准剧本”查看 Diff/影响后确认 |
| Feedback | `dirty/saving/saved/save_failed`、当前 Approved 标识、Diff、受影响资产/Shot 数和 Gate 说明 |
| State Change | `draft_clean → draft_dirty → draft_saved → approval_review → approved`；已批准后编辑为 `draft_diverged` |
| Result | Approved Revision 成为下游新基线；旧 Revision 可追溯 |

“保存”不导航、不解锁下游；“批准”才改变基线。批准 Dialog 不允许同时修改正文。

## 4. 批准新剧本并处理下游失效

| 阶段 | 规格 |
|---|---|
| Trigger | Episode 已有资产、Shot 或 Candidate，用户准备批准修改后的剧本 |
| Action | 打开 Approval Impact，查看新增/删除/变化 Story Scene 与依赖；确认批准 |
| Feedback | 影响分层：blocking、stale、unaffected；提供“批准后查看受影响项” |
| State Change | 新 Revision `approved`；旧版 `superseded`；依赖产生 `InvalidationRecord` |
| Result | 旧结果继续可见但带 stale reason；用户可只重新提取/编译/生成受影响项 |

系统不得自动删除资产、分镜或媒体，也不得把 stale 候选继续标为“当前有效”。

## 5. 提取或重新提取资产

| 阶段 | 规格 |
|---|---|
| Trigger | Approved Script 存在，资产为空或剧本已变化 |
| Action | 点击提取；完成后打开 Merge Preview，逐类确认新增、建议更新、冲突、保留、疑似删除 |
| Feedback | Job 进度、提取来源 Revision、字段级差异、镜头使用数、人工修改保护提示 |
| State Change | `assets_empty/stale → extracting → merge_preview → applied / partial_success` |
| Result | 资产身份更新，人工内容和已绑定对象按决策保留；记录来源与映射 |

默认规则：不覆盖人工字段、不删除已引用资产、不自动选择生成图片。

## 6. 生成、上传并选用资产形象

| 阶段 | 规格 |
|---|---|
| Trigger | Asset/Variant 缺少主形象或用户需要新版本 |
| Action | 打开 Asset Drawer；选择生成或上传；生成时选择 Provider/模型/参考/规格并预检；查看 Candidate 后选用 |
| Feedback | Capability、引用状态、估算成本、Job 状态、缩略图、来源、失败原因和结果落点 |
| State Change | `no_candidate → validating → running → candidate_ready / failed / unknown → selected` |
| Result | Variant 获得 Selected Appearance；旧 Candidate 和使用历史保留 |

上传与生成同级。关闭 Drawer 后 Job 继续运行，卡片显示内联状态。

## 7. 创建和绑定 Voice Profile

| 阶段 | 规格 |
|---|---|
| Trigger | Character 有对白但未绑定声音，或需要新声音版本 |
| Action | 在 Character Drawer 打开 Voice Modal；选择预设、设计、上传或提取；试听 Candidate；点击绑定 |
| Feedback | 来源、许可/认证、试听进度、Provider、成本、历史和当前选中态 |
| State Change | `voice_unset → candidate_generating/available → previewing → voice_bound` |
| Result | Character/Variant 绑定 Voice Profile；Shot 默认继承但可覆盖 |

试听不改变绑定；绑定才是业务状态变更。

## 8. 应用 StyleSpec

| 阶段 | 规格 |
|---|---|
| Trigger | Project 尚无风格，或用户希望更换/局部覆盖 |
| Action | 打开 Style Selector Modal，筛选、预览；选择后查看影响并应用 |
| Feedback | 缩略图、规范摘要、推荐/兼容 Provider、继承位置、stale 影响数 |
| State Change | `style_unset → selection_pending → applied`；已有依赖时产生 invalidation |
| Result | Project/Asset/Shot 创建 StyleBinding；历史 Job 保留旧 Style Snapshot |

点击风格卡只 Selected，不立即应用。

## 9. 建立或导入分镜

| 阶段 | 规格 |
|---|---|
| Trigger | Approved Script 已存在，用户需要 Shot 列表 |
| Action | 选择 AI 提取或文件导入；预览 Story Scene、Shot、时长和字段映射；确认建立 Timeline Draft |
| Feedback | 镜头数、预计总时长、短镜合并建议、缺失字段、新增/更新/跳过 |
| State Change | `shots_empty → extracting/importing → preview_ready → timeline_draft_ready / partial_success` |
| Result | 生成稳定 Shot 身份和初始 TimelineRevision；不自动发起媒体生成 |

自动合并建议必须可审查，不能静默改写对白、剧情或音效。

## 10. 编辑 Shot Package

| 阶段 | 规格 |
|---|---|
| Trigger | 用户在 Shot Rail 选择镜头 |
| Action | Inspector 绑定资产/Variant/声音/首尾帧；Editor 修改时长、分时码、镜头和提示词；保存 |
| Feedback | 当前镜头高亮、dirty 状态、引用芯片、missing/stale/incompatible、Capability 字段状态 |
| State Change | `shot_selected → revision_dirty → validating → shot_ready / blocked / warning` |
| Result | 形成有版本、引用和依赖指纹的 ShotRevision，可供生成 |

切 Shot 前自动保存安全草稿；验证失败不丢输入。`text-fallback` 需要显式接受。

## 11. 单镜生成、取消和重试

| 阶段 | 规格 |
|---|---|
| Trigger | Shot Gate 为 allow/allow_with_warning |
| Action | 用户检查 Snapshot/成本后生成；可请求取消；失败后选择复用原快照或当前配置重编译 |
| Feedback | validating/queued/running、Provider task id、耗时、成本、取消确认、错误阶段和恢复动作 |
| State Change | `ready → validating → queued → running → candidate_ready / failed / cancel_requested / unknown → reconciling` |
| Result | 成功产生 Candidate；失败/未知保留 Job 与输入；重试形成新 Attempt 或新 Job |

前端超时只改变连接反馈，不改变服务端 Job 事实。

## 12. 批量生成资产或镜头

| 阶段 | 规格 |
|---|---|
| Trigger | 多个对象缺失、stale 或失败 |
| Action | 进入多选，选择当前筛选/全部明确范围；打开 Batch Modal；设置跳过、Provider、并发和成本后提交 |
| Feedback | 已选数、筛选外选中数、跳过原因、能力冲突、估算、聚合与逐项状态 |
| State Change | `selection → batch_validating → batch_running → succeeded / partial_success / failed / unknown` |
| Result | 子任务独立产出 Candidate；成功立即可用；可仅重试失败/未知项 |

取消批次不等于全部 Provider 已取消；逐项显示确认状态。

## 13. 比较并选用 Candidate

| 阶段 | 规格 |
|---|---|
| Trigger | Asset 或 Shot 有一个以上 Candidate |
| Action | 在 Result/History 比较媒体、来源、参数、质量和成本；点击选用，可填写原因 |
| Feedback | Selected 标记、旧选用版本、依赖影响、成功落点 |
| State Change | `candidate_ready → selected`；替换时创建新 Selection 并保留旧记录 |
| Result | Asset/Shot 当前投影更新；引用该 Selection 的未锁定下游重新评估 |

删除 Candidate 是独立危险动作；被 PictureLock/Delivery 使用时禁止物理删除。

## 14. 刷新或重启后恢复任务

| 阶段 | 规格 |
|---|---|
| Trigger | 应用刷新、Electron 重启、网络恢复或 Provider 曾不可达 |
| Action | Runtime 检查 lease 和 provider task id，对活动/unknown Job 发起对账 |
| Feedback | 对象卡和任务中心显示 reconciling、最后确认时间和手动重查入口 |
| State Change | `queued/running/unknown → reconciling → running/succeeded/failed/cancelled/unknown` |
| Result | UI 恢复实际状态；不会重复创建相同 Job 或把未知误判失败 |

## 15. 重排、插入、删除和合并 Shot

| 阶段 | 规格 |
|---|---|
| Trigger | 节奏或 Provider 时长要求变化 |
| Action | 在 Shot Rail 拖拽/键盘排序，或 Context Menu 插入、删除、合并；保存 Timeline Draft |
| Feedback | 落点、总时长、Capability 上限、影响 Candidate/PictureLock、Undo |
| State Change | `timeline_revision_n → draft_dirty → timeline_revision_n+1`；相关对象产生 stale |
| Result | 新 TimelineRevision 成为当前工作序列；旧锁定版本不变 |

删除默认是从新 Timeline 移除，不立即物理删除 Shot/Artifact。

## 16. 短片审片与 Picture Lock

| 阶段 | 规格 |
|---|---|
| Trigger | 至少部分 Shot 已有 Selected Candidate |
| Action | 在 Film Page 逐镜/连续播放，筛选缺失和 stale；修复后点击创建 Picture Lock |
| Feedback | 完成数、总时长、问题列表、GateDecision、锁定内容摘要 |
| State Change | `shots_in_progress → all_required_selected → lock_review → picture_locked` |
| Result | 冻结 TimelineRevision 与每镜 Selection；用户可基于它创建 Delivery |

Picture Lock 不阻止后续创作，只保证该锁定版本不被未来修改改变。

## 17. 创建 Delivery

| 阶段 | 规格 |
|---|---|
| Trigger | PictureLock 存在 |
| Action | 打开 Delivery Modal，选择音频计划、字幕、水印、分辨率和可选超分；预检后提交 |
| Feedback | 输入锁定版本、预计时长/空间、各后期步骤、Job 进度、错误阶段和输出位置 |
| State Change | `picture_locked → delivery_queued → processing → delivered / delivery_failed / partial_success` |
| Result | 项目 Delivery 区新增独立整集产物；可下载、重试或基于新配置创建另一版本 |

超分失败可保留基础合片并标为 Partial Success，不把整个 Delivery 伪装成零产物失败。

## 18. 配置和测试 Provider

| 阶段 | 规格 |
|---|---|
| Trigger | 用户首次使用某生成类型或更换服务 |
| Action | 在 Settings 创建/编辑配置，密钥写入安全存储；测试连接并读取 Capability |
| Feedback | 掩码密钥、连接/认证/模型/能力分阶段结果、错误建议和最后测试时间 |
| State Change | `unconfigured → configured → testing → available / degraded / unavailable` |
| Result | Provider 可被对应生成表单选择；Capability 有版本并可快照 |

测试不在日志或响应中回显 secret；失败不删除已有配置。

## 19. 项目导出与恢复

| 阶段 | 规格 |
|---|---|
| Trigger | 用户需要备份、迁移或外部协作 |
| Action | 选择导出范围和是否包含媒体/敏感配置；生成版本化包；导入时先验证和 Preview |
| Feedback | manifest 版本、大小、缺失媒体、hash、冲突、结果报告 |
| State Change | `export_requested → packaging → package_ready / failed`；导入沿用 Flow 2 |
| Result | 获得可携带包或恢复项目；默认不包含 Provider secret |

## 20. P2 Canvas 与外部网页生成

### Canvas

Trigger：高级用户切换到 Canvas。Action：查看关系、多选、建工作流组并执行统一命令。Feedback：与标准模式相同的 dirty/Gate/Job 状态。State Change：只更新共享领域对象和版本化 layout。Result：切回标准模式结果一致。

### ChatGPT Web

Trigger：用户选择外部网页通道。Action：环境检查、建立 session、发送快照并捕获结果。Feedback：登录/DOM/浏览器/outbox/attempt 状态。State Change：`ready_to_send → submitted → generating → needs_review / unknown / failed`。Result：回传 Candidate 与 provenance；重复回填幂等。
