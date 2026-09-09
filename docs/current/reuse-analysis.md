# 当前实现复用分析

> 本文回答“如果继续演进 LocalMiniDrama，哪些现有能力应保留、增强、重构、替换或移除”。分类针对实现，不否定其产品价值。
> 分类：`KEEP` 保持；`ENHANCE` 在当前边界内增强；`REFACTOR` 保留行为但重组实现；`REPLACE` 以新实现迁移；`REMOVE` 删除无价值或危险的旧路径。

## 1. 决策原则

1. 已形成真实产品闭环、数据语义稳定且测试充分的模块优先保留。
2. 有业务价值但边界混乱的模块重构，不因文件大就重写。
3. 存在确定性契约断裂、假成功或安全危险的实现优先替换。
4. 涉及用户数据库与媒体文件的模块不得大爆炸迁移。
5. 外部供应商适配应可替换，Drama/Episode/Storyboard 与候选评审模型应稳定。

## 2. 产品与前端

| 模块 | 分类 | 原因 | 迁移/增强重点 |
|---|---|---|---|
| 项目列表与项目详情 | `KEEP` | 主导航和项目级任务模型清晰，功能闭环 | 补 E2E 与删除部分成功提示 |
| Drama → Episode → Storyboard 主流程 | `KEEP` | 是最稳定、最有产品价值的领域骨架 | 明确实体不变量，避免继续把结构塞进 JSON |
| 线性七阶段制作模型 | `KEEP` | 符合用户按制作阶段推进的认知方式 | 保持 URL/操作语义，重构内部实现即可 |
| `FilmCreate.vue` 实现 | `REFACTOR` | 约 1.1 万行、职责过多，但承载大量已验证行为，重写风险过高 | 按阶段拆 route-level feature modules；将任务编排下沉为 application composables；先 characterization tests |
| 现有 `filmCreate` composables | `ENHANCE` | 已开始抽离角色、场景、道具、变体逻辑 | 统一 loading/error/dirty/save 契约，避免只移动代码不减少依赖 |
| `DramaCanvas.vue` | `ENHANCE` | 画布的多选、依赖可视化和工作流组有独立价值 | 与线性台共享 command/query 层；明确不是第二套业务实现 |
| 画布布局 | `KEEP` | 项目级用户偏好，JSON 存储可接受 | 给 payload 加 schema version 和独立更新 API |
| 画布 workflow groups 存于 metadata | `REFACTOR` | 已成为有状态业务对象，放在 metadata 无约束且易覆盖 | 先定义版本化 schema，再迁移为独立存储或受控文档 |
| `AIConfigContent.vue` | `REFACTOR` | 功能重要但多服务配置、预设、测试和导入导出集中 | 按 service type/schema 驱动表单，拆 provider panels |
| 独立 AIConfig 页 + 弹窗双入口 | `REFACTOR` | 可以保留两个导航入口，但应共享单一页面状态和路由语义 | 弹窗作为 route overlay 或只留一种主入口 |
| `generationTaskStore` | `ENHANCE` | 资源键去重、重连和陈旧任务处理很有价值 | 把通知与 polling scheduler 分离；消费统一任务 DTO |
| `imageGenerationStore` | `REFACTOR` | 任务抽屉和外部通道有价值，但 store 同时充当队列执行器和通知器 | 独立 queue runtime，显式 start/stop 生命周期 |
| Element 全局错误提示 | `ENHANCE` | 默认反馈有效 | 引入可抑制/可归并策略，避免多层重复通知 |
| 自由创作页面 | `REMOVE` | 主入口隐藏，图像链路确定性损坏，与项目化主流程重复 | 如仍需要“快速生成”，未来以共享生成组件重新立项，不复活旧代码 |
| MediaLibrary UI | `ENHANCE` | 跨项目资产浏览有真实价值 | 先修上传入库、搜索和文件回收，再增加标签/收藏 |
| `ImageGenerationQueue.vue` | `REMOVE` | 未发现引用，现行任务抽屉已承担职责 | 删除前用构建和引用扫描确认 |

## 3. 后端领域与服务

