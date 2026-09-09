# 当前代码健康度

> 目的：识别影响正确性、可维护性、可迁移性和运行安全的现状风险。本文不修改业务代码，也不把“代码量大”单独当作问题；风险判断以职责数量、依赖方向和真实契约冲突为依据。

## 1. 验证基线

在与 `better-sqlite3` 原生模块 ABI 匹配的 Node 22.22.3 环境中，当前测试结果为：

| 子项目 | 结果 |
|---|---|
| 后端 | 920 tests passed，0 failed |
| 前端 | 244 tests passed，0 failed |
| 浏览器扩展 | 96 tests passed，0 failed |
| external-bridge | 4 tests passed，0 failed |
| 合计 | **1,264 passed，0 failed** |

测试覆盖说明系统并非不可维护原型，尤其任务生命周期、provider 边界和扩展协议已有较好的单元/契约保护。但当前主要缺口是浏览器级端到端测试、真实旧库升级矩阵、Electron 打包 smoke test 和真实供应商沙箱契约测试。

系统 Node 24 下，当前安装的 `better-sqlite3` 二进制为 `NODE_MODULE_VERSION 127`，而运行时要求 137，后端无法加载。项目声明 `node >=18`，但原生依赖使“满足 semver 即可运行”并不成立，这是安装/发布风险，而不是业务测试失败。

## 2. 总体评价

| 维度 | 判断 | 说明 |
|---|---|---|
| 产品闭环 | 良好 | 主生产流程、数据持久化、恢复和后期确实存在 |
| 自动化测试 | 良好 | 四个运行单元合计 1,264 项测试通过 |
| 模块边界 | 较弱 | 页面、路由组合根、供应商客户端承担过多职责 |
| 数据一致性 | 高风险 | 绝大多数关系无外键、多重事实源、迁移无台账 |
| 后台可靠性 | 中等 | 视频/超分较强；通用异步任务仍为进程内 |
| API 一致性 | 较弱 | 响应包、字段、声明路由和适配文档存在漂移 |
| 本地安全 | 高风险 | 全网卡监听、无认证、完整密钥返回、日志泄密、关闭 TLS 校验 |
| 演进成本 | 高 | 新旧生成架构和两套制作界面并存 |

## 3. 高优先级风险

### 3.1 密钥与网络边界（严重）

证据：

- 独立后端默认监听 `0.0.0.0:5679`，没有认证或授权中间件。
- `ai_service_configs` 明文保存 API key，配置列表 API 返回完整值。
- 前端“导出配置”会把完整配置含密钥写入 JSON。
- `ttsService.js` 的调试日志输出 TTS 文本、voice id、base URL、模型，且直接输出 `ttsConfig.api_key`。
- 默认配置允许设置 `server.insecure_tls: true`，启动后全局将 `NODE_TLS_REJECT_UNAUTHORIZED=0`。

影响：同网段访问、日志采集、配置文件分享或中间人攻击都可能暴露供应商凭证。Electron 内部绑定 `127.0.0.1` 相对安全，但不能抵消独立服务的默认暴露。

建议优先级：立即停止记录密钥；接口默认脱敏；导出密钥需显式、单次确认；独立服务默认 loopback；禁用全局 TLS 绕过，改为单连接受控策略。实施这些建议属于后续任务，本次未改代码。

### 3.2 数据迁移不可证明（严重）

证据：

- 没有 migration ledger，`PRAGMA user_version=0`。
- 每次启动重放所有 SQL，再运行约 800 行 `ensureAllColumns()`。
- 迁移文件存在重复编号 `20`。
- 通过分号简单切分 SQL，错误以字符串匹配跳过。
- 没有单迁移事务、checksum 或“旧版本 → 当前版本”测试矩阵。

影响：新库测试通过不能证明历史用户库安全升级；不同安装可能因过去运行顺序和局部失败形成不同 schema。后续规范化表结构时风险会被放大。

### 3.3 巨型组件与组合根（高）

| 文件 | 约规模 | 实际职责 |
|---|---:|---|
| `frontweb/src/views/FilmCreate.vue` | 11,496 行 | 七阶段 UI、数据加载、任务编排、批处理、素材库、提示词、图像、视频、音频、合并、导入导出 |
| `backend-node/src/services/videoClient.js` | 4,420 行 | 多协议鉴权、上传、请求、轮询、结果解析、错误归一化 |
| `frontweb/src/components/AIConfigContent.vue` | 2,967 行 | 多服务配置、预设、导入导出、测试、模型映射、生成设置 |
| `backend-node/src/services/imageClient.js` | 1,927 行 | 多图像协议的请求与解析 |
| `backend-node/src/routes/index.js` | 约 500 行 | 路由表、服务容器、恢复启动、互斥锁和跨域回调装配 |

风险来自修改扩散和隐式共享状态：一个供应商、一个任务状态或一个分镜字段变化，会穿透 UI、service、路由组合和数据层。`FilmCreate.vue` 已抽出若干 composable，但页面仍保留绝大部分编排与局部状态，拆分尚未改变依赖中心。

