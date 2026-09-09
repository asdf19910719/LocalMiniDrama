# LocalMiniDrama VNext Interaction Specification

## 1. 交互原则

1. Page 表示稳定工作域；Modal 表示短事务；Drawer 表示与背景对象持续关联的深度详情；Inspector 表示当前选择的结构与约束。
2. 生成、保存、批准、选用、锁定和交付必须使用不同动词和反馈。
3. 长任务有持久状态，Toast 只确认短动作。
4. 禁用必须解释原因；stale 不隐藏旧结果；错误必须提供恢复动作。
5. 所有直接操纵都有键盘/按钮替代。

## 2. 容器选择规范

### 2.1 什么使用 Page

Page 用于满足任一条件的工作：有独立 URL/恢复价值、持续超过一个短事务、改变主工作上下文、需要完整导航或大面积布局。

| 使用 Page | 原因 |
|---|---|
| Projects、Project Detail | 稳定全局/项目工作域 |
| Script、Setup、Storyboard、Film | 单集四个主阶段，可深链和恢复 |
| Assets、Tasks、Settings | 跨项目工作域 |
| 窄屏下的复杂 Drawer 内容 | 空间不足时转全屏，保留可访问性 |

不用 Page：选择风格、确认批准、配置一次批量、预览一次导入等短事务。

### 2.2 什么使用 Modal

Modal 用于“短、封闭、必须完成或取消、需要暂时阻塞背景”的事务：

- 导入/导出 Preview；
- Script Approval Diff；
- Asset Extraction Merge Preview；
- Style Selector、Voice Selector；
- Batch Preflight；
- Delivery 配置；
- 删除、覆盖、放弃未保存内容等确认。

Modal 规则：不超过两层；主动作唯一；关闭不静默应用；打开后焦点进入，关闭后回触发点；耗时执行提交后关闭 Modal，状态转对象内联/任务中心。

### 2.3 什么使用 Drawer

Drawer 用于“长、可滚动、与背景选择持续关联、关闭后继续扫描”的详情：

- Asset/Variant 详情和媒体候选；
- Voice Profile 详情；
- Script Revision History；
- Candidate/Generation History；
- Job Detail；
- Provenance/使用位置。

Drawer 可跟随列表选择切换对象；切换前处理 dirty。右侧 Drawer 互斥，默认不与另一个右侧账户/设置抽屉叠加。

### 2.4 什么使用 Inspector

Inspector 是 Page 内固定或可调宽区域，围绕当前选择显示“结构、依赖、验证和高频参数”：

- Storyboard 的 Shot Package 输入；
- Canvas 的当前节点；
- Film 的问题镜头摘要（窄版 Inspector）；
- 需要同屏观察结果的关键参数。

Inspector 不承担跨项目资产管理，不显示全部历史，不弹出阻塞背景。支持分组折叠、宽度拖拽、恢复默认和键盘聚焦。

### 2.5 什么使用 Context Menu

Context Menu 只放局部、低频或危险动作：

- Project：重命名、导出、归档/删除；
- Asset：复制、查看来源、从项目移除、删除；
- Shot：前后插入、复制、合并、从 Timeline 移除；
- Candidate：下载、查看 Job、比较、删除；
- Canvas node：聚焦、复制、解除绑定、删除。

主点击区永远用于选择/打开对象。菜单禁用项可聚焦，并显示原因；危险项与普通项分组。

### 2.6 什么使用 Inline Edit

Inline Edit 用于短、单义、位置明确且可快速撤销的字段：

- Project/Episode/Asset 名称；
- Shot 标题、时长和简单标签；
- Script 正文与分时码 Prompt 的主编辑区；
- Timeline 的转场/短备注。

复杂结构、Provider 参数、资产 Variant 和删除不做 Inline Edit。轻量字段 Enter 保存、Esc 取消；正文/Prompt 显示 dirty/saving/saved，并支持 Ctrl/Cmd+S。

## 3. UI State Contract

所有可交互组件必须覆盖以下九态；不适用时也要明确原因，不能遗漏实现。