| 模块 | 分类 | 原因 | 迁移/增强重点 |
|---|---|---|---|
| Drama/Episode/Storyboard 服务 | `KEEP` | 产品主干成熟、路由和测试广泛 | 补事务、外键/孤儿检查和统一软删规则 |
| 项目 ZIP 导入导出 | `KEEP` | 本地产品的数据可携带性核心 | 加往返测试、manifest 版本与校验摘要 |
| 剧集包/外部 AI 包 | `KEEP` | 结构化人工协作契约清楚 | 继续版本化 schema，保持预览再导入 |
| 角色/场景/道具服务 | `REFACTOR` | 三类资源行为高度重复但领域字段不同 | 抽共享 asset-image lifecycle，不强行合并领域实体 |
| 角色变体与影响分析 | `KEEP` | 直接支撑一致性工作流，有独特产品价值 | 明确 variant 与 character current image 的权威关系 |
| 公共素材库服务 | `ENHANCE` | 复用价值明确 | 统一 source provenance、标签、物理文件生命周期 |
| 通用 `assets` 服务 | `REFACTOR` | 通用媒体索引有价值，但字段契约与 schema 已漂移 | 定义真实 Asset schema；与角色/场景/道具的关系只做引用，不重复所有元数据 |
| `assetService.update` 当前字段白名单 | `REPLACE` | 会对不存在的列发 SQL，是确定性错误 | 用 schema/DTO 驱动白名单并加契约测试 |
| `episodeCharactersExtract` stub | `REPLACE` | 返回成功空结果属于危险假成功 | 接真实提取服务；未就绪时返回明确 501/能力不可用 |
| `routes/stub.js` 其他处理器 | `REMOVE` | 未挂载且会误导维护者 | 确认无动态引用后移除 |
| `routes/index.js` 组合根 | `REFACTOR` | 装配职责必要，但同时启动恢复、连接跨域回调、构造大量服务 | 按 domain module 注册，生命周期单独为 application runtime |
| 本地文件存储 | `KEEP` | 符合本地桌面产品定位，路径冻结标签利于可读性 | 增强原子写、垃圾回收和路径引用审计 |
| DB + 文件双写方式 | `REFACTOR` | 当前无统一提交/补偿语义 | 使用 staging + commit/compensation journal，先覆盖导入和生成落盘 |

## 4. 生成与任务系统

| 模块 | 分类 | 原因 | 迁移/增强重点 |
|---|---|---|---|
| 图像 generation/task/batch 模型 | `KEEP` | 状态、批次、审核和候选结构完整 | 增加批次取消、后端队列 lease 和统一观测接口 |
| `imageService` 领域落盘 | `REFACTOR` | 引用、下载和实体绑定价值高，但文件较大且混合职责 | 分为 request orchestration、artifact persistence、entity binding |
| `imageClient.js` 协议分支 | `REFACTOR` | 已覆盖多供应商，不宜推倒；协议边界应独立测试 | 每协议 adapter，统一 capability/request/result/error DTO |
| 统一视频生命周期 | `KEEP` | 配置快照、恢复、候选、选择语义成熟 | 作为所有视频 provider 的唯一 application API |
| Workflow Provider Registry | `ENHANCE` | 方向正确，但目前主要只有 ComfyUI | 逐个把 legacy provider 迁入，增加 capability contract tests |
| `videoClient.js` | `REFACTOR` | 4,000 余行、多协议混合；但包含大量兼容知识，直接重写风险高 | 以现有测试锁定行为，按协议渐进抽 adapter，最终缩成 facade |
| Legacy video adapter | `REMOVE`（最终） | 过渡期有用，长期会维持双架构 | 仅在所有供应商进入 registry 后移除，当前不能直接删 |
| 通用 `async_tasks` 执行器 | `REPLACE` | 不可真正取消、重启只会失败，不适合一键长流程 | 用持久化 job runner/lease/step checkpoint 替代；保留 API 兼容层迁移 |
| 通用任务表历史 | `KEEP` | 现有项目需要历史可读 | 只读保留或迁入统一 job 表，不能直接删除 |
| 视频超分 job/segment | `KEEP` | 分段、恢复、轮询、重试、跳过和验证设计完整 | 抽 provider 接口，减少对单一 Zealman 协议依赖 |
| Director job/artifact/candidate 模型 | `ENHANCE` | “生成—评审—选择”是正确制作语义 | 稳定状态机、中文化 UI、补真实项目验收与 artifact GC |
| Director timeline | `EXPERIMENTAL / ENHANCE` | 架构价值存在，但使用证据弱、产品契约未稳定 | 继续隔离实验标志，不并入核心数据迁移前先验证 |
| H3 prompt drafts | `ENHANCE` | 保存来源、指纹、人工编辑和语义确认，追溯性好 | 将模型专属字段封装为 versioned prompt compiler contract |
| FFmpeg 后期服务 | `KEEP` | 本地可控、功能闭环，是桌面产品关键基础设施 | 统一进程取消、超时、stderr 解析和产物 manifest |
| 进程内 GPU mutex | `ENHANCE` | 单桌面进程足够简单有效 | 明确仅单进程保证；如果引入 worker 再迁为持久化 lease |

