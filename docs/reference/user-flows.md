# RunningHub RHSTORY 核心用户流程与状态

> 流程统一使用：`Trigger → Action → Feedback → State Change → Result`。
> 实机未执行的付费、删除、发布动作，只描述可见入口与合理状态契约，不宣称服务结果已验证。

## 1. 从想法创建剧本项目

| 阶段 | 内容 |
|---|---|
| Trigger | 用户只有故事脑洞或长文本 |
| Action | 选择“有想法”，输入内容，发起生成剧本 |
| Feedback | 字数/限制、按钮可用性、生成任务进度、错误提示 |
| State Change | 无项目 → 项目草稿 → 剧本生成中 → script_draft |
| Result | 进入剧本页，得到可编辑但尚未确认的剧本 |

为什么有效：入口用用户现有素材分流，隐藏底层模型选择；生成结果先进入草稿，避免 AI 输出被自动当成批准版本。

关键状态：空输入时主按钮 Disabled；生成中 Processing；网络或模型失败 Error；部分章节可解析时应为 Partial Success，并保留成功内容。

## 2. 导入并解析现成剧本

| 阶段 | 内容 |
|---|---|
| Trigger | 用户已有 txt/docx/md/xlsx 剧本 |
| Action | 拖拽、选择文件或粘贴内容，点击解析 |
| Feedback | 文件名/格式/大小、解析进度、集/场/角色预览、缺失字段 |
| State Change | Initial → file_selected → parsing → script_draft / parse_partial / parse_failed |
| Result | 创建可复核的项目/单集和结构化场次 |

为什么有效：文件解析与内容确认分开；格式错误不会污染正式项目，部分成功有明确可修复项。

## 3. 编辑、保存和确认剧本

| 阶段 | 内容 |
|---|---|
| Trigger | 用户进入剧本页或修改已确认正文 |
| Action | 通过左栏定位场次，在正文编辑；点击“保存草稿”或“重新确认剧本” |
| Feedback | 未保存标记、保存成功提示；确认时应展示影响范围 |
| State Change | script_draft → draft_saved；确认后 → script_confirmed；已确认版本再编辑 → draft_diverged |
| Result | 草稿可恢复；确认版本成为设定/分镜的上游基线 |

两个按钮的语义必须分开：保存只是持久化，确认才允许更新下游基线。若下游已存在，重新确认应把受影响资产/镜头标为 stale，而不是直接删除。

## 4. 提取并管理设定资产

| 阶段 | 内容 |
|---|---|
| Trigger | 剧本已确认，或用户主动进入设定检查 |
| Action | 自动/重新提取角色、场景、道具；编辑名称与描述；添加缺失资产 |
| Feedback | 资产数量标签、卡片占位图、生成/确认状态、出镜范围 |
| State Change | assets_empty → extracted；人工编辑 → edited；重新提取 → merge_preview / stale |
| Result | 得到结构化资产清单，供生图和镜头绑定使用 |

重新提取是高影响动作：成熟流程应先显示新增、更新、保留和潜在删除，而不是直接覆盖人工修改。

## 5. 生成、上传并选用资产形象

| 阶段 | 内容 |
|---|---|
| Trigger | 资产卡无图、需要新候选或剧情派生状态 |
| Action | 打开详情，选择模型/画幅/分辨率/预设/画风并生成；或本地上传；查看候选后选用 |
| Feedback | 预计价格、引用/参数校验、排队与进度、候选缩略图、任务 ID、失败原因 |
| State Change | extracted → validating → queued → generating → candidate_ready → selected/approved；失败 → failed |
| Result | 资产获得主形象或带语义名称的派生版本 |

为什么有效：AI 生成和本地上传是同级来源；生成只创建候选，选用才改变当前主版本，避免历史被覆盖。

## 6. 选择全局画风

| 阶段 | 内容 |
|---|---|
| Trigger | 新项目需要视觉基调，或用户主动更换风格 |
| Action | 打开画风库，按“我的风格/全部/真人/3D/2D”筛选或搜索，选择预设 |
| Feedback | 缩略图、名称、当前选中态、说明、推荐模型、工具栏风格摘要 |
| State Change | no_look → look_selected；已存在生成物时 → look_changed_with_stale_dependents |
| Result | 后续资产/镜头生成继承新的风格绑定 |

观察到的卡片式浏览能降低风格发现成本；不应复制“点击即无提示生效”。更稳妥的是选择、预览影响、应用三步，并保留旧结果。

