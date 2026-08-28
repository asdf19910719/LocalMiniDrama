# 全项目统一 ChatGPT 图片生成设计

## 配置职责与启动边界（2026-08-28）

ChatGPT 网页生图现在分为两层配置：

- API 配置页的“统一图片通道”负责全局启用/停用 ChatGPT Web，并可保存 Chrome 可执行文件和登录 Profile 路径。
- 剧集管理页仍保留“默认生图方式”，只负责为当前剧集选择 `api` 或 `chatgpt_web`，不承载浏览器环境配置。

通过仓库根目录的 `run_dev.ps1` / `run_dev.bat` 启动项目时，后端健康后会读取 API 配置；ChatGPT Web 已启用时自动启动指定的 Chrome for Testing、Profile 和 MV3 扩展。也可单独运行 `start_chatgpt_browser.ps1`。首次仍需登录一次，后续自动复用 Profile。

页面重新打开时，统一图片摘要中的 `active_task_id` 会自动加载并恢复 ChatGPT 任务轮询；浏览器扩展未运行、未登录或会话失效时，任务会保留错误状态并可从抽屉重试/恢复捕获。

> 实际浏览器验收（2026-08-28）：已使用真实登录态 ChatGPT + Playwright Chromium + MV3 扩展完成道具入口的完整流程：工作台选择“ChatGPT 生成”→真实网页发送→监听 assistant turn→恢复并导入 3 个候选→选择候选并绑定道具。Task `1684a88f-690c-49fb-9799-2272dce7c37d` 已为 `completed`，原图已写入本地并通过 `200 image/png` 预览接口提供。扩展回归 39/39、后端统一生图相关回归 15/15；启动参数和验收命令见 `docs/真实ChatGPT图片生成模拟测试启动与验收.md`。

> 主分支同步（2026-08-28）：统一 ChatGPT 图片生成已合并到本地 `main`。本轮加入全局通道配置、自动浏览器启动和活动任务恢复后，Node 22.22.3 后端全量测试 `303/303`、浏览器扩展 `39/39`、前端测试 `61/61`、前端生产构建均通过。工作流注册表文件保持已登记的 SHA-256。

> 默认通道与启动修复（2026-08-28）：全局“启用 ChatGPT Web”只控制该通道是否可用，现有剧集仍使用各自保存的默认通道；剧集 3 已明确切换为 `chatgpt_web`，真实页面 `film/3?episode=3` 的 13 个图片入口均实测显示“ChatGPT 生成”。Windows 启动器现在为专用 Chrome for Testing 传入 `--do-not-de-elevate` 和 `--no-sandbox`，并等待远程调试端口实际监听后才报告成功；实测 `9223` 可访问、扩展 service worker 存在且 ChatGPT 根节点注入标记为 `v1`。当剧集持久默认是 ChatGPT、但全局通道被停用时，未显式指定通道的新任务和批次统一回退 `api`；显式请求 ChatGPT 仍返回拒绝。

> 角色提示词修正（2026-08-28）：角色 ChatGPT 生图入口不再把“角色背景简介”作为提示词。前端统一提示词解析器优先使用 `polished_prompt`、`appearance` 和角色名；后端角色适配器同样优先视觉字段。新增回归覆盖背景叙事与显式首帧提示词，避免故事梗概进入生图请求。

> 实施状态同步（2026-08-27）：当前分支已完成统一任务/批次模型、六类资源适配、统一 API、持久化串行队列、共享前端入口，以及 ChatGPT 的 `prepare -> fill -> upload -> send -> acknowledge` 执行链路。本轮提交为 `b8bc743`。Node 22.22.3 下后端定向测试 12/12、扩展测试 37/37、前端统一图片测试 5/5 和前端生产构建均通过。真实网页生图尚未计为通过：已有 profile 当时被 Cloudflare 返回 `Unable to load site`，可控扩展 profile 未登录。

