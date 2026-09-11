# Changelog

所有版本的重要改动记录在此文件中，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)。

**官方仓库：**
[![GitHub](https://img.shields.io/badge/GitHub-xuanyustudio%2FLocalMiniDrama-181717?logo=github)](https://github.com/xuanyustudio/LocalMiniDrama)
[![Gitee](https://img.shields.io/badge/Gitee-bi__shang__a%2Flocalminidrama-C71D23?logo=gitee)](https://gitee.com/bi_shang_a/localminidrama)

---

## [未发布]

> 尚未发布的功能、优化和问题修复统一记录在本节。发布新版本时，将对应条目移动到带有版本号和发布日期的章节中。

### 新增

- **V2.1 前端全面对齐 35 张设计稿（R2 轮次）**：以 `docs/design/v2.1-ui/` 的 35 张高保真设计稿（23 页面 + 12 容器）为视觉基准，前端全面改造为深色专业创作工作台——设计令牌全局接入（`.v21-root` 作用域，不影响旧页浅色主题）、全局 Rail 与 43 项 SVG 图标、全部 canonical 页面与容器按稿重建（项目列表大封面卡 / 新建项目来源卡 / 概览 Hero+待处理+四阶段汇总 / 剧集四阶段单元格 / 剧本三栏+影响摘要+版本比较+历史抽屉 / 本集设定详情抽屉+音色抽屉 / 项目素材统计分组 / 分镜五区+生成 Sheet+批量预检+引用管理+素材预览+生成历史四抽屉 / 成片审片合片单屏 / 外部 AI 八步向导 / 任务中心三 Tab+详情抽屉 / 资产库+详情抽屉+用于项目 / 媒体库 / 自由创作 / 高级画布只读关系视图 / 归档导入三阶段 / 常规设置+工作区迁移向导 / 数据工具+物理清理 dry-run / AI 配置解析顺序链+三通道卡）；键盘合同（Ctrl+S / [ ] 切镜）、确认影响摘要、预计素材变化、下游影响、批量预检等交互合同同步落地
- **R2 后端补齐**：场次统计（字数/内外景/对白/建议）、确认预检（检查+预计素材变化+下游影响+修订链）、版本行级 diff（LCS）、阶段导航 meta（四阶段+完成度）、批量预检与三类批量动作、生成历史、任务重试、删除影响预检、自由创作 mock 端点等项目级端点
- **V2.1 正式迁移与切换（第六阶段）**：一次性迁移器在真实数据库副本演练通过后正式执行——冻结预检（活动任务阻断）、SQLite 备份（manifest+SHA-256）、单事务迁移（旧剧本→剧本版本、旧分镜→覆盖原时长单时段、旧 video_url→候选并标记采用）、逐项对账、journal 记录 COMMITTED；前端切换为 canonical 路由（`/projects...`，单集四阶段 `script|assets|storyboard|cut`），删除旧四阶段前制作页面与画布及其路由，不保留回退跳转
- **V2.1 Production Studio 前端**：全局 Rail（项目/资产库/任务/设置）、项目中心（列表卡片/新建/概览 Hero+编辑资料抽屉+画面风格中央弹窗三页签/剧集中心含新建直达空白剧本与导入·协作菜单）、单集四阶段 Studio（剧本三起点与场次结构、本集设定三 Tab 引用投影与进入分镜即时导航、分镜五区工作台含 H3 一等公民与视频候选采用、成片审片+合片单屏与导出 MP4·SRT）、外部 AI 制作 8 步独立向导页、任务中心聚合页
- **V2.1 集成验收（验收 A）**：新增端到端集成测试——真实 HTTP 应用覆盖两条核心剧本（业务主流程：项目→剧集→剧本→设定→分镜→成片→导出；外部 AI 回流：任务包→篡改拒绝→七项校验→五步导入→草稿与零媒体任务）与异常路径（409 冲突、快照失败守卫、任务幂等/取消/重试），mock 通道产出真实 PNG/MP4/SRT 文件
- **V2.1 剧本阶段（第三阶段）**：新增剧本版本化草稿（自动保存带 expected_revision 乐观锁，409 冲突不覆盖任一侧）、场次结构化解析（草稿保存即解析标题/内外景/地点/时间并可编辑）、AI 候选先比较后应用（无 Key 时为确定性本地候选）、"确认剧本/确认修改"批准语义（旧批准版标记取代而非删除，下游已批准阶段自动标记需要更新）、历史版本只读与复制为新草稿
- **V2.1 项目素材与本集设定（第三阶段）**：资料修订/媒体候选/当前图三类事实分离——生成只入候选（mock 通道产出真实图片文件，无 Key 可用）、点击候选即设为当前图并返回旧指针供撤销、已确认剧集快照不被静默改写；删除为回收站式（被分镜引用时列影响并阻断）；本集设定只投影本集引用的角色/场景/道具（assetId+stateId+mediaVersionId），mediaReadiness 状态条（检查中/已准备/有待处理项/快照失败/剧本未确认），进入分镜恒可导航且同一动作事务写入不可变素材快照（精确版本+媒体指纹，失败零部分写入），生成守卫在非就绪时禁用媒体提交并给唯一"去处理"入口

- **V2.1 项目与剧集中心 API（第二阶段）**：新增 `/api/v2` 影子路由——项目列表卡（上次工作精确恢复、健康摘要）、新建项目（只要名称/画幅/题材，自动应用安装默认风格，无任何时长字段）、项目概览聚合（Hero/风格/素材一行聚合/下一步）、资料编辑与"画面风格只影响之后的新生成"版本事件、回收站式项目删除与恢复；剧集中心支持新建直达空白剧本、全部/需要处理/制作中/已完成筛选、重命名、集序调整（冲突 409）、回收站式删除（列影响清单）与恢复
- **V2.1 制作包导入引擎（episode-package@2.1 唯一协议）**：字符串版本与未知字段严格拒绝（PACKAGE_SCHEMA_UNSUPPORTED/PACKAGE_VERSION_UNSUPPORTED/PACKAGE_SCHEMA_INVALID）、source_key 重复与引用未解析阻断、时码必须从 0 连续闭合到计划时长、台词不得越出时段；导入只允许创建新剧集或填充空白剧集，TARGET_NOT_BLANK 在预览与事务内双重检查、失败零部分写入；只写结构化草稿（剧本版本/场次/资产/分镜/时段），全程零媒体任务；同文件重复导入幂等拒绝并保留不可变审计记录
- **V2.1 外部 AI 制作向导后端**：独立可恢复 8 步向导 API——选择目标（非空剧集永不可写）、自动汇总上下文（只读）、补充说明（唯一可编辑字段）、任务包创建（package_id/assets_digest/上下文版本冻结，ZIP 与单文件 JSON 同源）、等待任务持久化、结果 JSON 八项校验（协议/包 ID/项目/剧集/素材摘要/映射/非空目标，篡改逐项拒绝）、确定性适配（新资产合并、人物状态追加）与统一五步导入；导入结果永远为草稿，不自动确认剧本、不创建任何图片/视频/音频任务

- **V2.1 制作工作室领域地基（第一阶段）**：后端新增 V2.1 领域事实源与应用 schema 版本 2.1.0——阶段内容状态（剧本/设定/分镜/成片）、剧本版本、叙事场次、分镜时段、本集素材引用与不可变集合快照、成片版本、Gate 豁免与项目风格版本事件等表随启动自动创建（全部增量、幂等，不改动既有数据）
- **V2.1 阶段状态机**：按状态真值表实现 not_started → in_progress → ready_for_review → approved → stale 的完整转换与拒绝路径，所有写入支持 expected_revision 乐观锁（409 REVISION_CONFLICT），每次转换落不可变事件；任务失败不再影响已批准状态
- **迁移备份与迁移日志**：新增 SQLite 备份服务（WAL checkpoint + manifest + SHA-256 清单与篡改校验）和迁移 journal（migration-state.json 原子写，PRECHECK→BACKED_UP→MIGRATING→VERIFYING→COMMITTED/FAILED 状态机；检测到未完成迁移时拒绝重跑并指引备份恢复），为 Phase 6 一次性正式迁移提供安全基础
- **确定性 mock 生成通道**：未配置任何 AI Provider Key 时，图片（真实 PNG）与视频（真实 MP4，无 ffmpeg 时明确降级）生成可用确定性本地通道完成，任务契约与真实 Provider 一致（输入/费用快照、幂等去重、取消保留记录、重试新 attempt），保障"无 Key 可运行"与集成测试确定性
- **分镜页引用管理、素材预览与多候选生成**：管理镜头引用升级为真实操作抽屉（按角色/场景/道具分组移除与添加，本镜场景不可移除，增删即时重排引用 chips 并令 H3 草稿标脏）；素材预览抽屉新增本集固定版本、素材库最新版本、出现时段与换绑最新版/跳转素材库操作；H3 生成视频确认抽屉支持选择 1–3 个候选数量，费用按数量乘算、任务并行提交、取消与重试逐任务执行
- **RunningHub 风格目录与可视化选择器**：新增后端唯一管理的 169 个 StyleSpec 风格，提供稳定 `style_id`、中文说明、真实英文模型提示词、分类检索、四列预览卡片、风格详情和自定义风格 CRUD；项目列表、项目详情、制作页与自由创作页统一使用同一选择器和项目风格摘要
- **统一图片/视频风格编译与审计快照**：新增语言解析、参考图注册、模型能力预检及图片/视频提示词编译器；角色、人物状态、场景（普通/四宫格/全景/俯视）、道具、分镜图片和镜头视频均在调用模型前冻结 StyleSpec 版本、最终提示词、负面词、参考图与校验结果
- **单集外部 JSON 来源查看**：剧集管理页为外部导入分集显示来源标识和“查看来源 JSON”入口，制作页集数选择器旁提供快捷入口；弹窗可对照原始 JSON、规范化结果与导入报告，并支持复制和下载原文
- **外部 AI 单集协作**：项目详情页新增“外部 AI 协作”入口；新会话可生成轻量剧情上下文，剧情确认后可按目标集生成包含任务说明、当前资产清单和返回 Schema 的 ZIP，并衔接返回 JSON 的预览导入
- **剧集音频策略与分镜音频编辑**：新增剧集级音频策略面板和分镜音频编辑能力，支持为每段视频生成 BGM，并明确对白、旁白与配乐的归属关系
- **MiniMax H3 TE-Speed 工作流**：新增 Director R2V 原版 TE-Speed 3.3 + Sage 独立工作流；项目开关默认启用 TE-Speed，关闭后可回退到官方 Sage 工作流
- **TE-Speed 运行诊断与对照工具**：新增运行时探针、不可变来源与二进制哈希快照、近似加速能力提示和 A/B 对照工具
- **H3 工作流快速切换**：`01-官方-H3-R2V.json` 加入默认启用的原作者 TE-Speed 节点，可通过旁路节点关闭；LocalMiniDrama 使用两个不可变工作流 ID 切换并隔离各自的 H3 草稿
- **项目与分集永久删除**：删除项目或单集时会清理其拥有的数据库记录、关联、生成任务和项目专属媒体目录；公共素材、全局配置和其他项目保持不变
- **项目制作资源删除入口**：项目详情页可直接删除本剧制作角色、场景和道具，并同步清理分镜关联
- **资产级生图模式**：项目详情页与制作页的每个基础角色、人物状态和场景都可独立选择生图模式；角色/状态支持单图与转面图，场景支持普通图与四宫格，人物状态可独立开关基础人物身份参考

### 优化

- **RunningHub 全量真实风格预览**：从登录态“全部”风格库完整加载并核验 169 张独立预览资源，全部替换原有 12 张截图裁切和 157 张占位图；运行时继续使用本地 640×384 WebP，清单记录去签名来源、尺寸与 SHA-256，刷新脚本缺任意风格即失败且不再生成回退图
- **项目风格单一继承链**：项目 `style_id` 成为角色、场景、道具、分镜、生图和视频的唯一风格来源，所有请求级、资产级和镜头级风格覆盖均被拒绝；统一生图批量任务在入队前编译，底层提交不再重复拼接风格
- **外部 AI 制作包 v2 基础提示词协议**：单集协作任务和结果导入改用 `version: "2"` 与 `prompt_contract: "base_prompt"`，只接收 `base_image_prompt` / `base_video_prompt`，禁止外部 JSON 携带风格或最终提示词，预览及导入过程不会触发图片或视频供应商
- **项目 ZIP 风格契约 v1.7**：项目整包导入导出只往返并校验 `drama.style_id`，不再复制旧 `style` 文本或项目提示词副本
- **制作包协议 1.1 与可追溯映射**：新增角色类型、人物性格和道具类型的严格契约；旧版 1.0 包可从默认人物状态确定性补齐顶层外貌与图片提示词，所有补齐、缺失、复用和未映射字段都会写入导入报告
- **外部资产编辑信息完整性**：角色编辑补充性格、音色、图片提示词与负面提示词，场景编辑将状态、语义说明、氛围、图片提示词和负面提示词独立展示与保存
- **项目绑定的增量导入协议**：外部 AI 只返回本集内容与新增资产，已有资产通过任务快照中的稳定键引用；导入会校验任务归属、目标集、资产变化、引用完整性和重复使用，并保留原始结果及任务追溯信息
- **完整 Generation Context**：全能提示词和 H3 编译统一消费完整生成上下文；H3 严格执行 `none`、`episode_track`、`per_segment` 三种 BGM 策略，并统一处理对白/旁白归属、参考音频标签和语义覆盖审核
- **H3 生成入口一致性**：所有项目分镜视频入口统一先准备 H3 草稿，避免批量、画布和 Director 候选绕过门禁；自由创作页会拒绝必须绑定项目分镜的 H3 工作流
- **音视频合成策略**：最终合成保留 H3 或原视频音轨，并与后期 TTS、整集 BGM 混音，不再以 TTS 覆盖原声
- **官方 H3 + Sage 参数统一**：工作流统一为 20 步、`simple`、`res_multistep`、video shift 12、audio shift 3
- **H3 动作清晰度提示词**：测试提示词使用高快门逐帧清晰策略，禁止正向 motion blur，并增加 temporal smearing、ghosting、double edges、smeared face 等负面词
- **TE-Speed 性能**：RTX 5070 Ti 上 1280×736、5 秒视频的三组 A/B 测试端到端耗时缩短 37.5%–39.2%，五连跑和 10 秒任务验证通过
- **新建项目空状态流程**：新建项目先进入项目详情页；切换项目时清空旧剧集和梗概状态，避免异步加载期间请求旧剧集
- **统一生图任务与输入追溯**：API 与 ChatGPT 网页生图统一从项目角色、人物状态、场景、道具和分镜入口创建任务；后端固化本次模式、最终提示词、完整项目画风、负向提示词和真实参考图清单，任务抽屉按通道展示进度与执行输入
- **人物状态工作区入口**：项目详情页的角色卡片可直接进入该人物的状态工作区，复用制作页状态抽屉完成状态管理、模式选择、身份参考控制与生图
- **制作包生图配置迁移**：项目 ZIP 导入导出会保留角色、人物状态和场景的生图模式、人物状态身份参考开关以及角色负向提示词

### 修复

- **制作页资产模式选择器可读性**：修复角色和场景卡片操作区过窄时生图模式被压缩成仅剩下拉箭头的问题，模式选择器现独占一行，当前模式可直接辨认
- **外部 AI 万能提示词槽位对齐**：修复外部结果使用 `@场景`、`@人物`、`@道具` 或资产显示名时被误判为未引用槽位的问题；导入会按场景→人物状态→道具的规范顺序确定性转换为 `@图片N`，并同步更新任务说明与 Schema 约束
- **JSON 请求错误提示**：修复请求体解析失败或超过 10MB 时被错误返回 HTTP 500 的问题，改为结构化的 400/413 错误，便于外部 JSON 导入定位问题
- **外部 AI 复用资产校验**：修复增量结果导入时将项目已有角色、人物状态、场景和道具误按新资产完整度校验的问题；历史资产缺少性格、音色、外貌、提示词或道具类型时仍可安全复用，外部 AI 新增资产继续执行严格字段校验，且不会用占位数据覆盖现有资产
- **外部制作包字段丢失**：修复导入后角色外貌/性格、场景说明、道具类型、剧集来源键和分镜备注可能未落库的问题；历史导入在启动时仅回填明确新建且当前为空的字段，不覆盖人工编辑或复用资产
- **场景说明污染提示词**：修复导入时将场景 `description` 拼入 `image_prompt` 的问题，两个字段现独立持久化并接受投影回读校验
- **场景生图模式分流**：修复通用场景生图和提示词接口忽略前端模式参数、导致默认单图仍生成四宫格的问题；现在默认及显式关闭四宫格时生成单图，仅显式开启时生成四视图，单图提示词会独立写入并使用 `polished_prompt_single`
- **生图模式与提示词一致性**：修复批量角色生图强制使用转面图、场景同步生图遗漏负向提示词、旧画风键未展开，以及 API 提交时重复拼接模式或画风的问题；非法资产模式现在会返回明确的 400 校验错误
- **视听字段持久化**：修复外部 AI JSON 包与“故事梗概→分镜”流程中的视听字段丢失，统一持久化剧集音频策略、环境声、音效、配乐 cue、转场、情绪强度、主镜头标记和引用语义
- **合并转场音频**：Director 与普通合并在处理视频 `xfade` 时同步处理音频 `acrossfade`，无音轨片段会自动补充等长静音
- **TTS 重复发声与路径校验**：合成器按对白和旁白 owner 决定是否加入 TTS；修复烧录选项导致 `h3_native` 双声的问题，并为语音本地路径增加 storage 边界和真实路径检查
- **重新生成的数据保护**：故事分镜重新生成时按稳定键复用原行并保护手工锁定叶子；H3 会拒绝悬空参考标签，并要求已提供参考同时出现在定义段与正文
- **H3 跨语言引用校验**：修复中文场景名或引用用途必须逐字出现在英文 H3 提示词中、导致合法引用标签被误判为语义绑定不完整的问题；仍保留真实资产、定义段和正文中的标签完整性校验
- **H3 Subject 间接引用校验**：允许参考图片在定义段绑定为 `<Subject N>` 后由正文使用该 Subject，避免符合 Ref2VA 规范的间接语义绑定被偶发误判；未提供资产、缺少定义及正文未使用的引用仍会被拒绝
- **H3 零时长音频桥接**：修复普通硬切被规范化为 `carry + 0ms` 后仍进入音频语义审核、导致已正确生成的 H3 提示词被误报为音频策略不匹配的问题；正时长或带明确描述的桥接仍保持严格审核
- **H3 分镜配乐策略同步**：修复剧集 BGM 设为 `none` 或 `episode_track` 后，历史分镜仍携带 `stinger` 等逐段 cue、导致 H3 提示词报 `none/stinger` 音频策略冲突的问题；保存剧集策略时会同步静音逐镜 cue，生成上下文也会兜底执行全局策略
- **外部包人物字段映射**：补全人物 `appearance`、基础生图提示词、人物级 `negative_prompt` 与 `voice_profile` 映射，并扩大规范化回读的防丢失校验
- **TE-Speed 跨任务缓存污染**：修复 TE 补丁模型跨任务缓存导致的 CPU/CUDA 状态污染，仅对 TE 节点禁用结果复用
- **删除生命周期与孤儿数据**：修复项目删除只隐藏项目但遗留剧集、资产、生成记录和文件的问题；新增显式预览/执行的已删除项目清理命令，并增加路径越界和跨项目保护

### 文档与工程

- **V2.1 全量 UI 设计稿（35 页）**：新增 `docs/design/v2.1-ui/` 高保真视觉基准——依据 V2.1 交互规格与单人创作者收敛设计，对标即梦AI/剪映专业版/Runway 的深色专业工作台风格（bg #0b0d12 / 面板 #12151d / 主色 #7c5cff），覆盖 canonical 路由全部页面（项目中心、新建项目、项目概览、剧集、外部 AI 向导、制作包导入、项目素材、剧本/本集设定/分镜/成片四阶段 Studio、任务中心、资产库、设置、AI 配置、媒体素材库）、旁路与深工具页（自由创作、高级画布、项目归档导入、高级数据工具、更改工作区向导、物理清理 dry-run）与全部独立容器（生成确认 Sheet、画面风格选择、确认剧本影响摘要、版本比较、删除确认，及批量预检/引用管理/素材预览/生成历史/历史版本/编辑项目/资产详情/人物音色 8 类 Drawer）；交付 1440×900@2x PNG、可浏览器查看的 HTML 源稿与设计令牌/组件规范 README，附 `build.mjs` 一键重建；全部图经多轮视觉验收（数据跨页自洽、缩略比例 3:4·16:9·1:1、容器遮罩层次、无溢出遮挡）
- **Production Studio V2.1 分镜页重设计（STORYBOARD-021）**：统一原型分镜页弃用三栏四区三标签结构，改用 RunningHub 式五区布局——左栏镜头检查器（出场角色含人物状态、分镜场景、场景道具，素材行可点击打开预览抽屉；首尾帧衔接；分镜图候选缩略区含生成/上传入口）、中栏时段提示词工作台（@图片N 引用 chips、可编辑时段卡、分镜图提示词自动拼装/手工覆盖/恢复、H3 提示词条一等公民、用 H3 生成视频生成条）、右栏视频审核专属大预览区（候选条、生成历史抽屉）、底部镜头轨并新增上一镜/下一镜切换；移除站位图/动作预演/连续性面板/Recipe/Manifest/双重时长/三段耗时/局部重拍，结构更新、导入导出、批量与高级画布收进更多菜单；交互规格第 8 章、逐页决策记录（新增 STORYBOARD-021 含评审修订）、E2E 验收矩阵 §E/§G、设计评审与原型测试已同步
- **Production Studio V2.1 短片页重设计（CUT-002）**：统一原型短片页弃用"检查镜头/剪辑成片/导出"三标签 NLE 方案，收敛为"审片 + 合片"单屏工作台——大播放器逐镜审看与连续播放（来源标注、回分镜修复）、右栏成片设置（整集 BGM/旁白 TTS/字幕烧录/超分）、成片结果条（合成进度可取消、成片版本与历史、内联导出 MP4/SRT）、底部镜头时间线只读复用分镜轨；生成成片按镜头完成度硬门禁禁用并支持软进入审片；移除多轨时间线、声音归属矩阵、字幕编辑器、七步后期链与 Picture Lock 三层版本语义，后期链在产品内部执行；交互规格第 9 章、决策记录（新增 CUT-002）、E2E 验收矩阵 §H/§I、设计评审与原型测试已同步
- **Production Studio V2.1 全页面个人创作者评审落地**：完成剩余 15 个原型页面的静态与动态评审（真实点击全部交互点），修复素材卡片点击无法进入详情的选择器错配、补齐高级画布缺失的 selection/multi-selection 场景；项目设置退出项目一级导航（旧地址自动重定向到概览，页面功能保留）；单集阶段「本集素材」全局更名为「设定」；剧集页清除 Gate 术语并改按顺序解锁语言；项目素材卡片版本号下沉到详情、快照/指针/通道等术语改个人语言；剧本页右栏「版本与影响」折叠、确认流程两步并一步屏；归档导入检查行白话化；自由创作 Recipe 改称生成方式；外部 AI 协作保持主区与功能完整并统一为「项目说明」语言；新增素材卡可点、画布场景、个人创作者语言三组回归测试
- **Production Studio V2.1 评审遗留项全部实施**：剧集中心外部 AI 协作任务卡按状态分层（等待用户动作=高亮卡片，纯等待=单行进度条，功能与入口不减）；单集制作包导入向导由五步合并为三屏（选择文件与字段映射/导入预览/确认写入）；项目设置「编辑项目资料」与「编辑项目说明」合并为单一「编辑项目设定」抽屉并支持分区切换；设置与资产库文案白话化（固定快照→固定本次配置、attempt→任务编号、hash→校验记录）；新增 V1↔V2.1 差距与复用分析文档，并在分镜/短片设计文档中固化复用与改造策略
- **Production Studio V2.1 场景参考图选择器与时段引用分镜图**：素材预览抽屉对场景展示参考图池（主图/俯视图/全景图/状态图）并支持逐张勾选参与本镜生成，勾选顺序即 @图片N 槽位顺序；时段卡支持 @引用分镜图 开关（该时段以分镜图为参考输入，H3 FL2VA）；人物详情明确主形象锚定语义
- **Production Studio V2.1 项目资产统一原型收口**：项目资产页补齐可写入 URL 的搜索、组合筛选、排序、筛选标签、两步新增、个人资产库选择、批量预检、卡片菜单和异常恢复；人物详情恢复现有单图/三四视图生图模式，并按人物状态完整展示生成、上传、候选对比与一次设为当前流程，所有示例人物均提供具体详情
- **Production Studio V2.1 数据工具导航收口**：项目详情移除一级“数据管理”，备份导出、事务恢复和可恢复删除统一进入项目操作；完整性检查、媒体重定位、迁移/恢复记录和带 dry-run 与引用保护的物理清理进入“设置 → 高级数据工具”，统一原型同步提供完整交互演示
- **风格业务独立归档与可复现目录**：`业务整理` 完整记录 RunningHub 实机提示词证据、项目风格交互、图片/视频编译流程、LocalMiniDrama 落地架构及 169 风格导出；预览证据已更新为登录态页面完整加载的 169 张原站独立资源，运行时不热链原站
- **破坏性变更—旧风格协议移除**：新建或导入项目必须提供有效 `style_id`；旧 39 风格前端常量、后端预设和 `dramas.style` 合并路径已删除，外部 AI v1 结果及旧 `image_prompt` 返回字段会被拒绝
- **RunningHub 产品设计参考包**：在全站实机调查基础上新增逆向 PRD、交互与 UI 规范、截图目录、四阶段可交互原型，以及 LocalMiniDrama 对标改造蓝图和 Superpowers 架构设计；经《全站功能与商业化补全调查》和 5 张工作台截图交叉核对后，进一步补齐实测约束快照、全站外围页面交互、截图哈希与证据边界，明确剧本修订、资产版本、引用健康、生成快照、短片审片与分期迁移边界
- **RunningHub RH剧场全站功能补全调查**：新增 `docs/research/RunningHub-RH剧场全站功能与商业化补全调查-2026-09-08.md` 与 5 张工作台截图存档；实测补齐既有调查未能进入的短片阶段（逐镜审片、连续播放、镜头时间线、保存至成片），并新增全站页面（首页创作入口/短片剧场社区/项目列表/资产库/工具箱/视频重绘）、AI 项目会话、音色库、画风库、消耗看板与计费规则（失败不扣费、按秒计费）、水印合规等实证，附对本地迭代的增量建议
- **外部 AI 制作包文档重构**：`docs/单集制作包导入` 已改为增量结果协议，补充同会话/新会话操作流程、严格 Schema、有效示例和上游提示词
- **版本迭代维护规范**：明确以根目录 `CHANGELOG.md` 为唯一版本迭代记录，并在 `AGENTS.md` 中要求功能、优化和问题修复完成后同步更新本文件
- **RunningHub 风格业务实证**：`业务整理` 新增登录态真实风格、模型映射和生成案例文档；补充标准直出三视图请求体、`90年代写实电影风格` 原文、分镜剧本处理流程，以及 Seedance 2.0 镜头视频的逐字 `promptSnapshot.finalPrompt`、参考图映射、真人模式参数与失败证据
- **RunningHub 风格全链路分析**：`业务整理` 新增项目—剧集—资产—分镜—镜头视频的 UI/交互/状态/提示词编译对照文档，明确当前项目图片与视频风格模块的实现差距，并给出 StyleSpec、统一编译器、能力预检、参考图注册和快照审计的分阶段学习路线
- **统一风格体系设计**：新增 RunningHub 风格体系重构规格，确定以 169 个系统风格和本地预览图替换旧风格，统一项目级风格、图片/视频编译、模型能力预检、生成快照、自由创作及外部 AI JSON v2 的交互与数据边界
- **项目删除生命周期设计与实施计划**：新增 `docs/superpowers/specs/2026-09-07-project-deletion-lifecycle-design.md` 和对应实施计划，明确永久删除边界、文件安全校验及历史孤儿清理方式

## [1.2.8] - 2026-07-01

- **单人创作者原型收敛改造（V2.1 原型与文档）**：按《单人创作者收敛改造设计》完成统一原型的过渡型设计清理——项目设置页退役并由项目概览承载项目资料与画面风格中央弹窗；剧集创建收敛为“新建剧集 + 导入 / 协作”，外部 AI 制作改为独立可恢复向导页且结果只回流为草稿；剧本页草稿优先（空白三起点、AI 渐进、历史抽屉、确认剧本/确认修改）；“本集素材”更名“本集设定”并只展示引用对象卡片，共享素材详情抽屉；分镜随时可进入（`mediaReadiness` 状态条 + 生成守卫），界面移除归档/目标时长/阶段筛选等管理投影；同步交互规格 2026-09-10 呈现口径、逐页决策记录第 11 节、设计评审复审补充与实施计划勾选

### 新增

- **Agnes AI 接入**：新增 `agnes` 接口协议与厂商预设，支持文本（`agnes-2.0-flash`）、图片（`agnes-image-2.1-flash`）、视频（`agnes-video-v2.0`）；AI 配置页提供「一键配置 Agnes」，一个 Key 覆盖文本 / 图片 / 视频三类服务
- **画布模式大幅增强**：
  - **剧本节点**：画布内直接预览、编辑剧本，支持 AI 生成故事与角色/场景/道具提取
  - **右键菜单 / 浮动工具栏 / 新建对话框**：可在画布上新建分镜、集、角色、场景、道具
  - **节点内操作面板**：资源节点、分镜节点、媒体节点面板完善；节点状态遮罩实时显示生成进度
  - **整集生成 composable**：`useCanvasEpisodeGenerate` 支持在画布内批量触发角色/场景/道具/分镜图/视频生成
  - **画布 CRUD**：`useCanvasCrud` 支持在画布内创建、删除实体，无需切回列表页
- **ModelArk 私有资产库配置**：新增 `model_ark_asset` 服务类型与 `modelArkAssetConfigService`，AI 配置页可管理 BytePlus ModelArk / 火山方舟私有资产库（AK/SK 签名 / Bearer 多种鉴权、资产组创建与管理）；角色 SD2 认证优先使用即梦2角色认证，未配置时回退到此处
- **图床配置项化**：`config.yaml` 的 `image_proxy` 支持自定义 `upload_url`、`upload_timeout_seconds`（默认 **180 秒**）、`upload_max_attempts`；不再硬编码上传地址与超时
- **风格缩略图扩充**：新增国风、仙侠、韩漫、都市言情等 8 种风格预览图（`public/style-thumbs/`）

### 优化

- **Seedance 2.0 认证加强**：角色 SD2 认证流程重构，支持 ModelArk 资产库对接、图床 URL 缓存复用与失效重传；`Sd2AssetManagement` 配置面板补充鉴权方式、路径模式、工程名等说明
- **图床缓存校验**：`getProxyCacheValidated` 在使用缓存 URL 前探测远端是否仍可访问，404 / 超时则删缓存并触发重新上传
- **提示词优化**：`promptI18n.js`、`framePromptService.js`、`storyGenerationService.js` 等多处提示词改进，提升剧本/分镜生成质量
- **任务服务**：新增 `taskService` 与 `/api/task` 路由，统一异步任务状态查询

### 修复

- **分镜图片数量上限**：修复分镜图片生成时数量限制未正确生效的 bug

### 文档

- 根目录 `README.md`、`docs/en.md`、`index.html`、各子包 README 同步 **v1.2.8**
- `frontweb` / `backend-node` / `desktop` 的 `package.json` 与 lock 文件顶层 **version** 统一为 **1.2.8**

---

## [1.2.7] - 2026-06-02

### 新增

- **尾帧衔接**：分镜视频区「尾帧衔接」按钮；后端 `tailFrameLinkService` 用 **ffmpeg** 提取当前镜已完成视频的末帧，写入 `image_generations` 并设为**下一镜首帧**（`first_frame_image_id` / `image_url` / `local_path`），便于镜间画面连续
- **分镜首帧 / 尾帧独立绑定**：`storyboardFrameBinding` 将尾帧写入 `last_frame_*` 字段，避免尾帧图污染分镜主图或历史记录；支持 `storyboard_first` / `storyboard_last` 等别名归一化
- **导出分镜表**：制作页一键导出当前集分镜为 **HTML 表格**（`exportStoryboardSheet`），含镜号、景别、运镜、场景/角色/道具、对白、解说、提示词、全能片段等列，便于审阅与对外协作
- **统一生成任务进度**：新增 `generationTaskStore` 与 `useGenerationTaskSync`，角色/场景/道具/分镜图（含首帧、尾帧）/分镜视频/流水线等异步任务共用轮询、去重与超时清理；刷新页面后可恢复进行中的任务状态
- **全能片段多子分镜版式统一**：`universalOmniMultiBeatFormat` 与批量分镜生成、「生成 / 润色全能提示词」共用同一套 **分镜1 / 分镜2…** 段落格式与 `@图片1` 环境约束说明
- **Seedance 2.0 角色素材守护**：`seedance2AssetGuards` 在角色主图变更时自动将已认证 `seedance2_asset` / 音色参考标为 **stale**，避免视频引用过期素材
- **媒体画幅规格**：`mediaAspectRatioSpec` 统一图片 / 视频请求的宽高比解析与归一化
- **故事生成 composable**：`useStoryGeneration` 抽离「从梗概生成剧本」流程；`scriptEpisodes` 辅助多集剧本分段

### 优化

- **全能模式生视频校验**：单条「生成 / 重新生成」视频前检测 AI 配置是否为 **`kling_omni`**，或 **`volcengine_omni` + Seedance 2.x 模型**；不匹配时弹窗说明并可选 **强制继续**（降级为仅场景图或分镜主图参考，不再走多图 Omni）
- **传统模式缺图拦截**：经典分镜在无分镜参考图时弹窗提示「需先生成或上传分镜图片」，不再提供纯文案强行生成
- **分镜 / 视频 / 导入导出**：`episodeStoryboardService`、`storyboardService`、`framePromptService`、`dramaImportService` / `dramaExportService` 等与全能字段、尾帧、提示词清洗（`framePromptSanitize`）联动优化
- **工程结构**：桌面壳统一使用仓库内 `backend-node`，移除重复的 `desktop/backend-app-secure` 副本目录

### 文档

- 根目录 `README.md`、`docs/en.md`、`index.html`、各子包 README 同步 **v1.2.7**（版本徽章、下载链接示例、最新亮点）
- `frontweb` / `backend-node` / `desktop` 的 `package.json` 与 lock 文件顶层 **version** 统一为 **1.2.7**

---

## [1.2.6] - 2026-04-12

### 文档

- 根目录 `README.md`、`docs/en.md`、桌面/后端/前端 README 同步 **v1.2.6**（版本徽章、示例 exe 路径、「最新亮点」标题）
- `frontweb` / `backend-node` / `desktop` 的 `package.json` 与各自 `package-lock.json` 顶层 **version** 统一为 **1.2.6**

### 说明

- 与 **v1.2.5** 相比无新增功能；主要为**桌面安装包/便携 exe 显示与产物版本号**提升至 **1.2.6**，并与仓库内各包版本对齐

---

## [1.2.5] - 2026-04-09

### 新增

- **火山方舟 Seedance 2.0 视频**：后端 `videoClient.js` 支持方舟「全能 / 多参考图」链路；**AI 配置 → 视频** 可选接口规范 **`volcengine_omni`**，模型填控制台接入点（如 `doubao-seedance-2-0-260128`、`doubao-seedance-2-0-fast-260128`，以控制台为准）；参考图按 `role: reference_image` 提交，Seedance **2.x** 时长自动吸附到 **4–15 秒**
- **分镜「全能模式」**：制作页分镜可在「经典分镜」与「全能模式」间切换；全能模式中间为**片段描述**（独立字段 `universal_segment_text` 落库），可用「根据分镜生成提示词」由文本模型生成含运镜、机位等的描述；生视频时若片段描述非空则**仅提交该段**，不拼接下方结构化「视频提示词」，避免覆盖 `@图片N` 编排
- **多图参考与 `@图片1`…**：全能模式下列出场景、角色、物品、分镜主图等为参考图（顺序与界面说明一致，方舟侧最多 **9** 张）；提示词中用 **`@图片1`**、**`@图片2`**… 引用（`@图片N` 后建议加半角空格）；可与 **`kling_omni`**（可灵 Omni）或 **`volcengine_omni`**（火山 Seedance 2.0 等）配合使用

### 文档

- 根目录 `README.md`、`docs/en.md`、桌面/后端/前端 README、`docs/configuration.md` 同步 **v1.2.5** 说明（Seedance 2.0、全能模式、接口规范）
- `frontweb` / `backend-node` / `desktop` 的 `package.json` 版本号统一为 **1.2.5**

---

## [1.2.3] - 2026-03-24

### 新增

- **分镜解说旁白（narration）**：分镜生成请求支持 `include_narration`；数据库 `storyboards` 表新增 `narration` 字段；提示词要求与角色对白 `dialogue` 分离的纪录片式/第三人称解说文案
- **导出解说 SRT**：前端按分镜顺序与 `duration` 累计时间轴，导出非空解说为 SubRip 文件；项目 `metadata.storyboard_include_narration` 持久化勾选状态
- **解说 TTS**：分镜视频区在存在解说文案时提供「解说配音」按钮，沿用现有音频合成接口

### 修复

- **首镜（及前几镜）解说永久为空**：流式增量写入会先插入不完整对象；原逻辑在最终 `saveStoryboards` 时跳过已插入行且不再更新，导致 `narration` 等后出字段无法落库；改为对增量已写入的 `storyboard_number` 用最终解析结果执行 `UPDATE` 合并（`deriveStoryboardFieldsFromAi` + `updateStoryboardRowFromDerived`）
- **解说漏写**：用户提示与系统提示增加最高优先级说明（首镜开场解说、全镜非空等），减少模型将建立镜头留空

### 优化

- **解说相关 UI**：`FilmCreate.vue` 中解说多行输入框、复选框说明与「导出解说 SRT」按钮在浅色/深色主题下的字色与背景对比度；导出按钮白字紫底

### 文档

- 根目录 `README.md`、`docs/en.md` 版本徽章与「最新亮点」同步至 v1.2.3
- `frontweb` / `backend-node` / `desktop` 的 `package.json` 版本号统一为 1.2.3

---

## [1.2.2] - 2026-03-17

### 新增

- **视频帧连贯性（连贯帧模式）**：批量生成分镜视频新增「连贯帧模式」开关；启用后强制顺序生成，每条视频完成后自动用浏览器 Canvas 提取末帧，上传后作为下一条视频的 `first_frame_url` 参考图，有效减少视频片段间的跳跃感；tooltip 详细说明支持的模型（kling-video、wan2.2-kf2v-flash 等）及不支持模型的静默降级行为
- **小说/长文章节导入**：故事生成区域新增「导入小说」按钮；支持粘贴文本或上传 `.txt/.md` 文件；后端基于正则识别章节标题自动分割，可选 AI 改写为剧本格式；返回章节列表自动填入剧本编辑区，每章对应一集（`novelImportService.js`）
- **场景 AI 生成 tooltip**：场景 AI 生成按钮悬停提示改为「多角度图一张（正/侧/俯/仰）」，原重复的「多视角」独立按钮已移除
- **ffmpeg 自动解压**：安装包首次启动时自动将内置的 `ffmpeg.exe`/`ffprobe.exe` 从 `resources/ffmpeg/` 复制到 userData 工作目录，无需用户手动配置；已存在则跳过，支持用户手动替换版本；`electron-builder-lite.json` 通过 `extraResources` 将 `backend-node/tools/ffmpeg` 打包进安装包

### 修复

- **doubao/火山引擎模型分镜 JSON 解析失败**：修复 doubao-1-5-pro 等模型将 JSON 数组包装成 `{"storyboards":[...]}` 对象格式、叠加 max_tokens 截断导致全部修复策略失效的问题；新增 `extractWrappedArrayStr()` 函数，检测到包装对象后提取内部数组候选串，再走截断修复 → jsonrepair 兜底流水线；同样适用于流式增量保存路径（`tryIncrementalSave`）
- **分镜截断后续写内容重复**：续写 prompt 原只携带末尾 5 条分镜，AI 不知道前面已覆盖哪些情节，导致母亲关怀、雪儿致歉等段落反复出现；改为将全量已生成分镜标题列表（`镜号. [段落] 标题`）一并传入，明确禁止 AI 重复，续写连贯性大幅提升
- **分镜生成默认 max_tokens 过小**：默认不传 max_tokens 导致 doubao 等模型使用 4096 token 默认上限，12000 字符即截断；改为默认传 `max_tokens: 16384`；若模型返回参数错误（HTTP 4xx 含 max_tokens/length/token 关键字），自动降级为不传 max_tokens 重试，所有尝试均记录日志
- **JSON 字符串内原始换行符**：中文 AI 模型在对话/描述字段直接输出换行字节（非 `\n` 转义），导致 `JSON.parse` 报 "Unterminated string"；在 `safeParseAIJSON` 预处理阶段新增 `escapeNewlinesInStrings()` 字符级状态机扫描，将字符串值内的 `\n`/`\r`/`\t` 原始字节转义，修复后所有截断修复策略均可正常执行

### 优化

- **火山引擎默认文本模型**：一键配置和手动选择时，文本/对话默认模型由 doubao-1-5-pro-32k 改为 deepseek-v3-2-251201，生成质量更稳定
- **首页隐藏「自由创作」和「素材库」按钮**：功能待完善，暂时注释隐藏，路由与页面代码保留

---

## [1.2.1] - 2026-03-17

### 新增

- **可灵 Kling AI 接入**：新增可灵图片生成协议（kling-image / kling-omni-image）及视频生成协议（kling-video / kling-omni-video / kling-motion-control），AI 配置页可直接选择可灵作为服务商，Base URL / 端点自动填充
- **场景/道具"加入本集"**：场景库和道具库弹窗新增「加入本集」按钮，与角色库体验对齐；后端 `createScene` / `create`（prop）补充保存 `image_url`、`local_path` 字段，确保素材图片 URL 正确保存
- **视频历史记录与主视频选择**：分镜视频重新生成后保留历史版本，下方缩略图条带一览可选；点击历史缩略图即切换主视频，并将选择持久化到分镜记录的 `video_url`；合成视频时后端优先使用用户选定版本，兜底取最新生成记录
- **参考图独立字段（ref_image）**：角色、场景、道具各自新增 `ref_image` 数据库字段，专门存储用户手动上传的参考图，与 AI 生成的主图（`image_url`/`local_path`）完全分离，互不干扰；`migrate.js` 自动迁移
- **编辑弹窗参考图区域（角色/道具/场景）**：添加与编辑模式均显示参考图上传区；编辑时优先展示已保存的 `ref_image`，其次半透明展示主图；上传新参考图后点击保存自动上传并持久化到 `ref_image` 字段；支持"移除参考图"操作
- **从参考图提取描述**：参考图存在时一键调用视觉 AI 提取角色外貌/场景/道具描述，直接填入对应文本框；`resolveEntityImageSource` 优先使用 `ref_image`（高于主图和 `extra_images`）

### 修复

- **合成视频主视频不对**：`getVideoUrlForStoryboard` 调整为优先读 `storyboard.video_url`（用户选定主视频），再兜底 `video_generations ORDER BY created_at DESC`，修复合成时始终取最新生成记录、忽略用户已选定历史视频的问题
- **重新生成视频后主视频混乱**：`onGenerateSbVideo` / `startBatchVideoGeneration` 在提交新生成任务前自动清除 `storyboard.video_url` 及前端 `sbSelectedVideoId`，确保新视频生成完成后合成使用最新记录
- **视觉 AI 返回空内容（o4-mini）**：`max_tokens: 400` 过小导致推理模型（o4-mini）推理过程耗尽 token 而输出为空；改为 `max_tokens: 2000`；同时检测模型名是否以 `o数字` 开头，推理模型改用 `max_completion_tokens`（不能同时传两个参数），并跳过 `temperature` 参数（推理模型不支持）
- **视觉 API system 消息兼容性**：推理模型（o1/o3/o4 系列）不识别 `system` role，改为将 system prompt 合并到 user 消息前缀传入
- **提取描述后保存的参考图覆盖主图**：修复原先将参考图存为 `image_url/local_path`（覆盖 AI 生成主图）的问题，改为存入独立的 `ref_image` 字段；`putImage` 路由调整为只有明确传入 `image_url` 时才更新主图
- **场景导入重复**：工程导入时按 `location|time` 去重，避免多次导入同名场景累积重复条目

### 优化

- **视觉提示词重构**：角色外貌提取提示词改为"角色造型设计"语境（cosplay/概念图），明确要求描述发型/五官/体型/服装四维度，忽略背景，并加入推断指引和拒绝检测（`isRefusalResponse`）；场景/道具提示词同步优化
- **提示词单一来源**：`EXTRACT_PROMPTS` 常量统一在 `aiClient.js` 定义并导出，`characterLibraryService`、`sceneService`、`propService` 直接引用，消除多处重复维护

### 文档

- README 新增「AI 生成实拍效果」章节，展示即梦 1.0 生成的 3 段连续分镜视频，验证跨镜头角色一致性
- README 新增 3 张界面截图（角色管理、专业分镜参数、场景库加入本集）
- AI 服务商表格加入可灵 Kling AI（图片 + 视频）

---

## [1.2.0] - 2026-03-14

### 新增

- **角色图生提示词（polished_prompt）**：提取角色后异步自动生成 AI 润色的最终图像提示词并保存到数据库；编辑弹窗展示该提示词，支持手动编辑与一键重新生成；生成图片时直接使用该提示词，无需临时拼接
- **道具图生提示词（prompt）**：同上，道具提取后异步生成专业英文图像提示词，展示在编辑弹窗，可编辑和重新生成
- **场景四视图提示词（polished_prompt）**：场景提取后异步生成完整四视图图像提示词，展示在编辑弹窗，与角色/道具体验一致
- **结构化镜头角度三元组**：新增 `angleService.js`，定义 8 水平方向 × 4 仰俯角度 × 3 景别共 96 种组合，分镜表新增 `angle_h`、`angle_v`、`angle_s` 字段；分镜编辑区原单行文本输入替换为三个下拉选择器（景别 / 俯仰 / 方向），旁边实时显示中文标签（如「特写·俯拍·正面」）
- **分镜道具自动关联**：分镜 AI 生成时自动提取该镜头使用的道具 ID，写入 `storyboard_props` 表；分镜卡片显示关联道具，编辑弹窗可手动调整
- **分镜段落分组（segment）**：分镜生成时 AI 自动分配幕次/段落（`segment_index` + `segment_title`），前端以段落标题分组展示（如「第一幕：相遇」）
- **角色身份类型下拉**：编辑角色弹窗将「身份/定位」由文本框改为下拉选择器（主角 / 配角 / 次要角色），与 AI 提取的固定值 `main/supporting/minor` 对齐；角色卡片名称旁显示对应颜色 Tag
- **风格双语提示词**：24 种创作风格每项新增 `promptEn`（英文）字段，`prompt` 保留中文说明；图像/视频 AI 调用时自动使用英文版（效果更好），中文版用于界面展示；`getSelectedStylePrompt()` 返回英文，`getSelectedStylePromptZh()` 返回中文
- **分镜图片/视频提示词全中文**：重构 `generateImagePrompt` / `generateVideoPrompt`，输出全中文提示词，角度部分使用中文标签（`特写·俯拍·正面`），视频提示词同时附上英文括号说明兼容双语模型
- **配置文件统一**：合并 `config.yaml` 与 `config.example.yaml` 为单一 `config.yaml`，简化配置管理；Electron 打包与开发环境均只依赖 `config.yaml`

### 优化

- **编辑弹窗体验**：角色、道具、场景编辑弹窗宽度从固定 720px 改为屏幕 75%；所有多行文本框改为 `autosize` 自适应高度（最少 3~5 行，内容多时自动撑高最多 16 行），提示词框不再需要手动滚动
- **默认风格质量描述**：`config.yaml` 中 `default_role_style`、`default_scene_style`、`default_prop_style` 改为风格无关的通用画质描述词，不再预置特定艺术风格，避免覆盖用户在 UI 选择的风格

### 修复

- **场景 polished_prompt 前端轮询不结束**：修正 Axios 拦截器自动解包 `data` 层导致的路径多嵌套问题（`res?.data?.scene` → `res?.scene`），轮询现可正确检测到生成完成
- **分镜段落生成后刷新丢失**：`dramaService.rowToStoryboard` 和 `storyboardService` 补充返回 `segment_index`、`segment_title`、`angle_h`、`angle_v`、`angle_s` 字段，刷新页面后分组和角度信息不再丢失
- **分镜道具批量保存缺失**：`saveStoryboards`（整批保存路径）补充道具关联写入逻辑，与 `insertOneStoryboard`（流式逐条路径）保持一致
- **风格切换不生效**：修复 `backgroundExtractionService.js` 未将请求 `style` 参数透传给异步 `generateScenePromptOnly` 的问题；修复 `generationStyleOptions` value 字段曾改为长描述导致旧项目 v-model 不匹配的问题

### 架构

- 新增 `angleService.js`：结构化角度定义、`toChineseLabel()`、`toPromptFragment()`、`parseFromLegacyText()` 方法
- 新增迁移文件：`15_storyboard_angle_structured.sql`、`16_character_polished_prompt.sql`（`migrate.js` 自动执行）
- `characterLibraryService` 新增 `generateCharacterPromptOnly()`；`sceneService` 新增 `generateScenePromptOnly()`；`propService` 新增 `generatePropPromptOnly()`
- 新增 API 路由：`GET /characters/:id`、`POST /characters/:id/generate-prompt`；`GET /scenes/:id`、`POST /scenes/:id/generate-prompt`；`GET /props/:id`、`POST /props/:id/generate-prompt`

---

## [1.1.16] - 2026-03-14

### 修复

- **场景四视图生成后不显示**：`createAndGenerateImage` 新增 `scene_id` 参数支持，图片存储目录从 hardcode `characters/` 改为动态判断（`scenes/` / `characters/`），生成成功后自动回写 `scenes.image_url` / `scenes.local_path`
- **分镜图生成结果仍为宫格布局**：修正 Gemini 多模态输入结构，参考图说明文字与图片数据严格交替排列（`[说明] → [图] → [说明] → [图] → [生成指令]`），移除错误的 `systemInstruction` 字段，在生成指令中明确要求输出单张图
- **角色参考图干扰分镜布局**：优先使用拆分后的单张面板作为参考（场景取 `quad_panel_0` 建立远景，角色取 `quad_panel_1` 正面全身），无拆分面板时 fallback 到四视图合图
- **拆分角色面板无法按 ID 查询**：`splitQuadGridToImages` INSERT 时补充 `character_id` 字段，确保面板图片可关联到对应角色
- **参考图标签与传图数量不对齐**：`extra_images` 推入逻辑移入主图存在分支，`refLabels` 强制裁剪到 `refs.length`，Gemini parts 构建时同步对齐

### 架构

- `imageClient.js`：`callGeminiImageApi` 重构多模态 parts 构建逻辑；`MAX_GEMINI_REF_IMAGES` 从 3 提升至 4（支持场景参考图 1 张 + 角色参考图最多 3 张）；`createAndGenerateImage` 支持 `scene_id`，回写 `scenes` 表
- `imageService.js`：`splitQuadGridToImages` INSERT 增加 `character_id`；Step 2 参考图解析优先取拆分面板；移除 Step 2.5 冗余的 `CRITICAL OUTPUT REQUIREMENT` 文字注入；`callImageApi` 调用时传入 `system_prompt`（含参考图标签映射）
- `sceneService.js`：`createAndGenerateImage` 调用时传入 `scene_id`

---

## [1.1.15] - 2026-02-28

### 新增

- **多集剧本生成**：故事生成区新增「生成集数」下拉（1 / 2 / 3 / 4 / 5 / 6 集，默认 1），AI 一次性输出对应集数的连续剧本；返回格式统一为 JSON 数组，每集含 `episode`（序号）、`title`（标题）、`content`（约 800 字正文），多集剧情前后衔接、结尾留悬念；前端自动将所有集数保存到项目并默认选中第 1 集
- **标签优化**：故事生成区「风格」改为「故事风格」、「类型」改为「剧本类型」，语义更清晰
- **AI 并发生成（图片 & 视频）**：「AI 配置 → 生成设置」新增「图片并发数」和「视频并发数」选项（默认各 3，可选 1/2/3/5/8/10 或自定义）；一键生成流水线（角色图 → 场景图 → 分镜图 → 分镜视频）及「补全并生成」均采用 `runConcurrently()` 并发执行，不再串行等待
- **实时任务进度**：流水线运行时底部状态栏同步展示当前正在执行的所有并发任务标签（如「分镜图 #3」「角色图 #1」），含脉冲动画
- **可视化风格选择器（StylePickerButton）**：一键生成视频的「生成风格」从普通下拉框升级为图文选择器弹窗，每种风格显示缩略图（本地 `public/style-thumbs/`）与梯度色块兜底，支持按分类浏览和名称搜索，弹窗尺寸为 `90vw`（最大 1100px），可一次预览更多风格
- **AI JSON 输出强化**：分镜生成、角色提取、场景提取、道具提取全面启用 `json_mode: true`（向兼容模型发送 `response_format: { type: "json_object" }` 约束），从模型层面减少非法 JSON 输出概率
- **jsonrepair 自动修复**：`safeParseAIJSON` 集成 `jsonrepair` 库作为兜底修复策略，自动处理未引号字符串值、括号内容、尾逗号等 AI 常见畸形 JSON；修复时输出 WARN 日志记录修复策略、成功挽救的条目数、原文长度等，方便统计破损率
- **`min_max_tokens` 机制**：`aiClient.generateText` 新增 `min_max_tokens` 参数，调用方可声明最低 token 需求；若用户 AI 配置的 `settings.max_tokens` 低于此需求，自动提升并打 WARN 日志，确保多集剧本等长输出任务不被截断
- **全局设置持久化**：后端新增 `global_settings` 表与 `settingsService`（`getGlobalSetting` / `setGlobalSetting`），并暴露 `GET/PUT /settings/generation` 接口，持久化并发数等全局生成配置
- **AI 配置端点预览**：AI 配置弹窗选择厂商/协议后自动显示实际请求 URL（图片提交地址、视频提交地址），方便排查配置是否正确；特别处理 Google Gemini 的端点拼接规则

### 修复

- **供应商锁定 `api_protocol` 丢失**：`applyVendorLock` 的 `INSERT` 语句补充 `api_protocol` 字段，修复锁定厂商的打包 exe 中视频 API 协议路由错误（如 Vidu 接口返回 `images is required`）
- **导入配置 `api_protocol` 未恢复**：`importConfigs` 中的 `aiAPI.create` 调用补充 `api_protocol`，修复导入旧配置后协议字段丢失问题
- **打包 exe 分镜图片 `fetch failed`**：`uploadService.js` 中图片下载从 Node.js 原生 `fetch` 改为自定义 `downloadBufferViaNodeHttp`（`http`/`https` 模块），支持 3 次重试、30s 超时、自动跟随重定向和 `User-Agent`，解决 Electron 打包环境网络兼容性问题
- **`no such table: storyboard_characters` 警告**：`migrate.js` 补充 `CREATE TABLE IF NOT EXISTS storyboard_characters`，消除九宫格提示词生成时的数据库报错
- **端点预览 URL 重复 `/v1`**：OpenAI 图片端点和 MiniMax 视频端点的预览 URL 去除重复拼接的 `/v1`

### 架构

- **后端**：`safeJson.js` 引入 `jsonrepair` 包；`migrate.js` 新增 `storyboard_characters`、`global_settings` 表；`settingsService.js` 新增全局 KV 设置读写；`routes/settings.js` 暴露并发数 API；`routes/index.js` 注册新路由并向 `settingsRoutes` 传递 `db`；`storyGenerationService.js` 重写为多集 JSON 数组模式；`aiClient.js` 支持 `min_max_tokens`；分镜/角色/背景/道具服务统一启用 `json_mode`
- **前端**：新增 `StylePickerButton.vue` 可视化风格选择器组件；`FilmCreate.vue` 新增 `runConcurrently()` 并发工具函数、`pipelineActiveTasks` 任务进度集合、`storyEpisodeCount` 集数控制、多集 `onGenerateStory` 逻辑；`AIConfigContent.vue` 新增「生成设置」Tab（图片/视频并发数）及端点预览面板；`api/prompts.js` 新增 `generationSettingsAPI`；`public/style-thumbs/` 新增 30 张本地风格缩略图

---

## [1.1.14] - 2026-02-28

### 新增

- **官方仓库链接**：`README.md`、`backend-node/README.md`、`CHANGELOG.md` 均新增 GitHub 与 Gitee 官方仓库徽章链接，方便用户直接提交 Issue 或 PR
- **文档规范化**：`backend-node/README.md` 顶部新增官方仓库说明及 Issue 反馈引导

---

## [1.1.13] - 2026-03-09

### 新增

- **分镜图相机角度视角修正**：`framePromptService.js` 新增 `expandAngleDescription()`，将分镜的 `angle` 字段（平视/仰视/俯视/侧面/背面）翻译为完整的相机透视描述，注入图像提示词上下文，使 AI 生成的背景视角与镜头角度一致
- **四宫格序列图模式（后端拆分）**：分镜配置区新增全局「四宫格序列图」开关。开启后：
  - 生成分镜图时传 `frame_type: 'quad_grid'`，后端并行生成首帧/关键帧×2/尾帧共 4 个帧提示词，拼装为 2×2 象限布局提示词调用一次图片 API
  - 图片保存到本地后，后端使用 `sharp` 自动将整图拆分为 4 张子图（左上/右上/左下/右下），每张子图左上角叠加位置标签，分别存为独立的 `image_generation` 记录（`frame_type = quad_panel_0~3`）
  - 4 张子图与普通生成图完全一致，支持点击缩略图切换主图、重新生成自动更新、历史记录保留
  - 主图选择持久化到 `storyboard.image_url / local_path`，刷新页面后自动从后端恢复

### 修复

- **分镜主图刷新后恢复**：`dramaService.rowToStoryboard()` 和 `storyboardService.getStoryboardById()` 均补充返回 `image_url`、`local_path`、`main_panel_idx` 字段，前端 `restoreSelectionsFromBackend()` 可正确从后端数据比对恢复主图选中状态
- **四宫格生成无变化**：移除前端 Canvas 拆分逻辑后，重新生成触发新的后端拆分，不再受旧内存缓存影响
- **四宫格图片白框**：prompt 改为"NO borders of any color (black, white, gray)，panels must be seamlessly adjacent with no gaps"，杜绝任何颜色边框

### 架构

- **后端**：`imageService.js` 新增 `splitQuadGridToImages()`（依赖 `sharp`），Step 7 自动触发；`buildQuadGridPrompt()` 组装四宫格提示词；`storyboards` 表新增 `image_url`、`local_path`、`main_panel_idx` 列（migrate.js 自动迁移）
- **前端**：删除全部 Canvas 拆分相关代码（`sbQuadPanels`、`splitImageIntoQuadrants`、`triggerSplitQuadGrid`、`_persistPanelToBackend` 等约 120 行），四宫格子图完全复用普通单张图片的展示与选择流程；缩略图条对 `quad_panel_*` 类型图片自动显示位置标签

---

## [1.1.11] - 2026-03-06

### 新增

- **批量生成分镜图 / 批量生成分镜视频**：在「重新生成分镜」按钮右侧新增两个右对齐批量按钮，支持一键为所有缺图分镜生成图片、为所有缺视频分镜生成视频，含实时进度、错误日志和随时停止功能
- **角色/场景影响分镜面板**：角色、场景卡片描述下方新增「影响的分镜：#XX #ZZ」标签行及「↻ 重新生成分镜图」按钮，点击可批量重新生成与该资源关联的所有分镜图片，含确认弹窗和实时进度显示
- **多并发 AI 生成转圈**：同时点击多个角色/道具/场景的「AI生成」或「重新生成」按钮，每个按钮独立保持转圈状态，互不干扰（底层由 `ref(null)` 改为 `reactive(new Set())` 实现）
- **提示词管理动态同步**：`promptOverrides.js` 中的 `default_body` 和 `locked_suffix` 改为从 `promptI18n.js` 动态读取，新增 `getDefaultPromptBody(key)` 和 `getLockedSuffix(key)` 导出函数，UI 展示内容与运行时提示词始终一致，彻底消除双维护问题
- **userData 路径统一**：`desktop/main.js` 将开发模式与打包 exe 的用户数据目录统一固定为 `localminidrama-desktop`，并在首次运行时自动迁移旧路径 `LocalMiniDrama` 下的数据，彻底解决开发/发布切换时数据丢失问题

### 修复

- **手动选择角色不进入分镜生成**：`FilmCreate.vue` 中 `onStoryboardCharacterChange` / `onStoryboardSceneChange` 函数原来为空，导致用户在分镜卡片上手动多选角色或切换场景后，选择不会持久化到后端。现已实现调用 `storyboardsAPI.update`，确保分镜脚本生成时使用用户手动指定的角色/场景
- **道具/角色参考图不生效**：修复 `imageClient.js` 中 `resolveImageRef` 函数的 `isLocalhost` 判断逻辑，使其同时检测 URL 字符串本身是否包含 `localhost/127.0.0.1`；修复 `imageService.js` 在构建分镜参考图列表时未读取 `extra_images` 字段的问题
- **分镜数量控制优化**：当用户指定分镜数量时，在系统提示词末尾动态追加 HIGHEST PRIORITY 级别的数量约束覆盖指令，防止系统提示词中的「独立动作数量匹配」规则与用户数量约束冲突
- **角色数量与分镜动作不一致**：强化 `promptI18n.js` 中的 `character_constraint`、`getStoryboardUserPromptSuffix` 及系统提示词，明确要求 `characters` 数组只填写在本镜头 `action/dialogue` 中有实际描写行为的角色，数量必须与动作描述中出现的人物一致

### 架构

- `promptI18n.js` 新增 `getDefaultPromptBody(key)` / `getLockedSuffix(key)` 两个导出函数，作为提示词默认内容的唯一来源
- `promptOverrides.js` 精简为只维护提示词元数据（key / label / description），彻底去除内容冗余副本

---

## [1.1.10] - 2026-03-05

### 新增

- **Google Gemini 图片生成支持**：新增 `callGeminiImageApi`，使用 `generateContent` 接口，支持 `gemini-2.5-flash-image`、`gemini-3.1-flash-image-preview`、`gemini-3-pro-image-preview` 等模型
- **Google Gemini (Veo) 视频生成支持**：新增 `callGeminiVideoApi`，支持 `veo-3.1-generate-preview`、`veo-3.0-generate-preview`、`veo-3.0-fast-generate-preview` 等模型，含异步任务轮询
- **Gemini 参考图支持（图床方案）**：分镜图片生成时，参考图先上传至中转图床获取公开 URL，再通过 `fileData.fileUri` 传给 Gemini，彻底解决 `inlineData` base64 导致的 503 内存溢出问题
- **图床上传缓存**：新增 `image_proxy_cache` 表，本地图片路径与图床 URL 一一映射，相同图片只上传一次，命中缓存时跳过上传（附 `migrations/12_image_proxy_cache.sql`）
- **API 接口规范字段**：数据库新增 `api_protocol` 列（`migrations/11_add_api_protocol.sql`），可为每条 AI 配置显式指定接口类型（`openai` / `volcengine` / `dashscope` / `gemini` / `nano_banana`），优先级高于厂商自动推断，解决中转站自定义配置走错接口的问题
- **AI 配置页面「接口规范」字段**：自定义厂商时显示下拉框供用户选择接口类型；预设厂商自动填充，无需手动选
- **Gemini 作为分镜图片生成厂商**：在 AI 配置页面，分镜图片生成 (`storyboard_image`) 服务类型增加 Gemini 系列模型选项
- **Gemini 作为视频生成厂商**：在 AI 配置页面，视频生成 (`video`) 服务类型增加 Google Gemini (Veo) 系列模型选项
- **图片/视频风格扩展**：在 `DramaDetail.vue`、`FilmCreate.vue`、`FilmList.vue` 三处将风格选项从 8 个扩展至 29 个，按写实、动漫、中国风、绘画、幻想、数字六大类使用 `el-option-group` 分组展示
- **新增 3:4 竖版比例**：画面比例选项新增「3:4 竖版」
- **分镜生成数量上限提升**：前端 `storyboardCount` 最大值从 50 提升至 200
- **全链路生成日志**：图片生成全链路（接收请求 → 解析参考图 → 图床上传 → Gemini API → 保存图片）均打印带计时的结构化日志，便于排查耗时瓶颈
- **`max_tokens` 自适应上限**：`aiClient.generateText` 读取 AI 配置 `settings.max_tokens` 作为上限，调用方传入值超出时自动截断并打印警告，避免不同模型因上限差异导致 400 错误

### 修复

- **修复 Gemini `MALFORMED_FUNCTION_CALL` 错误**：`generateContent` 接口的请求体中，`aspectRatio` / `numberOfImages` 必须直接放在 `generationConfig` 顶层，而非嵌套在 `imageGenerationConfig`（该字段为 Imagen 独立接口专属），嵌套写法会干扰模型内部 `google:image_gen` 工具调用
- **修复分镜生成 `max_tokens` 超限 400 错误**：移除 `episodeStoryboardService.js` 中写死的 `32768`，由 AI 配置的 `settings.max_tokens` 控制或由模型使用默认值
- **修复分镜生成静默失败**：`onGenerateStoryboard` 轮询超时时间从 6 分钟延长至 15 分钟；正确检查 `pollRes.status` 只在 `completed` 时显示成功提示；超时/失败给出明确提示
- **修复 HTTP 500 错误信息不清晰**：`request.js` Axios 拦截器将后端具体错误信息写回 `error.message`，消除「Request failed with status code 500」的模糊提示
- **图床上传重试机制**：`uploadToImageProxy` 上传失败时自动重试最多 3 次，每次均打印尝试序号和耗时

### 架构

- 确认 `desktop/backend-app` 为构建时由 `copy-backend.js` 自动从 `backend-node` 生成，无需手动同步，日常只需维护 `backend-node`

---

## [1.1.9] - 2026-02-xx

### 新增

- **厂商锁定模式**：`config.yaml` 新增 `vendor_lock` 配置项，启用后强制使用指定 AI 厂商配置，用户仅可修改 API Key 和默认模型，无法新增/删除配置；打包的 exe 每次启动自动同步锁定策略
- **全页面 UI 美化**：四个页面（首页/剧集管理/制作页/AI配置）统一升级为极光渐变背景 + 毛玻璃 Header + 玻璃拟态卡片；Header 改为 `sticky` 吸顶
- **品牌标识双行 Logo**：左上角改为「本地短剧助手 / LocalMiniDrama」双行设计，紫色渐变文字
- **面包屑导航**：剧集管理页和制作页 Header 新增 `›` 分隔符 + 项目名标签；返回按钮移至项目名右侧
- **NanoBanana 图片厂商**：新增 NanoBanana 作为独立图片生成厂商，支持 nano-banana-2 / nano-banana-pro / nano-banana 三个模型
- **AI 配置导出 / 导入**：一键导出全部 AI 配置为 JSON 文件，换机或团队共享配置直接导入
- **端点字段可配置**：图片、分镜、视频类型配置均可手动填写「提交端点」和「查询端点」

### 修复

- **角色提取优化**：移除错误的固定数量限制，改为提取剧本中所有有名字的角色；去除无实际用途的 `personality` 字段，加强中文输出约束，速度提升约 40%
- **分镜截断修复**：`max_tokens` 从 8192 提升至 32768，新增 `repairTruncatedJsonArray` 智能修复截断 JSON
- **分镜参考图优化**：角色图和场景参考图优先读取本地文件并转为 Base64 传给图片 API
- **doubao-seedream 参数修正**：参考图字段名由 `imageUrls` 修正为官方规范 `image`，自动移除 `n` 参数并关闭水印

---

## [1.1.8] - 2026-02-xx

### 新增

- **提示词高级设置**：AI 配置页新增「高级设置（提示词）」Tab，支持自定义 9 个核心提示词，修改后立即生效；JSON 输出格式部分加锁保护；随时一键恢复默认
- **AI 厂商自定义选项**：厂商下拉菜单底部新增「自定义」选项

### 修复

- **多项 UI/UX 优化**：Aurora 渐变背景、玻璃拟态卡片、双行 Logo；DramaDetail / FilmCreate / AiConfig 页面风格统一
- **提示词持久化**：自定义提示词通过 SQLite 持久存储（`prompt_overrides` 表），后端内存缓存加速读取

---

## [1.1.6] - 2026-01-xx

### 新增

- **工程导出/导入**：完整打包工程为 ZIP（含图片、视频、文字、配置），换机或分享一包搞定
- **画面比例设置**：新建项目时选定比例（16:9 / 9:16 / 1:1 / 4:3 等），后续生成全程自动适配
- **视频参数扩展**：视频生成支持 `resolution`、`seed`、`camera_fixed`、`watermark` 等参数
- **视频合并进度展示**：合成完整剧集视频时，前端实时展示合并进度

### 修复

- **图片生成去水印**：火山引擎图片生成默认传入 `watermark: false`
- **导出 ZIP 修复**：修复导出文件只有 9 字节的问题
- **导入数据关联修复**：导入时正确创建 `episode_characters`，修复导入后看不到角色/场景/道具的问题

---

## [1.1.4] - 2026-01-xx

### 新增

- **剧集管理页**：新增独立的剧集管理页面（`/drama/:id`），统一管理剧集信息、本剧资源库与分集列表
- **资源库分层**：本剧资源库（按剧过滤）与全局素材库严格隔离
- **素材库导入**：在剧集管理页可一键从全局素材库导入角色/场景/道具
- **明暗主题切换**：支持暗色/浅色模式，偏好持久保存

---

## [1.1.x] - 早期版本

- 一键生成流水线：自动跳过已有内容，失败自动重试最多 3 次
- 实时进度展示：流水线执行中实时显示步骤与错误日志
- 视频/图片提示词编辑：每个分镜可单独查看和修改提示词
- AI 配置优化：支持多种服务商连接测试

---

## [1.0.x] - 2026-01-xx

- 项目立项与基础架构搭建（Vue 3 + Node.js + Electron）
- 剧本生成、角色/场景/道具提取
- 分镜生成与图片/视频生成核心流程
- SQLite 数据持久化
- Windows exe 打包
