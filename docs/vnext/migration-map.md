# LocalMiniDrama VNext Migration Map

## 1. 使用方式

本表是 Current 到 Transition 再到 Target 的可追踪清单。`Authority` 表示迁移过程中谁可以写；`Exit gate` 表示何时可以停止兼容。没有列入 Exit gate 的 Legacy 文件不得因为“新页面已经出现”而删除。

阶段编号与 `migration-architecture.md` 一致：M0–M8。

## 2. 顶层能力地图

| Current | Transition | Target | 阶段 | 最终决策 |
|---|---|---|---|---|
| Vue 页面直接编排 API/store | Legacy 页面 + VNext route 并存 | Stable Shell + feature Commands/Queries | M2–M7 | REFACTOR |
| `/api/v1` 手写资源路由 | v1 facade 与 v2 并存 | v2 application API；必要 v1 长期兼容 | M1–M8 | KEEP + ADAPT |
| `routes/index.js` 同时装配和启动 runtime | lifecycle bootstrap + domain routers | composition root 只装配模块 | M1–M6 | REFACTOR |
| 多套任务表/状态 | LegacyJobAdapter + canonical projection | durable Job/Attempt/Batch runtime | M1、M6 | REPLACE（渐进） |
| 巨型 image/video client | LegacyProviderAdapter | provider registry + capability contract | M1、M6 | REFACTOR |
| SQLite + 反复 DDL 补列 | ledger + legacy runner 共存 | ledger-only forward migrations | M0–M8 | KEEP DB / REPLACE runner |
| DB 与文件松散双写 | staging/journal 先覆盖新 flow | atomic artifact commit/reconcile | M4–M7 | REFACTOR |
| 本地 FFmpeg/Electron | LocalToolAdapter，壳不变 | Film Delivery infrastructure | M6–M7 | KEEP |
| 扩展/外部桥 | 可选 Legacy Adapter | versioned ExternalWeb port | M8 | KEEP / ISOLATE |

## 3. 前端页面与组件迁移

| Current 文件 | Transition 做法 | Target 归属 | 阶段 | Exit gate / rollback |
|---|---|---|---|---|
| `frontweb/src/App.vue` | 仅增加 flag-aware outlet/全局任务挂点 | `vnext/app/VNextApp.vue` + AppShell | M2 | Shell 默认稳定后再收敛；flag off |
| `frontweb/src/router/index.js` | 保留全部旧路由，新增 `/vnext/...` | 分模块 route records 与 legacy redirects | M2–M8 | 深链/书签测试通过；恢复旧 route table |
| `frontweb/src/views/FilmList.vue` | 旧首页继续可用；VNext Projects 只读后逐项接 command | ProjectsPage + Asset/Settings 入口 | M2–M4 | 项目 CRUD/导入导出等价；`vnext.shell=off` |
| `frontweb/src/views/DramaDetail.vue` | 保留剧集 CRUD/导入；VNext ProjectDetail 并行 | ProjectDetailPage | M2–M4 | 剧集生命周期与包导入回归通过 |
| `frontweb/src/views/FilmCreate.vue` | 不搬空、不重写；按 Script/Setup/Storyboard/Film 路由逐阶段替代 | StudioShell + 四个 feature pages | M3–M7 | 四阶段逐项 exit；每项 flag 独立回切 |
| `frontweb/src/views/DramaCanvas.vue` | 继续作为 Legacy/P2；先让部分动作走共享 command | SetupCanvas/StoryboardCanvas projection | M5、M8 | command parity + layout migration 通过 |
| `frontweb/src/views/AiConfig.vue` | 复用当前配置能力，VNext Settings 调同一 query/command | Settings/ProviderConfigPage | M2、M6 | 全 Provider 字段、测试、预设无损 |
| `frontweb/src/components/AIConfigContent.vue` | 先包成 LegacyProviderConfigPanel，再按 schema 拆 | schema-driven provider sections | M6 | 每 provider 契约与表单状态通过 |
| `frontweb/src/components/video/VideoGenerationPanel.vue` | 作为 Legacy panel；新 Shot 页面通过 adapter 调相同 lifecycle | ProviderParameterBar + CandidateResultPanel | M5–M6 | 参数/模式/恢复/选择 parity |
| `frontweb/src/views/MediaLibrary.vue` | 不直接复用损坏契约；修复 schema 后接入 | AssetCenterPage | M4 | 上传、搜索、回收、引用完整性通过 |
| `frontweb/src/views/FreeCreate.vue` | 保留但不作为迁移入口 | 不进入 VNext；未来共享 Quick Generate 可另立项 | M8 | 使用证据为零且无引用后移除 |
| `frontweb/src/components/CharacterVariantStudio.vue` | 复用变体行为并切 Application API | AssetVariantEditor | M4 | current/variant authority 测试通过 |
| `frontweb/src/components/SceneModelMap.vue` | 作为 provider/model routing extension | Capability/ModelRouting settings | M6 | 新能力路由覆盖旧映射 |
| `frontweb/src/components/PromptEditor.vue` | 保留为 shared editor，移出具体页面编排 | PromptEditor primitive/feature extension | M3–M5 | 键盘、dirty、save 状态测试通过 |
| `frontweb/src/components/EpisodePackageImportDialog.vue` | 复用预览/导入，改用 package command | PackageImportDialog | M2–M4 | v1.1 fixture round-trip 通过 |
| `frontweb/src/components/ExternalAiCollaborationDialog.vue` | 继续隔离实验入口 | ExternalWeb/Package extension | M8 | 协议版本和恢复测试通过 |
| `frontweb/src/components/imageGeneration/*` | 新 UI 先消费 LegacyJob projection；逐步移除 store runtime | Generation drawer/task primitives | M4–M6 | image jobs 原生化、通知无重复 |
| `frontweb/src/components/dramaCanvas/*` | 不复制领域规则；逐 action 接共享 commands | Canvas renderers/panels only | M8 | 标准页与 Canvas command parity |
| `frontweb/src/components/episode/AudioPlanPanel.vue` | 复用 AV 规划能力 | Film audio planning extension | M7 | 合成/音频回归通过 |

