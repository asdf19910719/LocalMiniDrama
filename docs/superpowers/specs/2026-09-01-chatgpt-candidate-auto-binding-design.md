# ChatGPT 生图候选自动挂载与自动定稿设计

日期:2026-09-01
状态:待评审
前置:串行队列发送超时对齐与取消机制(`5e8da52`)已落地。

## 背景与问题

ChatGPT 网页渠道的候选图当前采用"抓回→落未归属区→任务置 `needs_review`→抽屉手动点『设为当前图片』"的两步确认流。真实使用(2026-08-31/09-01 批次)暴露的问题:生图成功后项目页对应位置(角色/场景/道具卡片)不显示任何候选,用户必须知道去抽屉逐个点选;多任务批量生成时体验割裂。

同类成熟产品的稳定交互惯例(本设计的依据):

- **P1 即时呈现**:Midjourney/即梦/可灵/画本类工具的生成结果一到达即出现在发起位置,从不需要先去别处确认才能看见。
- **P2 发起时归属已定**:任务属于哪个目标在创建时已确定,候选天然预挂到该目标;选择只是决定"哪张是主图",不是"要不要挂上去"。
- **P3 选择可逆**:定稿只是提升某张为主图,旧图进历史,随时可换。
- **P4 无歧义即定稿**:单候选场景直接设为当前图,人工确认只留给真正的歧义。

本产品抓图归属经过串行队列 + attempt 绑定观察器 + 目标级参考清单加固后,每张抓回的图已确定属于具体任务/目标(P2 成立);剩余的"这张图对不对"应由 P3 的可逆选择兜住,而不是用强制人工确认阻塞展示。

## 目标

1. 候选导入后立即挂载到任务目标,项目页对应位置即时显示。
2. 一个 attempt 的第一张候选自动定稿为主图并完成任务;后续候选追加为可切换项,不抢占主图。
3. 保留全手动模式开关;无法归属的抓取仍走 `needs_review`。
4. 存量 `needs_review` 任务(含 09-01 早上的 3 张已抓回候选)提供一键"采用首选候选"批量恢复。

## 非目标

- 不改变抓取/导入协议(扩展侧零改动)。
- 不做多候选智能排序/质量评分;主图切换始终手动可逆。
- 不改动视频生成链路。

## 交互设计

- 生成完成:目标卡片即时显示新图(自动定稿场景)或候选缩略图(多候选场景);通知从"候选待选择"变为"已生成并挂载到〈目标名〉"(自动定稿)或"N 张候选已挂载,点击选择"(手动模式/多候选)。
- 抽屉:任务完成后仍可打开候选列表,点击"设为当前图片"随时换主图;换下的图进 `extra_images` 历史(现有 `bindAsset` 行为)。
- 手动模式(开关关闭)与现状完全一致。

## 后端设计

### 设置项

- `global_settings` 新键 `chatgpt_web_auto_select`(经 `settingsService.getSetting`,默认 `true`)。关闭后完整回退现有 `needs_review` 手动流。

### 导入服务(`externalGenerationImportService.js`)

`importExternalResult` 在导入事务后、原 `markUnifiedTaskNeedsReview` 位置改为决策函数 `finalizeImportedResult`:

- 关闭开关,或任务状态为 `failed`/`cancelled`,或 `resolveTarget` 失败(目标已删除等)→ 保持现有 `needs_review` 行为。
- 开启且该任务是本 attempt 首个导入结果(此前无 `selected=1` 的结果行)→ `bindResult`(复用现有 character/scene/prop/storyboard_main/first/last 绑定逻辑,含 `bindAsset` 历史回写)→ 任务 `completed`(带 `imageGenerationId`)。状态机:`needs_review` 直接转;`submitted`/`generating` 直接转;`preparing` 先转 `submitted` 再转 `completed`(导入与 acknowledge 的竞态窗口)。
- 非首张候选:仅导入为追加候选行(`status='imported'`),不改主图、不改任务状态。
- `markUnifiedTaskNeedsReview` 保留,仅用于不可归属场景。

### 批量恢复(存量数据)

- 新路由 `POST /api/v1/dramas/:dramaId/image-generation-tasks/review/batch-select-first`:对该剧所有 `chatgpt_web` 且 `needs_review` 的任务,取其 attempt 下首个 `imported` 结果执行与 `select-result` 相同的绑定+完成逻辑,返回逐任务结果(成功/无候选/失败)。无候选的任务保持 `needs_review`。

### 队列与批次

- `refreshBatch` 的完成/待选计数自然生效,无需改动;驱动器 `terminal` 事件的通知分支按任务最终状态取文案。

## 前端设计

- 通知:驱动器 `needs_review` 事件文案区分"多候选已挂载"与现有"候选待选择";新增任务 `completed` 事件时轻提示"已生成并挂载"。
- 抽屉:completed 任务也渲染候选列表(数据源不变,external job results);`ImageGenerationQueue.vue` 的"待选"计数继续反映剩余 needs_review。
- 设置:图片生成抽屉内增加"自动采用首个候选"开关(读写新设置项,经现有 settings API);默认开。
- 批量恢复入口:队列区"待选 N"标签旁增加"全部采用首选"按钮(调上述批量路由),仅当 N>0 显示。

## 兼容与回退

- 扩展侧零改动,旧版扩展继续工作;所有变更在后端导入决策与前端呈现层。
- 关闭 `chatgpt_web_auto_select` 即回到与现状完全一致的行为。
- `needs_review` 仍是所有不可归属抓取(UNBOUND_RESULT、身份漂移)的唯一归宿,"恢复结果捕获"流程不变。

## 边界情况

| 场景 | 行为 |
|------|------|
| 一个 attempt 抓回多张 | 第一张定稿,其余追加可切换,不抢主图 |
| 目标在生成期间被删除 | `resolveTarget` 失败 → `needs_review`,候选保留在未归属区可重绑 |
| 导入与 acknowledge 竞态(任务仍 preparing) | 先转 submitted 再转 completed |
| 开关关闭 | 完整回退现状手动流 |
| 存量 needs_review 无候选 | 批量恢复跳过并保持原状态 |
| 用户换主图 | `select-result` 现有逻辑,历史图进 extra_images |

## 测试策略(TDD)

- 后端:导入服务决策测试(首张自动定稿/多张不抢占/开关关闭/目标缺失/竞态转态)、批量恢复路由测试(混合状态批次)、设置项读写。
- 前端:store 通知分支、抽屉 completed 候选渲染源码测试、批量恢复入口显隐。
- 回归:后端/前端/扩展全量 + 生产构建;真实链路以一次 3-5 任务连续生成做冒烟(角色/场景/道具各一)。

## 验收标准

1. 连续生成角色/场景/道具各 1 张,全部在不打开抽屉的情况下出现在项目页对应位置。
2. 对已自动定稿的任务换主图后,旧图进入历史且新主图即时生效。
3. 关闭开关后行为与现状一致。
4. 09-01 存量 3 张待选候选可通过"全部采用首选"一键恢复。
