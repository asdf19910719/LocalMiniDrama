# Production Studio V2.1 原型页面·动态评审与修改方案

日期：2026-09-10
性质：**可执行修改方案**——供实施方（AI 或人）按此文档直接修改原型（HTML/model.js/test.cjs）。
配套文档：静态评审见 `production-studio-v2.1-remaining-pages-review-2026-09-10.md`；本文档以其为基础，补充**动态交互核查结果**（在浏览器中真实点击每个页面、按钮、抽屉）与精确修改方案。

## 0. 动态评审方法与覆盖

- 方法：本地 HTTP 托管原型，真实渲染每个页面 → 枚举全部可见按钮 → 逐一程序化点击 → 记录抽屉标题/内容、toast、路由跳转；对关键链路（剧集导入、素材详情、剧本抽屉、自由创作配置）手工逐步走查。
- 覆盖：studio-script（20 交互点全量）、project-episodes（34 全量 + 导入链路走查）、project-assets（20 + 详情/缺陷定位）、project-bible（15 全量）、project-import（4 阶段 + 术语扫描）、tasks / quick-create / canvas / settings×3 / library / overview / project-new / projects（表层扫描 + 关键抽屉）。
- 评审语言基准：个人创作者视角（09-09 收敛设计 + STORYBOARD-021 / CUT-002 新基线）。

## 1. 动态评审发现的缺陷（优先修复）

### D-01 🔴 素材卡片点击无法进入详情（交互主路径断裂）
- **现象**：项目素材页点击任何资产卡片无任何响应，详情视图不可达。（详情以**抽屉**呈现——首轮验证误查页面文本，修正后已浏览器实测：点击卡片打开「林夏」详情抽屉，五分区完整。）
- **根因**：卡片元素是 `<article class="project-asset-card" data-asset-open="...">`（HTML L626），而点击绑定写的是 `pageRoot.querySelectorAll('button[data-asset-open]')`（HTML L2511）——选择器要求 `button`，永远匹配不到。
- **修复（已实施 ✓）**：
  1. L2511 选择器改为 `pageRoot.querySelectorAll('[data-asset-open]')`；
  2. 卡片已有 `tabindex="0"`，补 Enter/Space 键支持（keydown 事件同 click）；
  3. 在 `.test.cjs` 增加断言：HTML 中存在 `querySelectorAll('[data-asset-open]')` 绑定且卡片标签为 article 时绑定仍生效（可用字符串断言 `assert.match(html, /querySelectorAll\('\[data-asset-open\]'\)/)`）。

### D-02 🔴 getCanvasModel 签名与场景键缺陷
- **现象**：`getCanvasModel('7','1','multi-selection')` 抛 `Unknown canvas scenario: 7`。
- **根因**：函数首个参数就是 `scenarioId`（传 `(projectId, episodeId, scenarioId)` 时实际拿到 `scenarioId='7'`）；且模型 scenarios 对象缺 `selection`、`multi-selection` 两个键（route 注册表有 19 个场景，模型只有 17 个）。
- **修复（已实施 ✓；签名勘误）**：HTML 调用为单参 `getCanvasModel(scenarioId)`，签名本身无误；实际缺陷是 scenarios 对象缺 `selection`/`multi-selection` 两键。已补齐，并增加回归测试。原文关于签名的判断有误，更正：
  1. ~~核对调用签名~~（已核实无误），统一签名（建议改为 `(projectId, episodeId, scenarioId)` 并在函数内取第三参）；
  2. 补齐 `selection`、`multi-selection` 两个场景定义（multi-selection：`selectedIds:['character-linxia','shot-03']`，提示"已多选：可批量重编译或查看影响"）；
  3. 增加测试：遍历 route 注册表 canvas 的全部 19 个场景逐一调用模型不抛错。

### D-03 ⚪ ~~项目素材页误触发剧集门禁提示~~（复核撤回：误报）
- **复核结论**：toast 的 textContent 在消失后仍留在 DOM；首轮爬虫读到的是**残留文本**。用 `show` class + 隔离等待复测，新增资产/从资产库添加/筛选均无 toast。非缺陷。
- **现象**：项目素材页点击「＋新增资产」等动作时，toast 弹出"请先确认剧本并完成本集素材检查"——这是**剧集**阶段 Gate 的 reason（model L475/L488），出现在**项目级**页面属于上下文错误。
- **修复**：在 bindPageActions 中定位引用 episode stage reason 的 showToast 分支，项目级页面的按钮不应绑定剧集 Gate 提示；新增资产/从资产库添加在项目页无前置门禁。