## 4. 前端状态、Composable 与 API 迁移

| Current | Transition Adapter | Target | 阶段 | 风险控制 |
|---|---|---|---|---|
| `stores/film.js` | LegacyProjectQueryAdapter | server projection + local view state | M2–M4 | 不一次迁完整 store；逐 selector 比对 |
| `stores/generationTaskStore.js` | `LegacyJobObserver` 读取并归一状态 | JobObserver + query cache | M1、M6 | 先移通知，再移 polling，再移写入 |
| `stores/imageGenerationStore.js` | queue runtime 保留，UI 只读 projection | 后端 Job/Batch runtime | M1、M6 | runtime owner 固定，防双提交 |
| `composables/useGenerationTaskSync.js` | canonical DTO facade | JobObserver subscription | M1、M6 | timeout/failed 语义 characterization |
| `composables/imageGenerationFacade.js` | LegacyImageCommandAdapter | submitGeneration command | M4–M6 | 幂等键与重复点击测试 |
| `composables/useImageGeneration.js` | 封装成旧实现 adapter | Generation application client | M4–M6 | 结果选择不自动覆盖 |
| `composables/useVideoGenerationPanel.js` | 保留协议知识，逐 selector/action 抽出 | shot generation controller | M5–M6 | 1,320 行行为先锁定测试 |
| `composables/filmCreate/useCharacters.js` | Asset command facade | Setup character feature | M4 | 旧字段 write-through |
| `composables/filmCreate/useScenes.js` | Asset command facade | Setup location feature | M4 | 场景/镜头同名模型不得混淆 |
| `composables/filmCreate/useProps.js` | Asset command facade | Setup prop feature | M4 | library source provenance |
| `composables/filmCreate/useCharacterVariants.js` | Variant command facade | AssetVariant application service | M4 | default/current authority |
| `utils/dramaCanvasAdapter.js` | 仅保留 projection mapping | Canvas query adapter | M5、M8 | 禁止新增业务规则 |
| `utils/canvasWorkflow.js` | versioned metadata adapter | WorkflowGroup document/repository | M8 | schema version + round-trip |
| `utils/videoLifecycleStatus.js` | canonical status translator | shared JobStatus | M1、M6 | 全状态真值表 |
| `utils/imageGenerationTaskState.js` | canonical status translator | shared JobStatus | M1、M6 | partial/cancel_requested 补齐 |
| `api/*.js` | 域级 legacy client + v2 client 并存 | contract client generated/validated at runtime | M1–M8 | 每迁一个 endpoint 才移旧函数 |
| `utils/request.js` | 同时支持 v1/v2 envelope | single transport + error mapper | M1 | 错误消息、取消、超时回归 |