> 用户侧自动化边界：通过项目启动脚本运行时，浏览器和扩展会按 API 配置自动启动；完成一次 ChatGPT 登录后，tab 查找、扩展注入、会话绑定、提示词填充、参考图上传、提交、ACK 和任务轮询均自动完成。仅首次登录/登录失效、浏览器权限、Cloudflare/VPN 或网络不可用时需要人工处理。

## 1. 背景

项目现有图片生成已经覆盖角色、场景、道具、分镜主图、分镜首帧、分镜尾帧、宫格图、上传、历史图片、超分、批量生成和一键工作流。原生图片生成通过 `imagesAPI`、`imageService`、`imageClient` 和后台任务系统形成闭环，并由 AI 配置选择实际 API Provider。

当前 ChatGPT 图片生成通过 External Generation、浏览器插件和 ChatGPT 网页形成另一条链路。它能够创建 Job、发送提示词、捕获结果、导入本地图片并写入 `image_generations`，但仍是一套平行流程：

- UI 仅挂载在 FilmCreate 每条分镜最左侧的固定 300px 面板中；
- 角色、场景、道具和 DramaCanvas 没有入口；
- 外部结果选择后不会完整刷新原生图片状态；
- 外部图片没有正确表达分镜首帧或尾帧类型；
- 批量任务、状态恢复和原有任务中心未统一；
- 每个分镜面板分别查询整个项目的 External Job 列表。

本设计把 ChatGPT 从“分镜旁边的独立工具”提升为全项目通用的图片生成方式，同时保留它与后端 API Provider 在执行机制上的差异。

## 2. 目标

1. 项目所有支持图片生成的位置均支持 ChatGPT：角色、场景、道具、分镜主图、首帧、尾帧以及相应批量入口。
2. 项目可设置默认图片生成方式，并允许每次生成临时覆盖。
3. API 和 ChatGPT 使用相同的业务提示词、参考图、尺寸和结果绑定规则。
4. 单图、批量、刷新恢复、失败重试和候选图审核形成完整状态闭环。
5. ChatGPT 结果进入现有 `image_generations`、图片历史和业务实体绑定体系。
6. FilmCreate 与 DramaCanvas 保持能力一致，不影响现有 API 生图和后续视频生成。

## 3. 非目标

- 不把浏览器自动化伪装成普通 HTTP API Provider。
- 不重写现有 `imageClient` 中 OpenAI、DashScope、Gemini、Kling、Agnes 等 Provider 实现。
- 不改变现有角色、场景、道具和首尾帧的业务提示词规则。
- 不要求用户在每次生成时都选择生图方式。
- 不在第一阶段扩展 ChatGPT 之外的其他外部网页站点。

## 4. 产品决策

### 4.1 项目默认方式与单次覆盖

项目设置保存默认图片生成方式：

- `api`：使用项目配置的默认 API 图片模型；
- `chatgpt_web`：使用 ChatGPT 网页和浏览器插件。

默认值只影响新创建的任务，不修改已有任务或已有图片。

全局通道开关不会批量覆盖现有剧集的项目默认值。读取默认值时，后端同时返回持久配置与当前有效值；若 ChatGPT Web 全局停用，当前有效值为 `api`，从而保证界面展示、单任务创建和批次创建使用同一语义。

每个图片生成入口使用拆分按钮：

- 项目默认 ChatGPT 时，主按钮显示“ChatGPT 生成”；
- 项目默认 API 时，主按钮显示“默认模型生成”；
- 右侧下拉箭头允许本次临时切换为 API、ChatGPT 或上传；
- 临时选择不修改项目默认设置。

### 4.2 UI 位置

入口必须保留在资源原有图片区域：

- 角色图入口位于角色图片卡；
- 场景图入口位于场景图片卡；
- 道具图入口位于道具图片卡；
- 分镜主图、首帧和尾帧入口位于 FilmCreate 与 DramaCanvas 的对应图片槽位。