### 3.4 多重事实源（高）

典型冲突：

- 分镜角色同时存在 `storyboards.characters` JSON、`storyboard_characters`、`storyboard_character_variants`。
- 分镜当前图片/视频字段与 `image_generations`、`video_generations` 选中记录重复。
- Scene 实体的 location/time 与 Storyboard 的文本字段会重复描述场景。
- `dramas.metadata` 保存画布、工作流组、生成设置、文件夹标签和图像通道等无关结构。
- 生成配置既引用可变 AI config，又保存 snapshot；哪些操作应读当前值、哪些应读快照没有统一规则。

已经出现的真实后果是 `external_generation_jobs` 顶层状态一直为 `pending`，而 attempt/result 已进入完成或导入状态。聚合与明细状态不一致会让恢复、统计和 UI 判断产生错误。

## 4. 指定风险审计

### 4.1 Duplicated logic

| 重复区域 | 证据 | 影响 |
|---|---|---|
| 资产生成与维护 | 角色、场景、道具各自有近似 CRUD、提示词、图片、额外图片、素材库对话框 | 修复上传/历史/错误处理需在多处同步 |
| 图像任务 | 通用 `async_tasks`、图像 batch/task、`image_generations`、前端 generation store/image store | 状态词汇和恢复规则不一致 |
| 视频供应商 | 统一 video lifecycle 外仍保留大型 legacy `videoClient` 分支 | provider 新增仍需理解两层抽象 |
| 工作台 | `FilmCreate` 与 `DramaCanvas` 各自加载并操作相同项目/剧集/分镜 | 功能逐渐不等价，验证成本翻倍 |
| AI 配置入口 | 独立 `AiConfig` 页面与多个弹窗入口 | 导航和生命周期重复 |
| 公共库与项目素材导入 | 首页公共库、项目详情素材库和制作台选择器概念近似 | 用户模型与代码组件重复 |

### 4.2 Tight coupling

- `FilmCreate.vue` 直接理解后端任务类型、资源键、供应商能力、分镜模型和合并配置。
- Pinia store 直接调用 Element Plus 通知并管理全局定时器，状态与展示层耦合。
- `routes/index.js` 知道统一视频、超分、合并、Director、ComfyUI 和恢复顺序。
- 服务同时更新 DB、写文件、生成公共 URL 和调用供应商，没有统一事务边界。
- 桌面开发态依赖复制的 backend-app，以解决 native ABI，但形成源码与运行副本耦合。

### 4.3 Giant component

`FilmCreate.vue` 是最明显的 giant component。它不是简单模板过长，而是同时持有：

- 页面导航与多个对话框状态；
- 故事和剧集选择；
- 角色、变体、场景、道具 CRUD；
- 单项/批量生成与重试；
- 分镜脚本、图像和视频编辑；
- TTS、字幕、合并、超分；
- 一键流程和进度恢复。

这使局部回归难以隔离，也迫使测试更多依赖提取出的纯函数而不是页面真实行为。

### 4.4 Global state abuse

Pinia 数量不多，本身不构成滥用；风险集中在“全局状态承担执行器职责”：

- `imageGenerationStore` 启动全局队列 interval、发送通知、控制外部浏览器通道；
- `generationTaskStore` 维护 Map、共享轮询 Promise、陈旧任务和孤儿判断；
- 页面同时保存同一任务的局部 UI 状态。

因此当前问题更准确地说是**全局状态与副作用混合**，而不是 store 数量过多。

### 4.5 Inconsistent API

确定案例：

- 标准响应为 `{success,data}`，但 tail-frame link 路径直接返回 `{error}`。
- 前端角色/场景 API 声明 `addToTeamLibrary`，后端无对应路由。
- FreeCreate 调用不存在的 `imagesAPI.getTask`。
- MediaLibrary 传 `keyword`，`assetService.list` 不转发。
- OpenClaw 文档使用 `/ai-configs/:id/test`，实际为 `/ai-configs/test`；还引用多条完全不存在的生成 API。
- OpenClaw 写提示词用 `{value}`，当前 API 读取 `{content}`。

根因是缺少共享契约和生成客户端，前端 API、路由、外部适配文档可独立漂移。

### 4.6 Inconsistent model

- 部分实体使用 `deleted_at`，任务/关系表则多为硬删或没有删除标记；文件又有独立生命周期。
- status 词汇在通用任务、图像、视频、Director、超分和外部生成间各自定义。
- 关联有 JSON id 数组、复合表、普通关联表和未约束 id 字段多种方式。
- `assets` 通用表与角色/场景/道具表都持有图片 URL/local path，职责重叠。
- 配置版本为 1.0.0，而 package 版本为 1.2.8。
- 代码宣称纯 JavaScript，但 `App.vue` 使用 `<script setup lang="ts">`，虽未必影响构建，却体现工程约定漂移。

### 4.7 Dead code / legacy

