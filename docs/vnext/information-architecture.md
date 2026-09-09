# LocalMiniDrama VNext Information Architecture

> 信息架构目标：按用户任务和对象生命周期组织 Current 的强能力，而不是按模型类型或现有组件文件组织页面。

## 1. IA 原则

1. 全局、项目、单集、对象、任务五个作用域分开。
2. 四阶段是单集生产导航；角色/场景/道具和图像/视频不是全局阶段。
3. 页面负责稳定工作域，覆盖层负责当前对象的短事务或深度细节。
4. 同一对象只能有一个权威编辑入口契约；其他页面是投影或快捷入口。
5. 任务反馈同时存在对象内联、批次、历史和全局四层。
6. 技术 Provider 设置与创作工作区分开，但 Capability 结果在生成位置可见。

## 2. 站点地图

```text
LocalMiniDrama
├─ 开始 / Start
│  ├─ 从想法创建项目
│  ├─ 导入剧本 / 小说
│  ├─ 导入项目 ZIP / 剧集包
│  └─ 打开已有项目
├─ 项目 / Projects
│  ├─ 项目列表
│  └─ 项目详情
│     ├─ 概览
│     ├─ 剧集
│     ├─ 项目资产
│     ├─ 分镜视频
│     ├─ Delivery
│     └─ 导入 / 导出 / 外部协作
├─ 单集 Studio
│  ├─ 剧本 Script
│  │  ├─ Draft Revision
│  │  ├─ Story Scene 导航
│  │  ├─ Diff / Approval
│  │  └─ Revision History
│  ├─ 设定 Setup
│  │  ├─ 角色
│  │  ├─ Location
│  │  ├─ 道具
│  │  ├─ StyleSpec
│  │  ├─ Voice Profile
│  │  └─ 标准模式 / Canvas（P2）
│  ├─ 分镜 Storyboard
│  │  ├─ Shot Package Inspector
│  │  ├─ Prompt / Capability / Generate
│  │  ├─ Candidate / History / Post-process
│  │  └─ Shot Rail / Timeline Draft
│  └─ 短片 Film
│     ├─ Shot Review
│     ├─ Episode Timeline
│     ├─ Picture Lock
│     └─ Delivery / Download
├─ 资产中心 / Assets
│  ├─ 角色库
│  ├─ Location 库
│  ├─ 道具库
│  ├─ 通用媒体
│  └─ 来源 / 使用位置
├─ 任务中心 / Tasks
│  ├─ 活动任务
│  ├─ 失败 / Unknown
│  ├─ 批次
│  └─ 历史 / 成本
└─ 设置 / Settings
   ├─ Provider 与模型
   ├─ ComfyUI Workflow
   ├─ Prompt / Scene Model Map
   ├─ 生成与语言
   ├─ 存储与安全
   ├─ 导入 / 导出配置
   └─ 实验能力
```

## 3. 信息层级

| 层级 | 主对象 | 时间尺度 | 用户问题 | UI 容器 |
|---|---|---|---|---|
| 全局 | Project、Library、Task、Settings | 周/月 | 我在哪个工作域？ | Global Shell / Page |
| 项目 | Project、Episode、Project Asset、Delivery | 多集 | 这个项目整体怎样？ | Project Page |
| 单集 | Episode、Stage、Revision、Timeline | 天/周 | 这集进行到哪一步？ | Studio Shell / Stage Page |
| 对象 | Asset、Shot、Candidate | 分钟/小时 | 当前对象缺什么、改什么？ | Inspector / Drawer |
| 执行 | Job、Attempt、Batch | 秒/小时 | 任务在做什么、能否恢复？ | Inline + Task Center |

## 4. 全局 IA

### 4.1 Projects

项目列表只负责搜索、排序、状态扫描和继续工作。项目卡显示：封面、标题、集数、最近编辑、阶段摘要、阻塞/失败数。重命名、导出和删除进入 Context Menu。

项目详情负责：项目资料、剧集、项目资产摘要、分镜视频、Delivery 和交换入口。AI Provider 配置不放在项目详情主体。

### 4.2 Assets

资产中心按业务实体而不是文件扩展名为主导航：角色、Location、道具、通用媒体。每个资产显示来源、项目使用位置、Variant、Selected Appearance 和文件状态。

“项目资产”与“公共库”不再是两套互不相干的编辑器：资产中心展示来源和作用域；导入到项目时明确选择 `reference` 或 `copy`。

### 4.3 Tasks

任务中心是跨页面追溯，不替代对象内联状态。默认聚焦活动、失败、unknown；历史可按项目/集/对象/Provider/成本筛选。

### 4.4 Settings

设置按责任拆分。Provider/Workflow 负责连接与能力；生成设置负责用户默认值；存储/安全负责路径、密钥状态和本地网络。实验能力集中，不散落在普通工作页。

## 5. Project IA

