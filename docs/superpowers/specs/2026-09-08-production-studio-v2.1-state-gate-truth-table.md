# Production Studio V2.1 三层状态机与 Gate 真值表

日期：2026-09-08
状态：P0 权威附件，所有 UI/API/表结构必须遵守

## 1. 核心决定

V2.1 不再把“内容处于什么版本”“任务正在做什么”“当前 Gate 能否通过”压成一个状态字段。三层状态彼此独立：

```text
内容/阶段状态 Content State
+ 任务状态 Task State
+ Gate 评估 Gate Evaluation
= UI 同时展示的真实状态
```

例如：阶段仍是 `approved`，一个无关的重试任务可以是 `failed`；只有当前批准输入的依赖发生变化，阶段才变为 `stale`。任务失败本身不得覆盖批准历史。

## 2. 权威枚举

### 2.1 阶段内容状态（持久化）

```text
not_started
in_progress
ready_for_review
approved
stale
```

- `blocked` 不是阶段内容状态，而是 Gate 当前评估结果。
- `processing/failed/generating` 不是阶段内容状态，而是任务聚合。
- `draft` 用于对象 revision；阶段统一使用 `not_started/in_progress`，不再使用 `draft`。

### 2.2 对象 revision 状态（持久化）

通用集合：

```text
draft
ready_for_review
approved
superseded
stale
```

`locked` 仅用于不可变时间线/Picture Lock/Post/Delivery revision，不作为角色、场景资产或普通 prompt 的通用状态。

### 2.3 视频等阶段候选与采用状态

```text
candidate: persisted candidate row
preview_selected: client-only comparison selection
adopted: persisted current projection pointer
approved: immutable approved object revision
```

本节适用于 VideoCandidate 等需要独立审看/采用的阶段产物。`preview_selected` 不写数据库；刷新页面后消失。`adopted` 写数据库中的 V2.1 current pointer 与采用事件，可撤销或改选；改选时旧候选不删除。`approved` 只能批准当前 adopted 输入的不可变快照。项目资产图片/音色不使用这组三层交互，按第 5 节“点击候选即使用、进入分镜时自动检查”执行。

VideoCandidate 的首次任务、比较和采用由 Storyboard 发起；Cut 的镜头审核、补充候选和局部重拍读写同一候选组与 adopted pointer。若 Timeline 已固定某个 candidate id，改选 adopted 只更新默认候选；只有用户明确选择替换时，才派生新的 Timeline revision。页面归属不得衍生出第二套状态。

### 2.4 任务状态（持久化或适配）

```text
queued
running
waiting_external
succeeded
failed
cancelled
unknown
```

任务动作由 capability 返回：`canCancel/canRetry/canResume/canSkip`。UI 不为不支持的任务显示动作。

### 2.5 Gate 评估（计算结果）

```text
pass
warn
block
```

Gate 返回 blockers/warnings、准确目标和输入 fingerprint。`block` 不改写阶段 revision；修复输入后重新评估即可消失。

### 2.6 豁免（独立决策记录）

`waived` 不是对象或阶段状态。它是不可变 Gate exception：

```text
id, gate, owner_type, owner_id, owner_revision,
blocker_code, reason, created_by, created_at,
expires_on_change, revoked_at
```

只有标记为 `waivable=true` 的 blocker 可豁免；原因必填。结构损坏、并发冲突、缺少文件、Provider 不支持、交付编码失败不可豁免。默认 `expires_on_change=true`，输入 fingerprint 改变后自动失效。

## 3. 阶段转换真值表

| 当前 | 命令/事件 | 条件 | 新状态 | 副作用 |
|---|---|---|---|---|
| not_started | 首次保存草稿 | episode 存在 | in_progress | 创建 current revision |
| in_progress | submit-review | Gate 无 blocker | ready_for_review | 冻结待审 fingerprint |
| in_progress | submit-review | Gate 有 blocker | in_progress | 返回 `STAGE_BLOCKED`，不改状态 |
| ready_for_review | edit | 基于 current revision | in_progress | 待审快照保留为历史 |
| ready_for_review | approve | expected revision/fingerprint 匹配且 Gate pass | approved | 写批准事件和批准者 |
| ready_for_review | reject | 原因必填 | in_progress | 写退回事件 |
| approved | upstream-changed | 依赖 fingerprint 改变 | stale | 保留批准 revision 和产物 |
| approved | unrelated-task-failed | 不影响已批准 fingerprint | approved | 仅显示 failed task badge |
| stale | create-revision | 基于旧批准版派生 | in_progress | 保留旧批准版可查看 |
| stale | keep-approved-for-preview | 仅低风险预览 | stale | 记录使用旧批准 revision，不通过最终 Gate |
| stale | submit-review | 新 revision Gate pass | ready_for_review | 等待重新批准 |

任何 mutation 的 `expected_revision/expected_version/expected_fingerprint` 不匹配时返回 409，不改变状态。

## 4. 对象转换真值表

