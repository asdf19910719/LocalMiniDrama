# LocalMiniDrama VNext UI Layout Specification

> 本规格定义空间、信息密度和响应式行为，不复制 RunningHub 的色值、品牌、荧光强调或暗色唯一主题。

## 1. 视觉与布局目标

- 媒体优先：图片、视频和时间线在需要比较/审核时获得最大空间。
- 上下文稳定：Project、Episode、Stage 和当前对象不随内容切换消失。
- 默认摘要、选择后深入：卡片用于扫描，Drawer/Inspector 用于复杂字段。
- 状态不靠颜色：文字、图标、边框、数量和 reason 同时表达。
- 双主题：亮/暗主题共享语义 token；暗色适合媒体审片，但不是唯一模式。

## 2. Layout Tokens

### 2.1 尺寸

| Token | 建议值 | 用途 |
|---|---:|---|
| Global rail | 56–64px | 顶级工作域图标/短标签 |
| App header | 56–64px | 全局页面标题与动作 |
| Studio header | 64–72px | Project/Episode/Stage/Task |
| Stage toolbar | 48–56px | 筛选、统计、阶段动作 |
| Compact sidebar | 240–288px | Script Scene 导航、资产目录 |
| Shot inspector | 320–380px，可调 | 镜头输入依赖 |
| Result panel | 360–440px，可调 | 候选、历史和任务 |
| Detail drawer | 520–720px 或视口 38–48% | 资产/任务长详情 |
| Shot rail | 136–176px | 镜头序列与状态 |
| Content max width | 1440–1680px（列表页） | 防止阅读和卡片跨度过大 |

### 2.2 间距

使用 `4 / 8 / 12 / 16 / 24 / 32 / 48px` 阶梯：

- 4：图标与紧凑状态；
- 8：同组控件；
- 12：卡片内部；
- 16：表单组/卡片 gap；
- 24：区域间与页面边距；
- 32：主章节；
- 48：空态和大型分区。

### 2.3 Typography

| 层级 | 建议 | 用途 |
|---|---|---|
| Page title | 20–24px / 650 | 项目、全局页 |
| Stage title | 18–20px / 650 | Script/Setup/Storyboard/Film |
| Section title | 16px / 600 | 区域、Drawer 分组 |
| Body/control | 14px / 400–500 | 表单、按钮、列表 |
| Metadata | 12–13px / 400–500 | 状态、时间、模型、成本 |
| Monospace/meta | 12–13px | Job ID、hash、时间码、费用数字 |

Script 正文行高 1.6–1.75；Prompt beat 段落间距高于普通表单；媒体卡标题最多两行。

## 3. App Shell

```text
┌──────────┬────────────────────────────────────────────────────┐
│ Global   │ App Header: title / scope / search / tasks / action│
│ Rail     ├────────────────────────────────────────────────────┤
│ Projects │                                                    │
│ Assets   │                    Page Workspace                  │
│ Tasks    │                                                    │
│ Settings │                                                    │
└──────────┴────────────────────────────────────────────────────┘
```

Global Rail 保持低视觉权重。应用级任务 badge 显示活动、失败/unknown 数；不显示云余额。

## 4. Projects Page

```text
Page Header: 我的项目                         [导入] [新建项目]
Search / status filter / sort / view
┌────────────┐ ┌────────────┐ ┌────────────┐
│ cover      │ │ cover      │ │ cover      │
│ title      │ │ title      │ │ title      │
│ episodes   │ │ stage      │ │ warnings   │
│ updated    │ │ continue   │ │ continue   │
└────────────┘ └────────────┘ └────────────┘
```

卡片主点击进入项目/继续工作。删除、重命名、导出进入 Context Menu。Empty 状态提供“从想法”“导入剧本/项目”两类起点，不显示模型列表。

## 5. Project Detail

```text
Project Header: cover / title / summary / default style / [继续]
Health strip: episodes | stale | failed | deliveries
Tabs: Overview | Assets | Shot Videos | Deliveries | Exchange
┌──────────────────────────── Episode List ─────────────────────┐
│ E01  Script ✓  Setup !  Storyboard 12/30  Film locked?  Open │
│ E02  Script draft ...                                         │
└───────────────────────────────────────────────────────────────┘
```