| 状态 | 视觉 | 行为 | 文案/可访问性 |
|---|---|---|---|
| `Default` | 中性表面、标准边框/文字 | 可执行默认主行为 | 名称和作用域明确 |
| `Hover` | 提升表面或边框，不能引发布局位移 | 只预示可操作，不改变数据 | 鼠标之外仍有焦点态；必要时 tooltip |
| `Selected` | 边框 + 背景 + 标记/文字，不只靠颜色 | 改变当前上下文或业务 Selection，二者需区分 | `aria-selected/checked` 与当前对象名称 |
| `Disabled` | 降低强调但保持可读 | 不执行；允许查看原因 | 显示 reason 和修复动作，不能只有灰色 |
| `Loading` | 保持布局的 skeleton/局部 spinner | 阻止依赖未加载数据的动作；不冻结无关区域 | `aria-busy`，超过阈值显示说明 |
| `Empty` | 说明为何为空和下一步 | 提供单一主要入口；筛选空可清除筛选 | 区分“尚未创建”和“无搜索结果” |
| `Processing` | 阶段文本、进度/不确定动画、任务入口 | 可离开页面；按能力允许请求取消 | 显示对象、Provider、开始时间和 Job ID |
| `Success` | 完成标记和结果摘要 | 提供查看/选用/继续动作 | 明确结果落点，不只显示“成功” |
| `Error` | 错误标记、原因层级 | 保留输入；重试/修复/技术详情 | 用户原因 → 建议 → reason code/Job ID |

补充领域态 `Stale`、`Warning`、`Partial Success`、`Unknown/Reconnecting` 在 [state-model.md](./state-model.md) 定义；它们不能被粗暴映射成 Error。

## 4. 组件状态细则

### 4.1 Button

- Default：动词明确；一个容器只有一个 primary。
- Hover：颜色/表面变化，无缩放跳动。
- Selected：仅用于 toggle/segmented，不把普通提交按钮做 Selected。
- Disabled：可通过旁边说明或 tooltip 获取 reason。
- Loading/Processing：保留宽度；防重复提交；取消是否可用由 Capability 决定。
- Success：短暂确认后恢复，持久结果在对象上显示。
- Error：按钮本身不承载长错误文本，关联 inline error。

### 4.2 Card

- Default：显示身份、摘要和当前状态；主点击为选择。
- Hover：显示低风险快捷动作，不突然出现危险删除。
- Selected：边框、check/label 与 `aria-selected`。
- Disabled：卡片仍可打开查看，只有具体动作 Disabled。
- Loading：媒体 skeleton 保持比例。
- Empty：资产空图提供上传/生成；不使用无解释灰块。
- Processing：覆盖层只遮媒体区，名称和任务入口可用。
- Success：显示 selected/current 标记和来源。
- Error：媒体区显示失败原因摘要与重试，卡片仍可编辑描述。

### 4.3 List/Shot Rail Item

Hover 与 Selected 独立；Selected 改变 Inspector。Processing、stale、missing、selected candidate 用不同图标/文字。拖拽时显示原位、落点和不可放置原因。

### 4.4 Form Field

Default 显示 label/value/unit；Hover 不代替 Focus；Disabled 保留用户值和能力原因；Loading 只影响依赖选项；Error 与 Warning 分开；保存 Success 不清空字段。

### 4.5 Media Candidate

Candidate 的 UI Selected 有两种：

- `comparison_selected`：仅当前预览焦点；
- `business_selected`：已被资产/Shot 采用。

必须使用不同文案和图标，避免“看过”被误认为“选用”。

## 5. Selection

| Selection | 作用 | 是否写业务状态 |
|---|---|---|
| 当前导航/阶段 | 定位 | 否 |
| 当前资产/Shot | Inspector 上下文 | 否 |
| 批量多选 | Batch 作用域 | 否 |
| 风格卡 pending selection | Modal 临时选择 | 否，应用后才写 |
| Candidate comparison | 预览 | 否 |
| Candidate business selection | 当前采用结果 | 是 |
| Picture Lock selection | 查看锁定版本 | 否 |

筛选变化不清空多选；显示筛选外已选数。离开批量模式时确认是否清除 selection set。

## 6. Drag & Drop

适用：文件导入、Shot 重排、Canvas 节点。每种都必须有替代路径。

文件拖入先进入验证区，不直接上传/导入正式数据。Shot 拖拽产生 Timeline Draft，保存后才形成 Revision。Canvas 拖动只改变 layout；连接/解绑调用领域命令。