| 当前 | 操作 | 新状态 | V2.1 current pointer/read model | 是否令下游 stale |
|---|---|---|---|---|
| draft | 编辑 | draft | 指向当前草稿 revision | 否，尚未批准 |
| draft | 提交确认 | ready_for_review | 否 | 否 |
| ready_for_review | 退回 | draft | 否 | 否 |
| ready_for_review | 批准 | approved | approved/current 指向该 revision | 仅首次建立依赖 |
| approved | 编辑 | 新 draft；旧 approved 保持 | draft 与 approved pointer 分离 | 否，直到批准新 revision |
| approved | 批准新 revision | 旧 revision superseded；新 revision approved | approved/current 指向新 revision | 是，按依赖图传播 |
| stale | 重新编译/派生 | 新 draft | 否 | 维持 stale 直到批准 |

## 5. 资产候选使用与进入分镜自动检查

| 层级 | 写库 | 可撤销 | 更新 V2.1 current pointer | 触发 stale | 可通过 Gate |
|---|---|---|---|---|---|
| 候选生成/上传成功 | 是 | 可归档 | 否 | 否 | 否 |
| 点击候选“使用此图/音色” | 是 | 是，可改选旧候选 | 是 | 不改写已确认剧集快照；对应剧集标记可刷新 | 只满足该对象“已有可用项” |
| 点击进入分镜 | 是，跳转时自动保存不可变 asset set snapshot | reopen 后再次进入时可刷新 | 否 | 上游 current 变化后该剧集提示可刷新 | 自动满足 Asset Gate；无额外确认动作 |
| 豁免 | 是，不可变决策 | 可撤销 | 否 | 输入变化后过期 | 仅对可豁免 blocker |

项目资产媒体不再建立 `preview_selected → adopted → approved` 三层用户动作。技术检测只能标记候选 `technically_eligible`；生成和上传都不会自动更新 current，用户点击候选卡后才保存为当前使用项。剧本、Look、Shot、Video、Picture、Color 和 Delivery 仍按各自阶段状态与确认规则执行。

场景和道具的 current pointer 必须定位到“对象 ID + 剧情状态 ID + 视图参考 ID”。同一对象的另一状态或另一视图参考有自己的 current pointer，任一组合改选不得覆盖其他组合。生成模式属于创建候选时的任务参数，不进入 current pointer；四宫格拆分出的视图候选也不得自动改写 current。

## 6. Gate 真值表

| Gate | 必需输入 | block | warn/可豁免 | 通过后的事实 |
|---|---|---|---|---|
| Script | 非空剧本、可解析基本结构 | 空文本、revision 冲突 | 场次过长、名称近似 | approved script revision |
| Look | 有效 StyleSpec、Probe/定义、PromptStyleGate | 风格缺失、快照不一致 | Probe 数不足 | approved look revision |
| Asset | Look 已确认；本集实际使用的人物状态、场景和道具有可解码 current version；所选音频策略明确要求人物音色时，该音色也有可解码 current version | 必需当前使用项缺失、引用不存在、媒体离线/不可解码、快照冲突；条件必需的音色缺失 | 非必需人物音色和其他辅助资产只警告或可豁免 | 只包含本集实际引用项的 immutable episode asset set snapshot + fingerprint |
| Shot | 时码闭合、引用有效、Provider preflight | 空时段、时间码错、能力不兼容 | 动作密度、低成本预演缺失 | approved Shot Package revision |
| Video | 每个必需分镜有 adopted 候选 | 无候选、离线/不可解码、时长非法 | 明确跳过的非必需镜头 | approved video selection set |
| Picture | 时间线媒体完整、无时长冲突 | 离线媒体、重叠、必需任务运行中 | 非关键空隙策略 | immutable picture_lock revision |
| Color | 当前 picture lock 的处理结果 | 处理失败、版本不匹配 | 逐镜例外 | approved color/post artifact |
| Delivery | picture+post revision、编码/音频/字幕/hash | 任一版本 stale、文件损坏 | 可选水印缺失 | immutable delivery revision |

## 7. UI 显示规则

页面不得把三层状态合成一个会丢信息的枚举。标准展示：

```text
[阶段主状态]  [阻塞 2]  [运行 1 / 失败 1]
```

- 主状态只来自阶段内容状态。
- blocker badge 来自 Gate。
- 任务 badge 来自任务聚合。
- `approved + failed` 合法：批准仍显示已确认，同时显示失败任务；只有依赖变化才显示 stale。
- 列表空间不足时仍保留文字和数量，不能只靠颜色。

## 8. 项目聚合

项目卡不保存“项目阶段状态”。每个阶段的项目摘要由剧集状态统计产生：

- 无剧集：not_started；
- 任一剧集 stale：显示 stale count；
- 任一剧集 ready_for_review：显示待确认 count；
- 全部剧集 approved：approved；
- 其他情况：in_progress；
- blocker 和任务始终作为独立数量显示。