## 7. 配置角色音色

| 阶段 | 内容 |
|---|---|
| Trigger | 角色需要对白或声音身份 |
| Action | 从智能音色设计、预设音色库、本地上传、提取音色中选择；试听并绑定 |
| Feedback | 试听播放、来源与描述、生成价格、历史结果、当前绑定 |
| State Change | voice_unset → previewing → voice_candidate → voice_bound |
| Result | 角色获得可在镜头中选择和试听的音色 |

试听和绑定分开，使探索不会意外改变项目。智能生成是异步付费任务，必须沿用统一任务状态。

## 8. 批量生成资产

| 阶段 | 内容 |
|---|---|
| Trigger | 多个资产处于缺图或过期状态 |
| Action | 打开批量生成，多选资产，统一模型/预设/尺寸，确认批次 |
| Feedback | 已选数量、跳过规则、总价、逐项进度、成功/失败/跳过统计 |
| State Change | selected_set → batch_validating → batch_running → succeeded / partial_success / failed |
| Result | 多个资产独立产生候选；失败项可单独重试 |

批次状态不能覆盖子任务状态。部分成功时，成功候选立即可用，失败项保留输入快照和重试入口。

## 9. 建立或导入分镜

| 阶段 | 内容 |
|---|---|
| Trigger | 资产已准备，或用户已有 xls/xlsx/docx 分镜脚本 |
| Action | 重新提取分镜、导入文件、预览镜头；系统可建议合并过短镜头 |
| Feedback | 场次数、镜头数、预计总时长、字段缺失、合并说明 |
| State Change | storyboard_empty → extracting/importing → storyboard_draft / import_partial |
| Result | 形成有稳定顺序和目标时长的镜头列表 |

自动合并只能优化时长组织，不能静默改写剧情、对白和音效。导入预览应区分新增、覆盖、合并和跳过。

## 10. 编辑单镜镜头包

| 阶段 | 内容 |
|---|---|
| Trigger | 用户在底部镜头轨选择一个镜头 |
| Action | 在左栏绑定角色/场景/道具/音色/参考素材；在中栏编辑分时码和 `@` 引用；调整时长、模型与规格 |
| Feedback | 当前镜头高亮、引用芯片、缺失/过期提示、参数可用/禁用、预计价格 |
| State Change | shot_selected → shot_edited；引用变化 → shot_dirty / references_missing；保存后 → shot_ready |
| Result | 得到可验证、可生成、可追溯的 Shot Package |

左输入、中意图、右结果、下序列的布局让一次生成的因果链同屏可见。引用失效时保留文字是有用降级，但必须明确标识 `text-fallback`，不能伪装成强参考仍有效。

## 11. 插入、删除、合并和排序镜头

| 阶段 | 内容 |
|---|---|
| Trigger | 节奏、Provider 时长上限或叙事需要变化 |
| Action | 在镜头轨前后插入、打开局部菜单删除、合并相邻镜头或拖拽重排 |
| Feedback | 镜号/时长即时更新；合并超限时禁用并解释；删除需显示影响 |
| State Change | timeline_revision_n → timeline_revision_n+1；受影响候选 → stale |
| Result | 得到新的镜头顺序和总时长预算 |

镜头轨是序列操作的自然位置。危险动作应留在对象局部菜单，不能与“选择镜头”共享主点击区。

## 12. 单镜视频生成与候选处理

| 阶段 | 内容 |
|---|---|
| Trigger | 镜头包通过引用、模型能力、时长与余额预检 |
| Action | 点击生成；等待队列与运行；查看预览/历史；选用、重试或后处理 |
| Feedback | 价格、queued/running、耗时、任务 ID、成功候选、失败原因、实际费用 |
| State Change | ready → queued → running → candidate_ready / failed；选用后 → selected_candidate |
| Result | 当前镜头拥有一个被采用的视频候选 |

前端超时不应直接标记 Provider 失败；刷新后需要按任务 ID 对账。重试应说明是复用原快照还是用当前配置重新编译。

## 13. 批量生成镜头产物

| 阶段 | 内容 |
|---|---|
| Trigger | 多镜缺少故事板、分镜图、站位图或视频 |
| Action | 在“批量生成”选择产物和范围，确认模型、并发与费用 |
| Feedback | 预检清单、总价、总体进度、逐镜状态、可取消项 |
| State Change | batch_created → queued/running → success / partial_success / failed |
| Result | 产物逐镜回填；失败镜头可筛选和重试 |