## 5. 后端组合根、路由与 Application 迁移

| Current 文件/路由域 | Transition | Target 模块 | 阶段 | Exit gate |
|---|---|---|---|---|
| `src/app.js` | 同时挂 `/api/v1`、`/api/v2`，加入 readiness | app bootstrap | M0–M1 | v2 独立健康、v1 不变 |
| `src/server.js` | 安全默认和 lifecycle shutdown | process host | M0–M1 | loopback/TLS/shutdown 测试 |
| `src/routes/index.js` | 路由注册保留；runtime 构造移到 bootstrap | composition root | M1–M7 | 文件只装配，不启动跨域副作用 |
| `routes/drama.js` + drama handlers | v1 facade 调 ProjectEpisode application service | ProjectEpisode API | M1–M4 | CRUD/导入导出 contract parity |
| `routes/characters.js` | v1 facade + AssetIdentity adapter | AssetSetup API | M4 | variant/library/current media parity |
| `routes/scenes.js`、`routes/prop.js` | v1 facade + 类型专属 adapter | AssetSetup API | M4 | 字段与提取行为 parity |
| `routes/*Library.js` | 旧 URL 映射 canonical library query | AssetCenter API | M4 | source/provenance/删除规则通过 |
| `routes/storyboards.js` | v1 facade；保留所有 H3/prompt action | Shot API + provider extensions | M5–M6 | Shot Package 全字段无损 |
| `routes/images.js`、`imageGenerationTasks.js` | 读 canonical projection，写按 job-kind flag | Generation API | M6 | batch/candidate/select/recovery |
| `routes/videos.js` | 继续调用 unified service；外层适配 v2 | Generation API | M5–M6 | 所有 video mode 与 provider 测试 |
| `routes/videoMerges.js`、`audio.js` | 包装为 Delivery commands | FilmDelivery API | M7 | 输出、音轨、字幕、水印 parity |
| `routes/videoUpscale.js` | Legacy Job Adapter 后切 native job step | FilmDelivery/PostProcess | M6–M7 | segment recover/retry/skip parity |
| `routes/director.js` | 保持 experimental；candidate/timeline projection 接入 | Generation/Film extensions | M6–M8 | candidate/timeline 契约稳定 |
| `routes/externalGeneration.js` | Legacy Job Adapter；协议继续版本化 | ExternalWeb Adapter | M6、M8 | extension recovery/idempotency |
| `routes/episodePackage.js` | facade 调 Package application service | Package API | M1–M4 | 所有 fixture 往返无损 |
| `routes/settings.js`、`aiConfig.js` | secret-redacted v1 + v2 contract | Settings/ProviderConfig | M0、M6 | 全字段/凭证引用/能力测试 |
| `routes/stub.js` | 明确 501 或不挂载，不返回假成功 | 无 | M0、M8 | 引用扫描为零后删除 |

## 6. 后端服务迁移