删除 FilmCreate 分镜行左侧常驻 300px 的 `ExternalWebGenerationPanel`。ChatGPT 不再与脚本、图片、视频三栏平级，也不单独挤占资源卡空间。

### 4.3 统一右侧任务抽屉

点击“ChatGPT 生成”后打开页面级右侧抽屉。移动端使用全屏面板或底部面板。

抽屉固定呈现：

1. 目标资源名称和类型；
2. 可编辑的最终提示词；
3. 有角色标记且顺序稳定的参考图；
4. 插件、ChatGPT 登录和会话状态；
5. 发送及生成状态；
6. 候选结果与“设为当前图片”动作；
7. 可执行的恢复操作。

页面同时只有一个任务抽屉实例。关闭抽屉不取消任务，重新打开时按任务 ID 恢复。

### 4.4 全局批量队列

当项目默认或本次批量选择 ChatGPT 时，批量角色图、场景图、道具图、分镜图及一键工作流创建统一队列。

- ChatGPT 并发固定为 1；
- 支持暂停、继续、跳过当前、重试失败项；
- 单项失败不阻塞整批；
- 单张有效结果自动绑定；
- 多张候选进入 `needs_review`，队列继续下一项；
- 整批结束展示成功、待选、失败和跳过数量；
- 页面刷新或关闭后可恢复队列。

## 5. 架构方案

### 5.1 统一图片任务编排层

业务入口不直接依赖 `imageClient` 或 External Job，而是统一创建图片生成任务：

```text
角色 / 场景 / 道具 / 分镜主图 / 首帧 / 尾帧
                         │
                         ▼
             Unified Image Generation Task
                         │
             ┌───────────┴───────────┐
             ▼                       ▼
       API Executor          ChatGPT Web Executor
       imageClient           插件 + External Job
             │                       │
             └───────────┬───────────┘
                         ▼
               Unified Result Binder
                         │
             image_generations + 业务实体
```

业务层统一称为“图片生成方式”，底层区分：

- `generation_channel=api`：由 AI 配置确定具体 Provider 和模型；
- `generation_channel=chatgpt_web`：由浏览器插件、网页会话和 External Generation 执行。

ChatGPT 不直接注册进 `imageClient`，避免后端 API 调用器承担浏览器登录、DOM 捕获、会话身份和人工审核职责。

### 5.2 资源适配器

每种目标实现资源适配器。适配器只负责：

- 读取并构建权威提示词；
- 收集、排序和标记参考图；
- 确定宽高比、尺寸和 `frame_type`；
- 验证目标属于当前项目；
- 描述结果绑定目标。

执行通道不能另行定义这些业务规则。

### 5.3 统一结果绑定器

所有 API 或 ChatGPT 结果最终进入统一绑定器：

| `target_type` | 绑定行为 |
| --- | --- |
| `character` | 更新角色主图，旧图保留到历史记录 |
| `scene` | 更新场景主图，旧图进入 `extra_images` |
| `prop` | 更新道具主图，旧图保留到历史记录 |
| `storyboard_main` | 写入分镜图片记录并绑定分镜主图/首帧 ID |
| `storyboard_first` | 设置 `frame_type=storyboard_first` 并调用首帧绑定器 |
| `storyboard_last` | 设置 `frame_type=storyboard_last` 并调用尾帧绑定器 |
| 宫格类型 | 保留宫格类型并进入现有拆图流程 |

绑定成功后发布统一的“图片目标已更新”事件，前端更新当前图片、历史图片、Store、批量统计和视频生成所读取的首尾帧。

## 6. 各资源业务规则

### 6.1 角色

- 提示词来自角色姓名、性别、年龄、外貌、服装、风格和角色设定；
- 参考图包括已有角色图和用户明确选择的造型参考；
- 默认不混入场景图；
- 推荐单人、主体完整、背景简洁；
- 结果更新角色主图，旧图进入历史，并供分镜引用。