| 项目 | 判断 |
|---|---|
| `routes/stub.js` 未挂载处理器 | 死代码；唯一挂载的角色提取又是损坏占位 |
| `ImageGenerationQueue.vue` | 未发现引用，已被 store/任务抽屉路径替代 |
| FreeCreate 图像逻辑 | 入口隐藏且 API 已断裂，属于遗留损坏路径 |
| `storyboard_characters` | 实库空，现行关联走 JSON/变体表，疑似旧模型 |
| 隐藏连续性批处理 UI | 代码保留但产品入口注释 |
| `desktop/scripts/initial-migrations` | 只到早期迁移，当前打包又复制完整后端，属于容易误导的工程遗留物 |
| OpenClaw 路由说明 | 大量失效，作为适配器不可用 |

“实库为空”不能单独证明死代码，因此 `frame_prompts`、`director_timelines`、style snapshots 等仍有路由或服务使用的表没有被归为死代码。

### 4.8 Migration risk

除无台账外，还有：

- 大量业务关系无外键，删除/导入依赖应用手工维护。
- 项目 ZIP 导入和剧集包导入需要同时映射 JSON 内 id 与关系表 id。
- 媒体路径包含冻结标签和日期；重命名项目不等同移动目录。
- 文件写入与 DB 提交通常不是一个可回滚事务。
- JSON 字段没有 schema version，旧数据升级只能靠容错读取。
- `better-sqlite3` 原生 ABI 使 Node 升级与桌面打包迁移相互影响。

## 5. 已确认的功能正确性问题

| 严重度 | 问题 | 可观察结果 |
|---|---|---|
| 高 | TTS 日志输出 API key | 运行日志泄露凭证 |
| 高 | 独立后端无认证且监听全网卡 | 同网段可读写项目和完整 AI 配置 |
| 高 | 全局关闭 TLS 验证 | 所有 Node HTTPS 请求失去证书校验 |
| 高 | FreeCreate 调用不存在的任务 API | 图像生成轮询无法成功完成 |
| 高 | 角色提取路由挂载 stub | 返回成功但永远为空，形成静默错误 |
| 中 | 媒体上传不写 `assets` | 上传后刷新列表看不到资源 |
| 中 | 媒体关键词未转发 | 搜索框无实际筛选效果 |
| 中 | Asset 更新字段与 schema 不符 | 更新相关字段触发 SQL 错误 |
| 中 | external job 聚合状态不更新 | 列表/恢复判断与明细结果不一致 |
| 中 | 非标准 `{error}` 响应 | Axios 拦截器丢失具体错误信息 |
| 中 | CORS 默认端口 3012、Vite 为 3013 | 绕过代理直接访问时被拒绝 |
| 低/中 | `videoClient.js` 和 store 中存在乱码用户文案 | 某些错误分支显示 `????` 或乱码 |

## 6. 可观测性与错误体验

- 日志以 `console.*` 为主，没有结构化级别、request id 或任务 trace 的统一上下文。
- 后端任务错误有 `error_code/error_message` 的新模型，但旧路径只保存字符串。
- 前端全局拦截器会主动提示错误，减少静默失败；但也使 service/store/UI 三层都可能重复通知。
- 乱码字符串出现在 `videoClient.js` 的若干错误/日志路径，以及 `imageGenerationStore.js` 的用户提示中，表明编码治理不足。
- 外部生成 events 和 idempotency 是目前最接近事件审计的模块，但未扩展到主任务系统。

## 7. 测试缺口

优先补齐的验证层次：

1. 从历史数据库样本升级到当前 schema，并比较结构/数据不变量；
2. 项目导出 → 全新库导入 → 再导出的往返测试；
3. 浏览器端从项目创建到单镜生成/选择/合并的 E2E；
4. Electron 安装包启动、首次配置、FFmpeg 与 native module smoke test；
5. MediaLibrary、FreeCreate、角色提取等目前损坏路径的契约测试；
6. 真实供应商的可选沙箱契约测试，至少覆盖请求构造和轮询响应；
7. 密钥脱敏与“日志中不出现凭证”的安全测试。

## 8. 风险处理顺序

```text
P0  凭证泄露 / 网络暴露 / TLS 全局禁用
 ↓
P1  迁移台账与旧库升级可验证性
 ↓
P1  修复确定性断裂 API 与假成功 stub
 ↓
P2  统一任务状态、关系事实源和响应契约
 ↓
P2  拆分 FilmCreate、videoClient、AIConfigContent、路由组合根
 ↓
P3  清理遗留入口、死代码和重复配置/素材表面
```

顺序的依据是先保护用户凭证和已有数据，再修正错误契约，最后进行结构重构。直接先拆组件或重写 provider，会在没有迁移与契约基线时放大回归面。

## 9. 结论

当前代码健康度不能简单概括为“差”：它有广泛测试、明确的主产品闭环，以及若干成熟的恢复状态机。真正需要警惕的是边界不一致——同一任务、关联、配置和错误在不同模块有不同表达。若继续只增功能，复杂度会以组合方式增长；若先建立迁移、契约和安全基线，现有产品资产仍具备较高可演进价值。