## 5. 数据层

| 模块 | 分类 | 原因 | 迁移/增强重点 |
|---|---|---|---|
| SQLite | `KEEP` | 适合本地单用户、部署简单、测试成熟 | 显式固定 FK pragma；新增外键/索引前先清理孤儿并做升级演练 |
| 当前 migration runner | `REPLACE` | 无台账、全量重放、字符串容错，无法证明升级路径 | 引入 ledger、事务、checksum、一次性 baseline 和版本升级测试 |
| `ensureAllColumns()` | `REMOVE`（迁移后） | 与 SQL migration 双重定义 schema | 在新 ledger 覆盖所有安装后逐步删除；当前不能先删 |
| Drama/Episode/Storyboard 表 | `KEEP` | 稳定主干 | 增补索引、外键和约束，避免破坏现有 id |
| `storyboards` 宽表 | `REFACTOR` | 当前性能与读取方便，但职责持续膨胀 | 只拆高变化子文档/关系；保留镜头核心字段 |
| `dramas.metadata` | `REFACTOR` | 兼作多类业务存储，无 schema version | 定义版本化文档并拆 workflow groups 等业务对象 |
| 生成 snapshot JSON | `KEEP` | 对复现与审计必要 | 明确不可变，保存 schema version/hash |
| `storyboards.characters` JSON | `REPLACE` | 与两张关系表并存，是关联漂移源 | 选定结构化关联表为权威，提供双读/回填/核对迁移 |
| `storyboard_characters` 当前表 | `REFACTOR` | 模型方向合理但当前实库未使用 | 与 variant 关联整合设计后再决定复用，不直接删除 |
| `external_generation_*` 明细模型 | `KEEP` | attempt/event/idempotency/result 对网页自动化很有价值 | 修复 job 聚合状态投影，增加一致性测试 |
| `external_generation_jobs.status` 当前更新方式 | `REPLACE` | 当前没有更新，已产生实库漂移 | 从事件投影或事务性状态机维护 |
| 明文 `ai_service_configs.api_key` | `REPLACE` | 本地仍不应通过通用 API/日志暴露完整凭证 | OS credential vault 或加密存储；先做 API 脱敏和导出隔离 |

## 6. 桌面、扩展与外部适配

| 模块 | 分类 | 原因 | 迁移/增强重点 |
|---|---|---|---|
| Electron 桌面壳 | `KEEP` | 与本地 SQLite、文件和 FFmpeg 定位一致，loopback 监听合理 | 增加打包 smoke test、版本显示和错误恢复 |
| 用户数据目录迁移 | `KEEP` | 保护既有用户数据 | 给每次迁移加备份/日志/校验 |
| 开发态复制 `desktop/backend-app` | `REPLACE` | 解决 ABI 的动机真实，但运行副本可与源码漂移 | 固化 Node ABI 和 native rebuild；通过打包脚本产生临时 artifact，不检入/长期复用副本 |
| 独立后端默认 `0.0.0.0` | `REPLACE` | 无认证下违反本地安全模型 | 默认 `127.0.0.1`；远程监听必须显式配置认证与 TLS |
| 全局 `insecure_tls` | `REMOVE` | 影响进程内所有 HTTPS，边界过宽 | 用测试证书或单 provider 受控 agent 替代 |
| 浏览器扩展消息协议/outbox | `KEEP` | 对易丢失的 DOM 自动化做了幂等和恢复，测试良好 | 版本化消息协议，监控第三方 DOM 变化 |
| ChatGPT content-script 自动化 | `ENHANCE` | 产品价值存在，但天然脆弱 | 保持实验开关、能力探测和失败可解释性 |
| `external-bridge` | `ENHANCE` 或隔离 | 小而清晰，有 token/job package 能力；主应用尚未消费 | 先决定唯一外部桥架构；若不用则独立归档，不与扩展协议重复发展 |
| OpenClaw skill 文档 | `REPLACE` | 大量路由和请求体已失效 | 从真实 OpenAPI/契约测试生成；未修复前明确标记不可用 |
| Checked-in `content.bundle.js` | `ENHANCE` | 扩展运行需要构建产物，但易与源漂移 | CI 重新构建并验证无 diff，不手工维护 |