项目健康摘要可点击筛选对应剧集。Delivery 卡与 Shot Video 卡使用不同图标和标签。

## 6. Studio Shell

```text
┌───────────────────────────────────────────────────────────────┐
│ ← Project | Project title | Episode ▼ | Script Setup Board Film│
│                                     stale 3 | tasks 2 | settings│
├───────────────────────────────────────────────────────────────┤
│ Stage Toolbar / Gate Banner                                   │
├───────────────────────────────────────────────────────────────┤
│ Stage Workspace                                               │
└───────────────────────────────────────────────────────────────┘
```

Header 固定；Stage Toolbar 在页面滚动时保持可达。Gate Banner 位于 Toolbar 下，不用 Modal 阻止浏览。

## 7. Script Layout

```text
┌──────────────┬──────────────────────────────────────────────┐
│ Story Scenes │ Draft Revision                              │
│ 01 opening   │ [Script editor / structured text]           │
│ 02 conflict  │                                              │
│ 03 ending    │                                              │
│ warnings     │                                              │
├──────────────┴──────────────────────────────────────────────┤
│ Draft dirty/saved | Approved r3 | [Compare] [Approve script]│
└─────────────────────────────────────────────────────────────┘
```

左栏只导航结构，主编辑器占最大宽度。Revision Bar 固定底部或编辑区尾部，保存和批准视觉/动词明显分开。

## 8. Setup Layout

```text
Toolbar: Scene filter | Character Location Prop | counts | Standard/Canvas
         [Re-extract] [Batch generate] [Style]
┌──────────────────────── Asset Grid ───────────────────────────┐
│ [Asset Card] [Asset Card] [Asset Card] [Add]                 │
│ [Asset Card] [Asset Card] ...                                │
└───────────────────────────────────────────────────────────────┘
                                           ┌───────────────────┐
                                           │ Asset Drawer      │
                                           │ identity/variant  │
                                           │ candidates/voice  │
                                           │ source/usage      │
                                           └───────────────────┘
```

资产网格按可用宽度显示 3–5 列；媒体比例固定，避免 Loading 时布局跳动。Drawer 打开后网格仍可辨认，窄屏则转全屏。

## 9. Storyboard Layout

### 9.1 ≥1440px

```text
Toolbar: Scene | shots | duration | timeline r | import/extract | batch
┌──────────────┬──────────────────────────┬────────────────────┐
│ Shot         │ Intent Editor            │ Result             │
│ Inspector    │ timeline beats           │ selected preview   │
│ duration     │ dialogue/action/prompt   │ candidates/history │
│ bindings     │ provider/capability      │ job/post-process   │
│ validation   │ cost + generate          │                    │
├──────────────┴──────────────────────────┴────────────────────┤
│ Shot Rail: [01][02][03][04] ...                              │
└───────────────────────────────────────────────────────────────┘
```

Inspector 和 Result 可调宽；中栏最小 480px。生成条固定在中栏底部，但不遮挡预检错误。Shot Rail 横向虚拟化。

### 9.2 1280–1439px

Result 可折叠为右侧 tab；Inspector 保持 300–340px。折叠后当前 Selected Candidate 缩略图仍显示在生成条或小预览中。

### 9.3 1024–1279px

Inspector 与 Result 二选一展开；中栏持续存在。切换 panel 不改变当前 Shot 或未保存 Prompt。

## 10. Film Layout

```text
Toolbar: 28/30 selected | stale 1 | missing 1 | [play all] [lock]
┌──────────────────────────────────────┬────────────────────────┐
│ Main Player                          │ Issue Panel            │
│ current shot / selected candidate    │ missing / stale / audio│
│                                      │ [open shot]            │
├──────────────────────────────────────┴────────────────────────┤
│ Episode Timeline: scenes / shots / time / lock markers       │
└───────────────────────────────────────────────────────────────┘
```

Player 是视觉中心。技术 Provider 参数不常驻。Picture Lock 后顶部显示锁定版本；查看旧 Lock 时整个页面进入只读上下文。

## 11. Assets Page