| Current 服务 | Transition Wrapper | Target Port/Service | 阶段 | 最终动作 |
|---|---|---|---|---|
| `dramaService.js` | ProjectRepositoryAdapter | ProjectEpisodeService | M1–M4 | KEEP |
| `projectDeletionService.js` | deletion plan + artifact tombstone | ProjectLifecycleService | M4–M7 | ENHANCE |
| `dramaImportService.js` / `dramaExportService.js` | PackageVersionAdapter | PackageService | M1–M4 | KEEP |
| `episodePackage*.js` | canonical PackageManifest mapping | PackageService | M1–M4 | KEEP |
| `episodeImportProvenanceService.js` | ProvenanceRepositoryAdapter | ProvenanceService | M3–M4 | KEEP |
| `character*Service.js` | CharacterAssetAdapter | AssetIdentity/Variant service | M4 | REFACTOR |
| `scene*Service.js` | LocationAssetAdapter | AssetIdentity service | M4 | REFACTOR |
| `prop*Service.js` | PropAssetAdapter | AssetIdentity service | M4 | REFACTOR |
| `assetService.js` | schema-correct LegacyMediaAdapter | Artifact/Asset index service | M4 | REPLACE broken update path |
| `storyboardService.js` | ShotRepositoryAdapter | ShotService | M5 | KEEP + ENHANCE |
| `storyboardCanonicalRepository.js` | 直接实现 Shot read port | ShotRepository | M5 | KEEP |
| `storyboardAvContractService.js` | ShotRevision AV mapper | ShotPackagePolicy | M5 | KEEP |
| `referenceSlotService.js` / `referenceRegistry.js` | ReferenceBindingAdapter | ReferenceService | M5 | KEEP + ENHANCE |
| `framePromptService.js` / prompt compilers | versioned compiler extension | PromptCompilerPort | M5–M6 | KEEP |
| `styleRegistryService.js` / project style | StyleSpec adapter | StyleService | M4 | KEEP |
| `imageGeneration*Service.js` | LegacyImageJobAdapter | Job/Batch/Candidate service | M1、M6 | KEEP behavior, migrate runtime |
| `imageService.js` | split behind ports | Request/Artifact/Binding services | M4–M6 | REFACTOR |
| `imageClient.js` | LegacyImageProviderAdapter | per-protocol provider adapters | M1、M6 | REFACTOR incrementally |
| `unifiedVideoGenerationService.js` | 实现 canonical video job adapter | GenerationService | M5–M6 | KEEP |
| `preparedVideoGenerationService.js` | Shot package → generation request mapper | GenerationPreparationService | M5–M6 | KEEP |
| `videoService.js` | v1 facade | GenerationService | M6 | 收缩为 adapter |
| `videoClient.js` | LegacyVideoProviderAdapter | per-provider adapters | M1、M6 | REFACTOR incrementally |
| `videoProviders/*` | 扩展通用 capability/result contract | ProviderRegistry | M6 | KEEP |
| `taskService.js` | LegacyAsyncJobAdapter | JobRuntime | M1、M6 | REPLACE runtime, KEEP history |
| `director/*` | DirectorJob/Candidate/Timeline adapters | Generation/Film extensions | M6–M8 | ENHANCE |
| `h3*Service.js` | provider extension + versioned snapshot | H3PromptCompiler extension | M5–M8 | KEEP |
| `externalGeneration*Service.js` | ExternalJobAdapter | ExternalWeb port | M6、M8 | KEEP + ISOLATE |
| `videoUpscale/*` | UpscaleJobAdapter | PostProcessJobHandler | M6–M7 | KEEP |
| `videoMergeService.js` | LocalToolJobAdapter | DeliveryPipeline | M7 | KEEP + REFACTOR |
| `episodeAudio*Service.js` / `ttsService.js` | Local/Provider job handlers | Film audio pipeline | M6–M7 | KEEP |
| `storageLayout.js` / upload | ArtifactStoreAdapter | ArtifactService | M4–M7 | KEEP + ENHANCE |

## 7. 数据迁移地图

### 7.1 保持 identity 的 Current 表

| Current 表 | Target 含义 | Authority 迁移 | 阶段 |
|---|---|---|---|
| `dramas` | Project | 始终权威；只补版本/索引 | M0–M2 |
| `episodes` | Episode | 始终权威；脚本内容转 projection | M0–M3 |
| `storyboards` | Shot identity + Legacy current projection | ID 始终权威；高变化内容逐步由 ShotRevision 权威 | M3–M5 |
| `characters` | Character identity 的物理来源 | M4 后由 Asset service 管理，ID 不变 | M4 |
| `character_variants` | AssetVariant | 直接适配，补 authority 规则 | M4 |
| `scenes` | Location identity 的物理来源 | 直接适配，避免与 StoryScene 混淆 | M4 |
| `props` | Prop identity 的物理来源 | 直接适配 | M4 |
| `custom_styles` | StyleSpec | 直接适配 | M4 |
| `assets` | 通用 Artifact/媒体索引的 Legacy 表 | schema 修复后过渡；最终由 artifact 表权威 | M4–M7 |