### D-04 ⚪ ~~project-import 的 success 场景直接导航不生效~~（复核撤回：场景名记忆错误）
- **复核结论**：该路由的终态场景名为 `succeeded`（非 `success`）；`#/projects/import?scenario=succeeded` 可正常渲染。非缺陷。
- **现象**：`#/projects/import?scenario=success` 直接导航后仍渲染 initial 阶段（ready 正常）。
- **修复**：核对 parsePrototypeLocation 对 project-import 的 scenario 参数处理与 renderLocation 的重渲染条件（key 需包含 scenarioId）；在 .test.cjs 增加 `parsePrototypeLocation('#/projects/import?scenario=success')` 返回 scenarioId='success' 的断言。

### D-05 ⚪ toast 状态残留（方法学备注）
toast 存活 1800ms，连续快速操作时旧 toast 会覆盖新操作的反馈。产品实现时每次操作应先清空再显示；原型可保持现状，不阻塞。

## 2. 逐页核查结果与修改方案

### 2.1 studio-script 剧本 — 动态核查通过（20/20 交互有真实内容）；微调
- 健康项：AI 创作（含模型与费用预估）、比较版本（逐场 diff）、场次操作、恢复副本（三方可读对比 + 复制/建新草稿）、三个版本详情抽屉、预计素材变化（采用/忽略/稍后决定 + 人工锁定保护）全部有完整内容。
- **修改方案**：
  1. 右栏「版本与影响」改为默认折叠的 `<details>`（展开才占宽）；
  2. 术语替换（全局表见 §3）：「按原范围和输入快照重试」→「按相同设置重试」；「下游影响」→「确认后会影响什么」；「删除候选」→「建议删除（仍被历史引用，需确认）」；
  3. 确认流程三步并两步：`检查并确认`抽屉内同屏展示"检查结果 + 预计素材变化"，去掉单独的素材差异中间步（保留"查看明细"折叠）。

### 2.2 project-episodes 项目剧集 — 动态核查通过（34/34）；重排
- 健康项：六类来源选择器（含"任何来源都不会因为打开选择器而创建任务"安全语）、目标选择（"非空剧集不允许合并、覆盖或追加"）、导入抽屉（TXT/Markdown/DOCX、20MB 上限、可读预览）、来源审计（只读且不可变）、••• 菜单（重命名/复制为草稿/目标时长/集序/归档——语言已很好）、锁定 toast 精确。
- **修改方案**：
  1. tool-note「阶段入口遵循当前剧集 Gate」→「各阶段按顺序解锁：确认剧本 → 准备设定 → 进入分镜 → 合成短片」；
  2. 外部 AI 任务卡按状态分层（等待用户动作=常驻横幅；纯等待=单行进度条；已完成=收进审计入口）——功能不减；
  3. 制作包导入向导五步并三步（选择+映射 → 预览[结构+资产+差异同屏] → 确认写入）；
  4. 「协议 2.1 · 只读且不可变」→「原始返回记录 · 只读」（审计抽屉内保留协议细节于折叠区）。

### 2.3 project-assets 项目素材 — 动态核查发现 D-01/D-03；重排
- 健康项：筛选体系（类型/状态/排序/更多筛选/多选批量条）、新增资产两步抽屉、从资产库添加（引用固定版本说明）、••• 菜单（编辑资料/复制/入库/下载/归档）、加载更多说明。
- 确认的术语问题（innerText 复验）：卡片 tag「资料 r3/r2」直接可见；「已用于 N 集」表达良好保留。
- **修改方案**：
  1. 修 D-01（卡片点击）与 D-03（误触发 toast）；
  2. 卡片 `dataRevision` tag 移除，信息合并进详情页"版本记录"区；卡片层新增状态语言：`使用中 / 有新候选 / 缺参考`（现有 currentMediaStatus tag 已部分承担）；
  3. 横幅与状态文案按 §3 术语表替换（快照→生成记录、指针→当前使用、通道→生成方式）；
  4. 18 种场景横幅合并为四类样式：需要处理（danger）/ 有更新可选（warn）/ 只读原因（muted）/ 流程进行中（running）。

