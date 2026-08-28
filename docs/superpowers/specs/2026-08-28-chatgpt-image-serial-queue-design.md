# ChatGPT 单独生图任务串行队列与全局通知设计

日期：2026-08-28
状态：已评审（方案 B1，用户确认）
前置：`docs/superpowers/specs/2026-08-27-unified-chatgpt-image-generation-design.md`

## 1. 背景与问题

统一 ChatGPT 图片生成已上线，但并发语义存在空白：设计规定"ChatGPT 并发固定为 1"且已有"持久化串行队列"，但串行队列目前只覆盖**批次**（批量生成分镜图）；单独点击各资源（角色/场景/道具/分镜）的"ChatGPT 生成"按钮走立即发送路径。当上一个任务还在生成时点击下一个，ChatGPT 网页的发送按钮处于禁用状态，适配器抛 `NOT_READY`，任务卡在 `preparing`，需要用户手动等上一个完成后点"重试发送"。

另外，任务进度只在打开的抽屉面板内可见，没有任何全局提示：用户点完生成去做别的事（写剧本、整理素材），候选导入或失败都不会被告知。

## 2. 目标

1. 单独点击多个资源的 ChatGPT 生图自动排队，串行执行，零 `NOT_READY` 打扰。
2. 队列全局并发为 1、顺序稳定（按创建时间）、单项失败不阻塞后续。
3. 页面关闭时队列暂停不丢失；回到页面自动恢复推进。
4. 关键事件（候选已导入、任务失败、队列全部完成）右上角全局通知，点击可回到对应任务抽屉。
5. 批次生成行为完全不变。

## 3. 非目标

- 扩展 service worker 驱动队列（方案 B2，明确否决：MV3 SW 空闲回收 + 双侧状态同步成本高）。
- 跨项目优先级、排队位置展示、浏览器级系统通知。
- API 通道任务与批次任务的任何行为变更。
- 队列持久化 worker（后端仍是裁决者，前端仍是执行者——发送必须经浏览器扩展）。

## 4. 生命周期与数据流

### 4.1 状态机（复用现有 TRANSITIONS，零迁移）

```
现状单独任务：create → draft →(prepare-send)→ preparing →(acknowledge)→ submitted → needs_review/completed
新单独任务：  create → queued →(claim-next)→ preparing →(acknowledge)→ submitted → needs_review/completed
失败路径：    preparing → failed →(用户重试 retryTask)→ queued（按原 created_at 参与排序，通常即下一个执行）
```

现有守卫已支持全部跃迁（`draft→queued`、`queued→preparing`、`preparing→failed`、`failed→queued` 均在 `TRANSITIONS` 中），无 schema 变更。

### 4.2 创建路径变更

`POST /image-generation-tasks` 对 `chatgpt_web` 单独任务：创建并附加 external job 后，**同事务内 `draft → queued`**（不再停留在 draft）。批次任务保持现有创建逻辑不变。

前端 `generateUnifiedImage`：点击后只创建任务并打开抽屉（显示"排队中"），**移除直接调用 `sendToChatGPT` 的逻辑**。发送完全由驱动器接管。

### 4.3 领取接口（后端裁决，防双标签页重复领取）

`POST /api/v1/image-generation-tasks/claim-next`

事务内：

1. 查询全局活跃任务（`chatgpt_web` 且状态 ∈ `submitted/generating`，或 `preparing` 且 `updated_at` 距今 ≤ 10 分钟）。存在活跃任务 → 返回 `{ claimed: false, active_task_id }`，不动队列。
2. `preparing` 且 `updated_at` 距今 > 10 分钟视为弃置任务 → 转 `failed`（error_message `超时未发送，已跳过`），继续。
3. 取最旧 `queued` 任务（`ORDER BY created_at`），`queued → preparing`，返回 `{ claimed: true, task }`（含 external_job）。
4. 队列空 → `{ claimed: false }`。

全局并发为 1：不按 drama 隔离——只有一个 ChatGPT 标签，跨剧集也必须串行。

### 4.4 失败标记接口

`POST /api/v1/image-generation-tasks/:taskId/fail`，body `{ message }`。守卫 `preparing → failed`，写入 `error_code='send_failed'` 与 `error_message`。供驱动器在重试耗尽后调用。