拖拽反馈包括：可拖标识、拖动预览、合法落点、非法原因、完成摘要、Undo。

## 7. Batch Interaction

```text
进入多选
→ 定义范围
→ 显示已选/筛选外/跳过
→ Batch Modal 统一参数
→ Capability + 成本预检
→ 提交 Batch/Child Jobs
→ 页面可离开
→ Inline + Task Center 进度
→ Success / Partial Success / Error
→ 仅重试失败或未知
```

“全选”必须写明当前页、当前筛选还是全部对象。提交后锁定 Batch Snapshot，但不锁定对象继续编辑；编辑会影响新 Job，不改变已提交 Job。

## 8. Async Task Interaction

### 8.1 四层反馈

1. 对象内联：最靠近 Asset/Shot/Delivery；
2. Batch：聚合和子任务；
3. History：输入、尝试、成本、错误和结果；
4. Global Tasks：跨页面活动/失败/unknown。

### 8.2 取消

点击取消后立即变 `cancel_requested`，并说明仍可能计费/完成。只有 Provider 确认后显示 Cancelled。若 Provider 不支持取消，按钮 Disabled 并说明。

### 8.3 重试

- Retry Attempt：完全复用原 Snapshot；
- Recompile & Generate：用当前配置创建新 Job；
- Retry Failed Only：批次仅对失败/unknown 子项执行。

## 9. Notification

| 类型 | 使用场景 | 保留时间 |
|---|---|---|
| Inline | 对象持续状态、stale、字段错误 | 状态解除前 |
| Toast | 保存、复制、加入候选等短确认 | 3–5 秒，可访问 |
| Banner | 阶段 Gate、迁移、安全或大范围 stale | 用户处理/关闭前 |
| Badge | 活动、失败、unknown、问题数 | 聚合状态存在时 |
| Task Center | 长任务和跨页面结果 | 持久 |
| Dialog | 删除、批准、锁定、覆盖、放弃编辑 | 立即决策 |

同一事件只有一个主通知所有者。对象已显示 Error 时，不再由 store 和页面各弹一次相同 Toast。

## 10. Form 与保存

- 名称等轻量字段可 blur/Enter 保存，失败回滚并聚焦错误。
- Script、Shot Prompt、复杂 Drawer 采用显式保存或可靠自动保存，始终显示状态。
- Approval、Selection、Picture Lock、Delivery 从不由 auto-save 触发。
- Provider 改变时，兼容字段保留；不兼容字段折叠到“当前不使用”，不删除用户值。
- 离开 dirty 长表单时：保存并离开 / 放弃 / 继续编辑。

## 11. Overlay 与焦点

- 打开 Modal：焦点到标题/首个字段，背景 inert；Tab 圈定。
- 打开 Drawer：焦点到 Drawer 标题；背景可见但键盘顺序不混乱。
- 关闭：返回触发元素；触发元素已删除时返回最近同级对象。
- Context Menu：方向键移动、Enter 执行、Esc 关闭。
- Modal 内不再打开大型 Drawer；需要复杂工作时导航到 Page。

## 12. 危险与高影响动作

| 动作 | 交互 |
|---|---|
| 批准 Script Revision | Diff + 影响范围 Modal，明确批准动词 |
| 应用全局 Style | pending selection + 影响预览 |
| 删除 Project/Artifact | Confirm Dialog，显示对象名和不可恢复部分 |
| 替换 Candidate Selection | 即时可执行，保留旧选择历史；影响大时显示摘要 |
| Picture Lock | Lock Review Modal，列出镜头和问题 |
| Delivery | 配置/预检 Modal，提交后进入持久任务 |
| 迁移旧数据库 | 备份、校验和报告 Page/Banner，不用普通 Toast |

## 13. 禁止模式

- 用 Disabled 灰色但不给原因；
- 用 Toast 承担生成/合片状态；
- 单击卡片同时选择并删除/应用；
- Modal 中持续运行小时级任务且要求一直打开；
- Drawer 与右侧 Inspector 无规则重叠；
- Hover 才出现唯一关键动作；
- Inline Edit 承担复杂 Provider/Variant 结构；
- Candidate 生成成功后自动覆盖当前采用结果；
- 标准模式与 Canvas 维护不同保存逻辑。