### 2.4 project-bible 项目设置 — 动态核查通过（15/15）；微调
- 健康项：外部 AI 协作主区流程完整（上下文预览含"基于项目资料 v17"与包含内容清单；编辑抽屉含故事基础/不可变设定/跨集备注；复制/创建任务可达）；风格选择抽屉含预设分类；生产对象概览三行直达。
- **修改方案**（按用户澄清：外部 AI 保持主区与功能完整）：
  1. 外部 AI 面板按任务流重排：①给外部 AI 看什么（上下文摘要+缺失字段）→ ②生成与交付（复制/创建任务）→ ③等待与结果；
  2. 名称：「创作上下文」→「给外部 AI 的项目说明」；「Markdown」→「说明文件（Markdown）」；「任务包」→「制作任务包」；面板副标题"不是核心制作必经步骤"保留（定位说明，非降级）；
  3. 「编辑项目资料」与「编辑创作上下文」合并为「编辑项目设定」抽屉（两个分区）；
  4. 「风格版本 4」→「第 4 版」。

### 2.5 project-import 项目归档导入 — 动态核查（initial/ready 实测）；重排
- 实测确认：ready 阶段主流程可见「Manifest 和文件 Hash 已核对」「峰值需要 9.6 GB」；@2.1/ZIP 在 initial 页可见。
- **修改方案**：
  1. 检查行标签改白话：「归档格式与版本」→「归档可识别」；「数据结构」→「内容完整」；「文件完整性 Manifest 和文件 Hash 已核对」→「全部 23 个文件已校验，无损坏」；「目标磁盘空间 峰值需要…」→「需要临时空间 9.6 GB，当前可用 126.4 GB」；Manifest/Hash/峰值移入「技术检查详情」折叠；
  2. 「事务/回滚」结果文案 →「导入中断不会留下半个项目；已自动还原」；
  3. 修 D-04（success 场景导航）。

### 2.6 quick-create 自由创作 — 动态核查（配置抽屉实测）；微调
- 实测确认：「当前 Recipe 快速图片」「Recipe 快速视频」上页面；配置抽屉三步完整（项目/剧集可选绑定、Prompt、参考素材、画幅、分辨率、Provider/模型）。
- **修改方案**：「Recipe」→「生成方式」（两处卡片标签 + 「当前 Recipe」→「当前生成方式」）；「自由创作实验室」→「自由创作」；页面副标题"复用统一 Provider、任务、媒体和候选事实源"→"和项目内生成共用同一套通道、任务与候选管理"；五类去向与预检确认链保留。

### 2.7 tasks 任务中心 — 动态核查；保持（P3 微调）
- 实测：页面表层 jargon 命中为空；「查看任务」按任务类型跳转对应工作台（如视频任务→分镜页对应镜头）行为正确；筛选四维 + 搜索可用。
- **修改方案**：任务抽屉技术详情保留 attempt/fingerprint（已折叠，可接受）；行内如有 attempt 残留统一为「第 N 次」。

### 2.8 projects / project-overview / project-new / library — 动态核查通过；保持
- projects：卡片流 + 续作按钮，语言标杆。overview：恢复位置精确、待处理卡用"设定"新名、无术语命中。project-new：来源卡 + 创建前检查说明，仅"可写权限"属合理检查语言。library：筛选完整、无术语命中。
- 建议：全部保持。P3：overview 的「设定」命名与在途导航改造统一收口。

### 2.9 settings-ai / settings-general / settings-data — 动态核查通过；保持（P3 微调）
- settings-ai：「解析顺序：本次选择 → 项目默认 → 全局默认 → 安装默认」是必要心智模型保留；「固定快照」→「任务创建后固定本次配置」；fingerprint 文案 →「检测到配置已变化，运行中任务不受影响」。
- settings-general：「回滚点/迁移向导」保留（迁移安全说明合理）；「冻结」→「任务创建时固定本次配置」。
- settings-data：保持全部严谨性（dry-run/journal/回滚是该页目标语言）。

### 2.10 canvas 高级画布 — 保持（修 D-02）
- 修 D-02（模型签名与场景键）；共享命令裸 id（useAssetVersion 等）若需展示改为动词短语（「应用素材版本」「提交生成」「采用候选」「重编译镜头」「归档对象」）。

## 3. 全局术语映射表（一次性替换，配测试断言）