四类产物必须分开，因为它们的输入、费用、状态和下游用途不同。

## 14. 2D/3D 预演

| 阶段 | 内容 |
|---|---|
| Trigger | 镜头需要更明确的构图、站位或机位参考 |
| Action | 进入 2D 画板或 3D 导演台，创建草图/机位，保存并截图/录制 |
| Feedback | 当前工程、对象、图层/机位、缩放、小地图、保存状态 |
| State Change | no_previs → editing → previs_saved → reference_bound |
| Result | 产生 `composition_previs` 或运动参考并绑定回镜头 |

它们是可选高级工具，不应成为普通镜头生成的硬门禁。

## 15. 短片逐镜审片与成片合成

| 阶段 | 内容 |
|---|---|
| Trigger | 分镜阶段通过门禁，至少部分镜头已有采用视频 |
| Action | 选择镜头播放、连续播放已完成镜头、定位缺失项；全镜完成后保存至成片 |
| Feedback | 当前镜头/总数、完成数、时间线缩略图、禁用原因、合成进度 |
| State Change | video_in_progress → all_shots_ready → export_queued → exported / export_failed |
| Result | 项目“我的视频—成片”出现独立整集产物 |

保存至成片不是下载逐镜文件，而是创建新的异步合成任务。某镜虽有候选但未选用时，应视为未完成。

## 16. 视频重绘

| 阶段 | 内容 |
|---|---|
| Trigger | 用户已有合法授权的旧视频 |
| Action | 选择文件夹/视频，系统识别集数；设置语言、画幅、分辨率、画风，创建重绘项目 |
| Feedback | 格式/大小/时长/命名约束、识别结果、失败文件、版权提示 |
| State Change | upload_empty → files_selected → validating → repaint_project_created |
| Result | 重绘项目进入项目列表的独立分类 |

内部生成、失败恢复和质量未实测，不应把入口存在等同于完整流程成熟。

## 17. 主要功能状态矩阵

| 功能 | Initial | Empty | Loading | Processing | Success | Error | Disabled | Partial Success |
|---|---|---|---|---|---|---|---|---|
| 剧本 | 初次进入 | 无正文 | 加载修订 | 生成/解析 | 草稿已保存或已确认 | 解析/保存失败 | 无输入、权限/门禁 | 部分集/场解析成功 |
| 资产设定 | 未提取 | 分类为 0 | 加载卡片/缩略图 | 提取/生图 | 候选生成并选用 | 单资产任务失败 | 缺描述、模型不兼容 | 批量部分成功 |
| 画风 | 未绑定 | 我的风格为空 | 加载缩略图 | 应用/重新编译依赖 | 风格已绑定 | 资源加载失败 | 当前任务锁定或不可用 | 部分旧产物进入 stale |
| 分镜 | 未提取 | 无镜头 | 加载当前场次 | 提取/导入/批量 | 镜头包可生成 | 导入或校验失败 | 剧本未确认/合并超限 | 部分镜头导入成功 |
| 单镜生成 | 未发起 | 无候选 | 加载历史 | queued/running | 候选可预览 | Provider/落库失败 | 引用缺失、余额不足 | 通常不适用；多输出任务可部分成功 |
| 短片 | 未解锁 | 无可播视频 | 加载时间线 | 合成/增强 | 成片已生成 | 合成失败 | 未全镜选用 | 增强批次部分成功 |
| 资产库 | 初次进入 | 无搜索结果/无自建素材 | 加载分页 | 导入/绑定 | 资产进入目标 | 导入冲突 | 无项目上下文 | 部分素材导入成功 |
| 消耗看板 | 默认周期 | 无任务记录 | 加载统计 | 汇总计算 | 总览与明细可见 | 统计加载失败 | 无权限 | 部分指标缺失但明细可用 |

## 18. 通知与结果落点

- Toast 只适合短暂确认：“草稿已保存”“已加入候选”。
- 对生成/合成等长任务，必须有持久的对象内联状态和任务历史，不能只靠 Toast。
- 成功消息要说明结果落点：“已保存为候选”“已加入项目—成片”。
- 错误应分三层：用户可懂原因 → 可执行建议 → 技术详情/任务 ID。
- Partial Success 必须同时展示成功、失败、跳过数量，并提供“仅重试失败项”。
