# 产品测试地图（Product Test Map）

> 生成时间：2026-09-12 · 依据：路由表 `frontweb/src/router/index.js` + 实际浏览确认 · 用于发布前全量 QA 的页面/功能清单。
> 状态标记：UNTESTED / TESTING / PASS / FAIL / BLOCKED / RETEST（见 test-progress.md）

## 1. 页面清单

| # | Page | Route | 入口 | 主要功能 | 状态 |
|---|------|-------|------|---------|------|
| P01 | 项目列表 | /projects | Rail·项目 | 项目卡/筛选/搜索/排序/新建/导入备份/卡片菜单(回收站) | TESTING |
| P02 | 新建项目 | /projects/new | 列表「新建项目」 | 三来源卡/名称/题材/画幅/目标时长/创建 | UNTESTED |
| P03 | 项目概览 | /projects/:id | 列表卡片 | Hero/操作菜单(导出备份/归档导入/回收站/数据工具)/编辑资料抽屉/风格闭环/素材摘要/四阶段卡深链 | UNTESTED |
| P04 | 剧集中心 | /projects/:id/episodes | 概览 Tab | 列表/两层筛选/排序/新建剧集目标选择器/行菜单六项/导入·协作弹层/外部任务卡 | UNTESTED |
| P05 | 外部 AI 向导 | /projects/:id/episodes/external-ai | 剧集页菜单 | 8 步向导/任务包下载/结果校验/冻结快照导入/离页恢复 | UNTESTED |
| P06 | 制作包导入 | /projects/:id/episodes/import-package | 剧集页菜单 | 粘贴 JSON/资产匹配决策/预览/确认导入 | UNTESTED |
| P07 | 小说拆集 | /projects/:id/episodes/import-novel | 剧集页菜单 | 粘贴文本/章节预览/逐集创建 | UNTESTED |
| P08 | 已有视频登记 | /projects/:id/episodes/import-video | 剧集页菜单 | 目标选择器/媒体字段/登记 | UNTESTED |
| P09 | 项目归档导入 | /projects/import-archive | 列表「导入项目备份」 | 路径校验(七项矩阵)/导入 | UNTESTED |
| P10 | 项目素材 | /projects/:id/assets | 概览 Tab | 列表/筛选/五标签详情/状态卡/音色/批量生成/生成 Sheet/删除恢复 | UNTESTED |
| P11 | 剧本阶段 | /projects/:id/:eid/script | 概览/剧集 CTA | 三起点/编辑排版/自动保存/场次结构/AI 辅助/确认/历史/比较 | UNTESTED |
| P12 | 本集设定阶段 | …/assets | 阶段导航 | 三 Tab 引用投影/详情抽屉/音色抽屉/就绪状态/进入分镜 | UNTESTED |
| P13 | 分镜阶段 | …/storyboard | 阶段导航 | 五区/时段编辑/分镜图候选/H3/视频生成/采用/镜头轨/批量 | UNTESTED |
| P14 | 成片阶段 | …/cut | 阶段导航 | 审片播放器/连播/门禁/豁免/合成/版本/导出 MP4·SRT | UNTESTED |
| P15 | 任务中心 | /tasks | Rail·任务 | 三页签/筛选/详情四区/取消/重试/focus 深链 | UNTESTED |
| P16 | 资产库 | /library | Rail·资产库 | 三类列表/筛选/详情/添加到资产库双路径/用于项目 | UNTESTED |
| P17 | 常规设置 | /settings | Rail·设置 | 创作默认值/备份/目录检测/工作区迁移向导/放弃更改 | UNTESTED |
| P18 | 高级数据工具 | /settings/data-tools | 设置页/Rail | 完整性检查/重定位/物理清理/迁移记录 | UNTESTED |
| P19 | AI 配置 | /ai-config | Rail | Provider 卡/测试连接/默认通道/业务映射/导入导出 | UNTESTED |
| P20 | 自由创作 | /quick-create | Rail·更多工具 | 配置/确认/生成/历史/四去向 | UNTESTED |
| P21 | 高级画布 | /projects/:id/:eid/canvas | 分镜更多菜单 | 只读关系视图/节点落点 | UNTESTED |
| P22 | 媒体素材库 | /media-library | Rail·更多工具 | 上传/筛选/详情/删除 | UNTESTED |
| P23 | 404 页 | 任意未知路径 | 直链 | 404 呈现+返回项目 | UNTESTED |

## 2. 核心功能矩阵

| Feature | Page | Trigger | Expected Result |
|---|---|---|---|
| 新建项目 | P02 | 填名称→创建 | 列表出现新卡，进入剧集页 |
| 新建剧集 | P04 | 新建剧集→创建第 N 集 | 行出现，直达空白剧本 |
| 剧本编辑+自动保存 | P11 | 粘贴文本/编辑 | 800ms 自动保存，刷新不丢 |
| 确认剧本 | P11 | 检查并确认 | 版本 approved，进入设定 CTA |
| AI 候选 | P11 | AI 辅助→动作 | 候选生成→比较→应用 |
| 素材生成/候选/撤销 | P10 | 生成确认 Sheet | 候选出现，设当前可撤销 |
| 本集设定就绪 | P12 | 选择/生成 | readiness 状态流转，进入分镜 |
| 分镜结构创建 | P13 | 从已确认剧本创建 | 按场次生成镜头+时段 |
| 分镜图生成/采用 | P13 | 生成→设为当前 | 候选入列，当前图更新，H3 stale |
| H3 生成/保存 | P13 | 确认抽屉→生成 | 词条生成，可编辑保存 |
| 视频生成/采用 | P13 | 生成条→Sheet→提交 | 任务运行→候选→采用 |
| 整集合成 | P14 | 门禁通过→生成成片 | 合成版本出现 |
| 导出 MP4/SRT | P14 | 导出 | 文件下载/记录 |
| 任务中心 | P15 | 打开 | 任务聚合可见/详情/取消 |
| 资产库入库 | P16 | 添加到资产库 | 双路径向导完成 |
| 数据工具 | P18 | 完整性检查 | 真实扫描结果 |
| 刷新/返回恢复 | 全部 | F5/Back | 状态与 URL 一致 |

## 3. 核心实体

Project(dramas) · Episode(episodes) · ScriptRevision(episode_script_revisions) · StoryScene(story_scenes) · Character/Scene/Prop · Variant(character_variants) · Candidate(image_generations / director_*) · Storyboard+Segments · CutVersion(episode_cut_versions) · AsyncTask(async_tasks) · ExternalTask(external_ai_package_tasks) · Library(character/scene/prop_libraries) · Settings(global_settings)