### 6.2 场景

- 提示词来自地点、时间、天气、空间布局、光线和视觉风格；
- 参考图包括已有场景图和风格参考；
- 默认不加入角色，避免污染空镜；
- 使用项目宽高比；
- 结果更新场景主图，旧图进入 `extra_images`。

### 6.3 道具

- 提示词来自名称、材质、年代、形状、颜色、磨损和剧情用途；
- 参考图包括已有道具图和用户指定参考；
- 推荐单物体、干净背景和清晰辨识特征；
- 结果更新道具主图，旧图保留到历史。

### 6.4 分镜主图

- 提示词优先级统一为 `polished_prompt`、`image_prompt`、`description`，再合并项目风格；
- 参考图顺序为场景、角色、道具；
- 使用项目宽高比及分镜景别、机位和构图；
- 结果进入现有分镜图片记录和历史条。

### 6.5 分镜首帧

- 使用现有专业首帧提示词，不由普通 `image_prompt` 覆盖；
- 参考图包括场景、角色、道具，可按现有连续性规则加入上一镜尾帧；
- 结果必须设置 `frame_type=storyboard_first`；
- 通过现有绑定器更新 `first_frame_image_id`、`image_url` 和 `local_path`。

### 6.6 分镜尾帧

- 使用现有专业尾帧提示词；
- 参考图包括场景、角色、道具；
- 开启首帧布局锁时强制加入当前首帧；
- 结果必须设置 `frame_type=storyboard_last`；
- 通过现有绑定器更新 `last_frame_image_id` 和尾帧路径，不能覆盖主图或首帧。

## 7. 统一任务状态

UI 和编排层统一使用：

| 状态 | 含义 |
| --- | --- |
| `draft` | 用户正在确认提示词和参考图 |
| `queued` | 已进入批量队列 |
| `preparing` | 准备参考图、插件或执行环境 |
| `submitted` | 已得到执行端确认并提交 |
| `generating` | 等待生成结果 |
| `needs_review` | 有候选结果或身份需要人工确认 |
| `completed` | 结果已经绑定到业务目标 |
| `failed` | 失败且存在明确错误原因 |
| `cancelled` | 用户取消尚未完成的任务 |

API 通道通常从 `generating` 直接进入 `completed`。ChatGPT 通道在多候选或身份不确定时进入 `needs_review`。

## 8. 数据结构

### 8.1 `image_generation_tasks`

统一业务编排记录至少包含：

```text
id
drama_id
target_type
target_id
generation_channel
provider
model
prompt_snapshot
reference_manifest
aspect_ratio
frame_type
status
batch_id
queue_position
image_generation_id
external_job_id
error_code
error_message
created_at
updated_at
completed_at
```

`image_generation_id` 指向最终统一图片记录。`external_job_id` 仅由 ChatGPT 通道使用。

### 8.2 `image_generation_batches`

批量记录至少包含：

```text
id
drama_id
resource_scope
generation_channel
status
total_count
completed_count
review_count
failed_count
created_at
updated_at
```

单项顺序由 `batch_id + queue_position` 表达。

### 8.3 项目默认设置

Drama 元数据或项目设置保存：

```json
{
  "default_image_generation_channel": "chatgpt_web"
}
```

### 8.4 External Generation 表

现有 Job、Attempt、Result、Session 和 Event 表继续保留，作为 ChatGPT 执行详情。External Result 不再直接更新角色、场景、道具或分镜，而是交给统一结果绑定器。

## 9. API

### 9.1 创建单任务

```http
POST /api/v1/image-generation-tasks
```

```json
{
  "dramaId": 12,
  "targetType": "storyboard_last",
  "targetId": 108,
  "generationChannel": "chatgpt_web",
  "prompt": "专业尾帧提示词",
  "referenceImages": [
    { "role": "storyboard_first", "sourceId": 501, "url": "/static/example.png" }
  ],
  "aspectRatio": "16:9"
}
```