| 现词 | 替换为 | 出现页面 |
|---|---|---|
| Gate | 按顺序解锁/还差 X 步/先确认剧本 | project-episodes |
| Recipe | 生成方式 | quick-create |
| canonical Generation Job | 任务 | quick-create（模型字段名不改，仅 UI 文案） |
| 输入/费用/来源快照 | 生成时的输入记录 / 费用记录 | script/assets/quick-create/settings-ai |
| 当前指针 | 当前使用 | project-assets |
| attempt | 第 N 次 | tasks |
| 资料 rN（dataRevision 卡片 tag） | 下沉到详情版本记录 | project-assets |
| Manifest 和文件 Hash | 全部 N 个文件已校验 | project-import |
| 事务/回滚 | 导入中断会自动还原 | project-import |
| 冻结 | 固定本次配置 | settings-general |
| 任务包 | 制作任务包 | project-bible |
| 创作上下文 | 给外部 AI 的项目说明 | project-bible |
| 自由创作实验室 | 自由创作 | quick-create |

保留不改：「解析顺序」四层说明、settings-data 的 dry-run/journal/回滚、片段「技术详情」折叠区内的全部工程术语。

## 4. 实施顺序与验收

> **2026-09-10 实施记录（最终）**：第一批（D-01、D-02）与第二批（导航收口：项目设置退出一级导航并保留 bible 路由与旧地址重定向；本集素材→设定 全局改名；episodes Gate 文案；assets 卡片 tag 下沉与术语）、第三批（script 右栏折叠为两栏 + 确认抽屉内联明细 + 术语；import 检查行白话化；quick-create 生成方式/自由创作；bible 外部 AI 命名润色）、第四批（回归测试 ×2）已全部落地；测试 170/170 通过。**遗留两项**按本文档 §2.2 与 §2.7 的方案留待实施：①episodes 外部 AI 任务卡状态分层（等待用户动作=横幅；纯等待=单行进度）；②制作包导入向导五步并三步。两项均涉及多抽屉/多状态重构，建议单独一批实施。

1. **第一批（缺陷修复）**：D-01、D-02、D-03、D-04 + 对应测试断言（每项一个 test）。
2. **第二批（P1 重排）**：project-episodes（Gate 文案/任务卡分层/向导三步）与 project-assets（版本下沉/术语/横幅分类），并在同一批收口在途的"项目设置导航移除 + 本集素材→设定"改造（消除现存 2 个失败测试）。
3. **第三批（P2 微调）**：script 右栏折叠与确认两步、bible 任务流重排与抽屉合并、import 术语下沉、quick-create/tasks 术语。
4. **第四批（P3）**：全局术语表替换 + 回归测试（新增一个"个人创作者语言"测试：遍历各页 innerText 断言 §3 左列词不出现在非折叠区）。
5. 每批沿用：设计文档 → 测试先行 → model → HTML → 规格同步 → 浏览器实测。

## 5. RunningHub 实测补充（2026-09-11，房客项目登录态实测）

**设定页场景素材确实有"其他视图"**：场景「酒店房间·夜」带 俯视图、九宫格图 两个视图按钮；「高级酒店走廊·夜」「客房阳台·夜」带 全景图、查看全景分镜图。即 RunningHub 场景素材 = 场景主图 + 多张视图图（俯视/全景/九宫格）。

**分镜页「分镜场景」下拉框实测**（点击 酒店房间▾ 展开）：
- 展开的不是简单场景切换，而是**场景参考图管理器**：
  - 顶部为场景主图（酒店房间·夜）；
  - 下方「幻镜场景图片」网格列出该场景全部参考图：俯视图 ✓、九宫格 ✓、以及九宫格拆分出的 格1～格9（每张可独立勾选，已选计数「已选 2 项」）；
  - 右上角「移除场景」；勾选结果决定哪些场景图作为参考图参与本镜生成。

**对本项目的结论**：
1. V2.1 原型的"场景剧情状态 + 视图参考"设计方向与 RunningHub 一致，非凭空设计；
2. RunningHub 的视图类型 = 俯视图 / 全景图 / 九宫格（含拆分格），已并入我们"生图类型"选择框（单图/四宫格/俯视/全景）的口径正确；
3. 我们缺少的一个细节：**分镜对场景参考图的逐张勾选**（RunningHub 可勾俯视图/九宫格/格1~格9 参与本镜）。建议 V2.1 分镜页素材预览抽屉支持场景下多张视图图逐张勾选参与。