资产中心使用列表/网格切换：媒体质量比较用网格；来源、项目使用和文件状态用表格/列表。筛选区包含类型、项目、来源、使用状态、文件状态和关键词。

空态分为：库尚未建立、筛选无结果、文件丢失。每种提供不同恢复动作。

## 12. Tasks Page

```text
Summary: Running | Failed | Unknown | Cost known/unknown
Filters: project / episode / type / provider / status / time
┌──────────────────────── Task Table ───────────────────────────┐
│ object | type | provider | stage | elapsed | cost | status   │
└───────────────────────────────────────────────────────────────┘
Job Detail Drawer: snapshot / attempts / events / error / result
```

任务适合表格，因为字段重复且需要筛选。媒体预览只在 Detail Drawer，避免表格过宽。

## 13. Modal、Drawer、Inspector 尺寸

| Surface | 尺寸 | 布局规则 |
|---|---:|---|
| Confirm Modal | 400–520px | 单一决策，危险动作与取消分离 |
| Selector Modal | 800–1200px | 搜索/分类固定顶部，卡片区虚拟滚动 |
| Batch/Import Modal | 720–960px | Step/Preview/Result 三段，不做多层嵌套 |
| Delivery Modal | 720–960px | 左配置、右锁定输入与预估摘要 |
| Detail Drawer | 520–720px | Header/scroll body/sticky actions |
| Inspector | 320–380px | 分组折叠，可调宽，不覆盖 Workspace |

## 14. UI State Layout

| State | 布局要求 |
|---|---|
| `Default` | 完整内容和常规动作，稳定尺寸 |
| `Hover` | 只改变表面/边框，不能移动相邻元素；关键动作不能只在 Hover 可达 |
| `Selected` | 保留对象尺寸；边框、背景、标记和文字共同表达 |
| `Disabled` | 内容仍可读；reason 位于控件旁、Banner 或 tooltip，不隐藏已填值 |
| `Loading` | Skeleton 保持最终布局、媒体比例和列宽；Shell 不闪烁 |
| `Empty` | 在对应区域内显示原因、范围和一个主恢复动作，不用整页空白替代局部空态 |
| `Processing` | 名称、上下文和任务入口仍可用；进度覆盖只限媒体/结果区域 |
| `Success` | 结果落点占据原结果区域；短暂动画不能改变布局 |
| `Error` | 尽量局部显示，保留输入和上次成功内容；错误摘要、恢复动作、详情分层 |

`Stale` 以警示条/角标叠加在现有内容上，不替换媒体；`Partial Success` 同屏显示成功、失败、跳过和未知分项。

## 15. 视觉语义

| 语义 | 使用 |
|---|---|
| Primary | 当前容器唯一主要推进动作 |
| Selected | 当前上下文/业务选用，配合标签区分 |
| Positive | 已保存、已选用、已完成 |
| Warning | stale、可降级、成本未知 |
| Danger | 失败、删除、不可恢复风险 |
| Processing | 活动任务与对账 |
| Neutral | 元数据、历史和未激活区域 |

不规定 RunningHub 的荧光绿或纯黑。两套主题都必须满足 WCAG AA 文本对比度和非颜色状态表达。

## 16. 信息密度

- Projects/Setup：中等密度，优先扫描与比较；
- Script：低到中密度，优先长文本阅读；
- Storyboard：最高密度，因为输入、意图、结果和序列必须同屏；
- Film：降低控件密度，提高媒体和问题摘要权重；
- Tasks：高字段密度，使用表格、筛选和 Drawer；
- Settings：按 Provider/schema 渐进展开，不一次显示全部高级参数。

## 17. 不应出现的布局

- 把四阶段和七步同时做成两个同权重主导航；
- 在 Asset Card 上塞入完整提示词、Provider、历史和所有按钮；
- Film Page 持续展示分镜生成技术表单；
- Drawer 打开后再从同侧打开另一个 Drawer；
- 1280px 以下强行保持三栏固定宽度；
- 用全屏 Loading 覆盖可继续操作的 Shell 和其他对象；
- 复制 Reference 的具体暗色、荧光色、圆角和品牌卡片。