服务端验证目标、调用资源适配器、冻结快照并分派执行通道。

### 9.2 创建批量任务

```http
POST /api/v1/image-generation-batches
```

```json
{
  "dramaId": 12,
  "scope": "storyboards",
  "generationChannel": "chatgpt_web",
  "targetIds": [101, 102, 103]
}
```

服务端为每个目标生成稳定快照和队列位置，前端不循环创建格式不一致的任务。

### 9.3 查询

```http
GET /api/v1/dramas/:dramaId/image-generation-summary
GET /api/v1/image-generation-tasks/:taskId
```

页面加载只请求一次项目摘要；打开抽屉时才加载任务详情。

### 9.4 队列控制

```http
POST /api/v1/image-generation-batches/:id/pause
POST /api/v1/image-generation-batches/:id/resume
POST /api/v1/image-generation-tasks/:id/retry
POST /api/v1/image-generation-tasks/:id/skip
POST /api/v1/image-generation-tasks/:id/cancel
```

`retry` 按失败阶段重试连接、发送、捕获或导入。已发送任务默认只恢复捕获；明确“重新生成”才创建新 Attempt。

### 9.5 选择候选结果

```http
POST /api/v1/image-generation-tasks/:taskId/select-result
```

事务内验证归属、确认 `image_generations`、设置 `frame_type`、调用统一绑定器、更新选中状态以及任务和批次状态，并返回更新后的业务目标与图片记录。

## 10. 前端组件

### `ImageGenerateSplitButton`

- 显示项目默认通道；
- 提供本次临时覆盖；
- 只创建任务，不承载任务详情。

### `ImageGenerationDrawer`

- 按统一任务 ID 展示提示词、参考图、插件状态、候选图和恢复操作；
- 桥接失败时保留 `preparing` 任务并显示错误原因，提供“重试发送”；
- 等待扩展 ACK 时显示明确的等待状态，不把无响应误报为已发送；
- `submitted` / `generating` 任务自动轮询后端并归一化 External Job 候选；
- 浏览器刷新、ChatGPT 标签关闭或扩展观察器中断后，可“恢复结果捕获”，不得重新提交提示词；
- 不内置角色或分镜专属绑定逻辑。

### `ImageGenerationChannelSetting`

- 在制作页和剧集管理页显示项目级“默认生图方式”；
- 通过 `PUT /api/v1/dramas/:dramaId/image-generation-default` 持久化 `api` 或 `chatgpt_web`；
- 生图按钮主操作使用该默认通道，下拉菜单仍可对单次任务临时覆盖。

### `ImageGenerationQueue`

- 页面级单实例；
- 显示批次摘要、当前项、暂停、继续、跳过和失败重试。

### `useImageGeneration`

- 创建任务、订阅或轮询状态、加载摘要；
- 把绑定响应同步到现有 Store；
- 供 FilmCreate、DramaCanvas、角色、场景和道具页面复用。

## 11. 插件协议与可靠性

- 发送前必须完成扩展连接、ChatGPT 登录和会话预检；
- 扩展未安装、未启用、未登录或无响应时，前端必须显示可读错误并保留任务以便重试；
- 页面只有收到扩展真实 ACK 后才能进入 `submitted`；
- 不能将无确认的 `window.postMessage` 当成发送成功；
- Attempt 应在执行端确认可接收时创建，或在通知失败时可靠回滚/标记；
- 已发送后页面关闭时保留 `submitted`，恢复同一会话捕获，不能自动重复发送；
- 结果必须校验会话、Assistant 消息身份和图片 Hash；
- 身份无法确认时进入 `needs_review`，禁止自动绑定；
- 下载或持久化失败只重试导入，不重新生成；
- 参考图优先传递受控 URL、Blob 或扩展可访问引用，不能把所有高清图片转换成巨大数字数组发送。

## 12. 失败与恢复