### 7.2 新增的扩展表

| 目标表 | 来源/回填 | Authority switch | 不可逆动作 |
|---|---|---|---|
| `schema_migrations` | 现有 migration 文件 checksum + schema baseline | M0 立即 | 无；只追加 |
| `script_revisions` | episode/storyboard 现有脚本文本生成 revision 0 | M3 Script flag 开启 | 不删原文本 |
| `story_scenes` | 已解析脚本/分镜顺序 | M3 approval 后 | 不重编号 Shot ID |
| `stage_approvals` | 初始状态由可用数据推导，标记 `inferred` | M3 | 推导记录不可冒充用户批准 |
| `invalidation_records` | 新 command 产生；旧数据不伪造 | M3 | 只追加/resolve |
| `asset_merge_decisions` | Setup Merge Preview | M4 | merge 前可撤销，merge 后保留 provenance |
| `voice_profiles` / `style_bindings` | 旧字段与配置映射 | M4 | 旧字段先 write-through |
| `shot_revisions` | `storyboards` 宽表快照为 revision 0 | M5 | 不删宽表字段 |
| `reference_bindings` | JSON + 关系表 + slots 归一化 | M5 双读 diff 归零后 | 旧 JSON 至少保留一个稳定窗口 |
| `generation_jobs` / `generation_attempts` | 新 Job 原生写；旧 Job 动态投影，不伪造历史 | M6 按 kind | 旧任务表只读归档 |
| `generation_batches` | image batches 映射；新 batch 原生写 | M6 | 保留旧 batch ID 映射 |
| `media_candidates` / `candidate_selections` | image/video/director 结果映射 | M6 | 切换后 write-through current URL |
| `artifacts` / `artifact_commits` | 已引用文件 lazy register + hash | M4–M7 | 不自动搬迁用户文件 |
| `timeline_revisions` | director timeline / episode order | M7 | 导入记录标明 inferred |
| `picture_locks` | 仅用户显式锁定；不从旧数据猜测 | M7 | lock 不可改，只能 supersede |
| `deliveries` / `delivery_artifacts` | 旧 merge 可导入为 legacy delivery | M7 | 不移动旧成片路径 |

### 7.3 多重事实源收敛

| 冲突 | Transition 读法 | Target authority | 差异处理 |
|---|---|---|---|
| `storyboards.characters` JSON vs relations | 双读并记录 entity/variant diff | `reference_bindings` | 阻止 authority switch，不静默选一边 |
| entity image URL vs generation result | 旧 current 继续展示，候选单列 | `candidate_selections` | 显式选择后 write-through |
| external job row vs events/results | 由 adapter 重算聚合状态 | `generation_job` + attempts/events | 不修改历史事件，修正 projection |
| drama metadata workflow groups | versioned document adapter | 独立受控 document/repository | schemaVersion 不认识时只读 |
| DB media URL vs local file | hash/probe manifest 核对 | `artifacts` | 标记 missing/corrupt，禁止伪成功 |

## 8. Job 状态映射

| Current 状态族 | Canonical 状态 | 说明 |
|---|---|---|
| draft/new | DRAFT | 未提交，不占 runtime |
| pending/queued | QUEUED | 已持久化待执行 |
| processing/running/submitted | RUNNING 或 WAITING_EXTERNAL | 是否等待外部轮询由 Attempt stage 表达 |
| cancel_requested | CANCEL_REQUESTED | 不是终态 |
| cancelled/canceled | CANCELLED | 已确认停止 |
| completed/success/succeeded | SUCCEEDED | 必须存在合法 result/artifact 或允许无产物的 job kind |
| failed/error | FAILED | 保存稳定 error code 和 retryability |
| batch mixed results | PARTIAL_SUCCESS | 仅 Batch 聚合终态 |
| startup orphan | RUNNING/WAITING_EXTERNAL + reconcile | 不再一律转 FAILED |

映射必须保存 `rawStatus` 和 `sourceRuntime`，以便诊断；未知状态映射为 `UNKNOWN` 只读投影，不能自动提交后续步骤。

## 9. Provider 迁移地图