## 7. 配置、API 与工程

| 模块 | 分类 | 原因 | 迁移/增强重点 |
|---|---|---|---|
| `/api/v1` 资源路由 | `KEEP` | 已被前端和扩展广泛使用 | 保持 URL 兼容，新增版本化 schema/contract |
| 手写前端 API 客户端 | `REPLACE`（渐进） | 已出现不存在路由、参数丢失和响应不一致 | 建 OpenAPI 或共享 runtime schema，逐域生成/校验客户端 |
| `{success,data}` 响应包 | `KEEP` | 已成为大多数前端调用契约 | 所有错误统一 `{success:false,error:{code,message,details}}` |
| 非标准 `{error}` 路径 | `REPLACE` | 拦截器无法正确取消息 | 统一错误中间件 |
| YAML 配置加载器 | `KEEP` | 默认值、搜索路径和桌面覆盖实际有用 | 加 schema 校验、版本显示、敏感字段隔离 |
| 版本号分散 | `REFACTOR` | config 1.0.0 与 package 1.2.8 漂移 | 构建时注入单一版本源 |
| 子项目测试集 | `KEEP` | 数量和覆盖均是重要资产 | 加根级编排、前端 `test` script、覆盖率与 E2E |
| Node `>=18` 宽泛声明 | `REPLACE` | native module ABI 使其无法表达真实兼容性 | 明确支持 LTS、lockfile/预编译策略和 Electron ABI |
| `console.*` 日志 | `REPLACE` | 无结构化上下文且已泄密 | 结构化 logger、敏感字段 redaction、任务/request correlation id |
| 乱码文案 | `REMOVE` | 无产品价值，降低错误可理解性 | 固定 UTF-8 检查与测试，替换 `????` 分支 |

## 8. 不应复用的模式

以下模式不应在新模块中继续复制：

- 在页面组件中直接实现跨步骤任务调度；
- 用一个 JSON metadata 字段承载新的有生命周期业务对象；
- 为每个供应商在巨型 client 中追加 `if/switch` 分支；
- 用“返回成功 + 空数组”代替未实现能力；
- 让 Pinia store 同时负责状态、定时器、外部副作用和 UI 通知；
- 在没有 ledger 的情况下靠启动时重复执行 DDL 修复 schema；
- API 返回完整密钥，或在日志中打印配置对象；
- 在 DB 写入成功后再无补偿地写/删文件；
- 为新入口复制一套角色/场景/道具编辑器和任务轮询逻辑。

## 9. 推荐的渐进演进顺序

### 阶段 A：保护现状

- 密钥脱敏、日志清理、loopback 默认、TLS 边界修正；
- 冻结并记录当前 schema，建立 migration ledger；
- 为已知 BROKEN API 加契约测试；
- 建立项目包往返与历史库升级样本。

### 阶段 B：统一契约

- 统一 API 成功/错误 DTO；
- 定义任务状态公共词汇和 provider capability schema；
- 选定分镜角色、选中媒体和 external job 状态的权威源；
- 以兼容 adapter 保持现有前端 URL。

### 阶段 C：拆分实现

- 先按 FilmCreate 七阶段抽 application modules，再拆视觉组件；
- 按供应商把 image/video client 拆为 adapter；
- 从 `routes/index.js` 提取生命周期 runtime；
- 将 Pinia 中的队列/轮询器变成显式可启动的 service。

### 阶段 D：清理遗留

- 删除 FreeCreate 旧实现、unused queue、未挂载 stub；
- legacy provider 全迁入 registry 后移除 adapter；
- 所有安装迁入新 migration ledger 后移除 `ensureAllColumns()`；
- 决定 external-bridge 与浏览器扩展桥的唯一长期边界。

## 10. 结论

最值得复用的是领域模型和生产闭环：项目—剧集—分镜、资产一致性、生成快照、视频候选评审、超分恢复、FFmpeg 后期以及可携带项目包。最不值得复用的是实现上的多重事实源、巨型编排组件、全局副作用 store、无台账迁移和巨型供应商分支。

因此建议采取“保留产品语义、渐进替换基础契约”的路线，而不是整体重写。整体重写会同时失去大量供应商兼容知识、历史数据容错和已由 1,264 项测试保护的行为。