- 插件缺失或断连：任务保留 `queued`，提供重新连接，不创建虚假已发送记录；
- ChatGPT 未登录：暂停队列，登录后从当前项恢复；
- 页面关闭：恢复同一任务和会话；
- 单项失败：记录阶段和错误，继续下一项；
- 多候选：标记待选并继续队列；
- 目标被删除：结果保留在素材库，任务标记未绑定，允许改绑同项目目标；
- 页面重开：一次加载未完成任务摘要，打开抽屉时再加载详情；
- 幂等：同一 Attempt、结果索引和图片 Hash 不得重复创建图片记录。

## 13. 测试与验收

### 13.1 入口覆盖

角色、场景、道具、分镜主图、首帧、尾帧均需覆盖：单图、重新生成、批量、历史图和正确绑定。实现前全项目检索现有图片生成入口并形成清单。

### 13.2 输入一致性

同一业务目标切换 API 和 ChatGPT 时，除执行通道外必须使用相同权威提示词、参考图顺序、宽高比、风格和首尾帧规则。

### 13.3 绑定验收

- 角色、场景、道具只更新目标资源并保留旧图历史；
- 分镜主图即时更新图片区、历史条和批量完成状态；
- 首帧写入 `storyboard_first` 和 `first_frame_image_id`；
- 尾帧写入 `storyboard_last` 和 `last_frame_image_id`，不污染主图；
- FilmCreate 与 DramaCanvas 同步显示；
- 后续视频生成读取正确首尾帧。

### 13.4 单图端到端

覆盖创建任务、抽屉确认、插件预检、真实 ACK、网页生成、结果捕获、候选选择、业务绑定和 Store 即时更新。用户不需要手动 Refresh。

### 13.5 批量端到端

至少验证 20 项队列：并发为 1、顺序稳定、暂停和恢复正确、单项失败不阻塞、多候选不阻塞、统计准确、同一 Attempt 不重复发送。

### 13.6 异常场景

覆盖插件未安装、断连、未登录、网页关闭、应用刷新、后端短暂不可用、下载失败、导入响应丢失、重复上报、会话或消息身份不一致、目标删除和运行中资料修改。

### 13.7 UI 与性能

- 删除分镜第四栏；
- 所有页面使用统一按钮和抽屉；
- 移动端不挤压现有布局；
- 页面只加载一次项目摘要；
- 50 个分镜不产生 50 次全量 Job 查询；
- 候选图和任务详情按需加载；
- 批量时不一次读取全部高清参考图到浏览器内存。

### 13.8 回归

原生 Provider 路由、角色/场景/道具生图、分镜主图、首尾帧、宫格拆图、上传、历史切换、超分、API 批量、一键工作流和视频首尾帧输入必须继续通过。

## 14. 完成定义

仅在以下条件全部成立时视为完成：

1. 所有图片业务入口均可选择 ChatGPT；
2. ChatGPT 与 API 复用同一业务输入规则；
3. 结果进入统一图片记录和历史体系；
4. 角色、场景、道具、主图、首尾帧绑定全部正确；
5. 单图和批量任务形成状态闭环；
6. FilmCreate 与 DramaCanvas 能力一致；
7. 刷新和断连不会重复生成、丢失任务或错误绑定；
8. 原有 API 图片生成和后续视频流程不受影响。

## 15. 实施分解原则

后续实施计划应按依赖顺序拆分：

1. 统一数据模型、状态机和结果绑定器；
2. API 执行通道接入统一任务，保持原功能等价；
3. ChatGPT 执行通道和可靠 ACK/恢复协议；
4. 项目默认设置、统一按钮、抽屉和任务摘要；
5. 角色、场景、道具入口迁移；
6. FilmCreate、DramaCanvas、首尾帧入口迁移；
7. 批量队列和一键工作流；
8. 删除旧常驻面板并完成全量回归。

每个阶段都必须保留可回归的 API 生图路径，不能在统一层尚未验证前移除旧能力。