| 能力族 | Current | Transition | Target / 顺序 |
|---|---|---|---|
| Text | `aiClient.js` + config routing | LegacyTextProviderAdapter | 按 OpenAI-compatible / vendor protocol 拆，M6 |
| Image | `imageClient.js`：OpenAI-compatible、Volc、DashScope、Nano Banana、Kling、Gemini 等 | LegacyImageProviderAdapter + capability probe | 先覆盖主用 provider，逐个切 flag，M6 |
| Video | `videoClient.js` + unified lifecycle：Jimeng、xAI、DashScope、Gemini/Veo、Vidu、Kling/Omni、Volc Omni、Sora、Agnes、MiniMax H3 等 | LegacyVideoProviderAdapter | unified lifecycle 保持，protocol adapters 逐个迁，M6 |
| ComfyUI | workflow registry/provider/client | 直接实现 canonical port | 首个原生 Provider 样板，M5–M6 |
| TTS | `ttsService.js`（MiniMax/OpenAI-compatible） | LegacyTtsProviderAdapter | audio job handler，M6–M7 |
| Upscale | Zealman runtime + ComfyUI possibilities | UpscaleJobAdapter | PostProcess capability，M6–M7 |
| External web | browser extension/outbox + external generation | LegacyExternalProviderAdapter | P2 versioned adapter，M8 |

每个 Provider 的迁移单位是 `providerId + model/protocol family`，不是整个巨型文件。切换门禁包含 capability、request snapshot、submit、poll、cancel、result normalization、error normalization、reconcile 和可选 live smoke。

## 10. 文件、桌面与包迁移

| Current | Transition | Target | 阶段/回滚 |
|---|---|---|---|
| `backend-node/data/*.db` | 启动前同目录版本化备份 | ledger-managed SQLite | M0；恢复备份前先停服务 |
| `data/storage` 与 URL/local_path | lazy register，不批量搬迁 | ArtifactStore + hash manifest | M4–M7；旧路径 resolver 保留 |
| director artifacts | Artifact adapter，保持目录 | canonical Artifact lifecycle | M6–M8；关闭 adapter 即回切 |
| 临时下载/参考素材 | staging + TTL reconcile | artifact staging area | M4–M6；journal 清理 |
| drama ZIP / episode package | version adapters + golden fixtures | versioned PackageManifest | M1–M4；旧 reader 长期保留 |
| Electron `desktop/main.js` | 只改启动/健康/备份接线 | target host | M0–M8；打包 smoke 回切 |
| browser extension | 协议版本不变，新增 capability negotiation | ExternalWeb optional adapter | M8；禁用扩展不影响核心 |
| `external-bridge` | 隔离评估，不并入主启动 | 可选唯一 bridge 或归档 | M8；没有主流程依赖 |

## 11. Migration Completion Matrix

每个域用以下状态跟踪，而不是用“页面看起来完成”判断：

| 域 | Contract | Read Adapter | Backfill | Diff=0 | Write Authority | Legacy Exit | 当前计划阶段 |
|---|---:|---:|---:|---:|---:|---:|---|
| Project/Episode | M1 | M1 | 不需要 | M2 | existing tables | M4+ | M1–M4 |
| Script | M3 | M3 | M3 | M3 | ScriptRevision | M5+ | M3 |
| Asset/Setup | M4 | M4 | M4 | M4 | Asset services/current selection | M6+ | M4 |
| Shot/Reference | M5 | M5 | M5 | M5 | ShotRevision/ReferenceBinding | M7+ | M5 |
| Job/Batch | M1 | M1 | 不批量伪造 | M6 | per-kind canonical runtime | M8+ | M1、M6 |
| Candidate/Artifact | M4–M6 | M4 | lazy | M6 | CandidateSelection/Artifact | M8+ | M4–M7 |
| Provider | M1 | M1 | 不适用 | per provider | Registry adapter | per provider | M1、M6 |
| Timeline/Delivery | M7 | M7 | optional import | M7 | Timeline/PictureLock/Delivery | M8+ | M7 |
| Package/Provenance | M1 | M1 | 不适用 | M4 | versioned package service | reader retained | M1–M4 |

任何一列未完成，都不得把该域标为“迁移完成”。