```text
Project Header
├─ 项目身份：封面、名称、简介
├─ 默认约束：画幅、语言、StyleSpec
├─ 健康摘要：失败任务、stale、缺失媒体
└─ 主动作：继续上次工作 / 新建剧集

Project Tabs
├─ 概览：剧集与状态
├─ 资产：项目使用的 Character / Location / Prop
├─ 分镜视频：逐镜 selected 结果
├─ Delivery：整集交付产物与历史
└─ 更多：项目包、剧集包、外部 AI 协作
```

“分镜视频”和“Delivery”不能混在同一媒体列表：前者属于 Shot Selection，后者属于 PictureLock 的整集产物。

## 6. Studio IA

### 6.1 Studio Shell 常驻信息

- 返回项目；
- Project 名称；
- Episode 选择器；
- Script / Setup / Storyboard / Film 阶段轨；
- 当前 Revision/Timeline 摘要；
- stale、失败、活动任务聚合；
- 全局任务和设置入口。

Shell 不显示钱包或强制账户，也不持有阶段业务表单。

### 6.2 Script

| 区域 | 内容 |
|---|---|
| Scene Navigator | Story Scene、字数、警告和当前定位 |
| Script Editor | Draft Revision 正文和结构化编辑 |
| Revision Bar | dirty/saving/saved、当前批准版本、Diff、批准动作 |
| History Drawer | Revision 来源、时间、hash、批准和下游影响 |

### 6.3 Setup

| 区域 | 内容 |
|---|---|
| Stage Toolbar | Story Scene 筛选、资产类型、数量、标准/Canvas、重新提取、批量、Style |
| Asset Grid | 资产身份、主形象、Variant、声音、完整性、stale |
| Detail Drawer | 描述、媒体候选、生成/上传、Variant、Voice、来源、使用位置 |
| Batch Modal | 范围、跳过、Provider、参数、估算和提交 |

### 6.4 Storyboard

| 区域 | 内容 |
|---|---|
| Stage Toolbar | Story Scene、镜头统计、导入/提取、批量、Timeline revision |
| Shot Inspector | 当前镜头输入和引用依赖 |
| Intent Editor | 分时码、动作、对白、Prompt、Provider、参数与预检 |
| Result Panel | 选用结果、候选、历史、任务和后处理 |
| Shot Rail | 顺序、时长、选择、完成度、stale 和序列操作 |

### 6.5 Film

| 区域 | 内容 |
|---|---|
| Review Toolbar | 完成数、问题筛选、连续播放、Picture Lock、Delivery |
| Player | 当前 selected Shot 或 Delivery 预览 |
| Issue Panel | 缺失、未选用、stale、音频/字幕问题 |
| Episode Timeline | Story Scene、Shot 段、时长、锁定和 Delivery 状态 |

Film 阶段默认不显示 Provider 技术参数；需要重生成时返回对应 Shot，并保持上下文。

## 7. 信息所有权

| 信息 | 权威工作域 | 其他位置如何出现 |
|---|---|---|
| 项目资料 | Project Detail | Studio Header 只读摘要 |
| Draft/Approved Script | Script | Setup/Storyboard 只显示来源版本和 stale |
| Story Scene | Script Revision | Setup/Storyboard 作为筛选和分组 |
| 资产身份/Variant | Setup / Asset Center | Shot Inspector 绑定具体版本 |
| Shot 内容/引用 | Storyboard | Film 只读摘要并跳回编辑 |
| Candidate/Selection | Storyboard Result | Project 媒体与 Film 使用 selected 投影 |
| Timeline/PictureLock | Film | Project Detail 显示状态和产物 |
| Delivery | Film / Project Delivery | 任务中心显示执行历史 |
| Provider Config | Settings | 生成条只显示选择、能力和测试状态 |
| Job | Task Runtime | 对象内联和任务中心投影 |

## 8. 筛选、选择与业务变更

必须区分：

- 筛选改变可见集合，不改变绑定；
- 当前对象选择改变 Inspector/Drawer 上下文；
- 多选只建立批量作用域；
- 绑定资产改变 ShotRevision；
- 选用 Candidate 改变业务 Selection；
- 批准 Revision 改变下游基线；
- Picture Lock 冻结 Timeline 和 Selections；
- Delivery 生成新产物。

这些动作使用不同动词、视觉反馈和确认级别。

## 9. 空间与模式

标准模式和 Canvas 是同一数据的不同视图：

- 标准模式优化扫描、比较和批量；
- Canvas 优化关系、选择和高级工作流组；
- 二者的筛选可以独立，业务数据不能独立；
- 切换模式保持当前对象、选中范围和未保存状态；
- Canvas 关闭时 P0/P1 主流程完整。

## 10. 不进入 IA 的内容

- 钱包、充值、团队、社区、返利和平台发布；
- 独立 2D/3D 专业工具；
- 视频重绘；
- FreeCreate 旧页面；
- 按 Provider 建立一级导航；Provider 是执行能力，不是用户工作目标。