## 5. 前端驱动器（`imageGenerationStore`）

- 每 5 秒调一次 `claim-next`（页面在工作台、默认通道含 chatgpt_web 时启动；离开页面清除）。
- 领到任务 → 走现有发送链路：`prepare-send` → 桥接 `prepare`（fill+参考图上传）→ 桥接 `send` → `acknowledge` → 纳入现有任务轮询。
- **瞬时错误重试预算**：桥接 send 抛 `NOT_READY` / `provider tab unavailable` / `provider composer is not ready` 时，任务保持 `preparing`，驱动器最多重试 2 次（间隔 5 秒）后调用 fail 接口转 `failed`，立即领取下一个（单项失败不阻塞）。
- 驱动过的任务记录在会话内集合中，各自轻量轮询状态（复用 `GET /image-generation-tasks/:id`），用于通知与队列清空判定。
- 页面刷新恢复：驱动器重启后重新 claim-next 即可，无需额外状态。

### 抽屉交互变更

- `queued` 状态显示"排队中"（labels 已有），无发送按钮（驱动器拥有发送权）。
- 移除 `preparing + error_message` 时的"重试发送"按钮（避免与驱动器重试双重驱动）。
- `failed` 状态提供"重新排队"按钮（调 `retryTask` → `queued`）。

## 6. 全局通知（ElNotification 右上角）

| 事件 | 触发迁移 | 文案 | 点击行为 |
|---|---|---|---|
| 候选已导入 | → `needs_review`（且有候选） | 生图完成：N 张候选待选择 | 打开该任务抽屉 |
| 任务失败 | → `failed` | 生图失败：<error_message> | 打开抽屉可重新排队 |
| 队列完成 | 驱动过的最后一个任务终态且 claim-next 无排队 | 全部生图任务已完成 | 打开抽屉 |

- 去重键 `taskId:eventType`，会话内 Set 去重（刷新重置）。
- 进度态（queued/preparing/submitted/generating）不提示。
- store 内直接 import `ElNotification`（与现有 `ElMessage` 用法同级）。
- store 新增 `openTaskById(taskId)`：GET 任务 → currentTask + 打开抽屉 + 启动轮询。

## 7. 既有行为保持

- 批次创建、暂停/恢复、run-next、批次内重试：不变。
- API 通道任务：不变。
- 抽屉内现有状态展示、候选选择、恢复捕获（recoverAttempt）：不变。
- `preparing` 期间的人工"重试发送"入口：随驱动器接管而移除（见 5）。

## 8. 测试策略

后端（Node test runner，复用 `imageGenerationTaskRoutes.test.js` 的内存 express 夹具）：

1. claim-next：按 created_at 顺序领取；有活跃任务时拒绝领取；preparing 超时转 failed 并推进；队列空返回 claimed:false。
2. fail 接口：preparing→failed 守卫；非 preparing 拒绝。
3. 创建路径：chatgpt_web 单独任务直接落 `queued` 且附带 external job；批次任务仍为 queued+batch_id 不变。

前端（`node --test`，假 API/假桥接注入）：

1. 驱动器：空闲才领取；领到后完整走发送链路；瞬时错误按预算重试后转 failed 并继续领取下一个。
2. 通知：needs_review/failed/队列完成各触发一次 ElNotification；同任务同事件去重；点击打开对应抽屉。
3. 创建路径：点击资源生图只创建 queued 任务并开抽屉，不直接发送。

## 9. 完成定义

1. 连续点击多个资源生图，全部自动排队串行完成，全程无 NOT_READY 提示。
2. 单项失败（如模拟桥接异常）不影响后续任务执行。
3. 候选导入/失败/队列完成三类通知出现且可点击回抽屉，重复事件不重复提示。
4. 刷新页面后队列继续推进。
5. 批次生成与 API 通道回归全绿；后端/前端全量测试通过。

## 10. 风险与权衡记录

- 前端驱动意味着关闭页面即暂停队列（不丢失）。已与用户确认接受（与现状一致，页面即工作台）。
- 10 分钟 preparing 超时阈值：覆盖最慢生成（约 2-3 分钟）加网络余量；误杀风险低，且 failed 可一键重新排队。
- 全局（跨剧集）串行：保证与单一 ChatGPT 标签的物理约束一致；多剧集同时排队时按创建时间公平推进。
