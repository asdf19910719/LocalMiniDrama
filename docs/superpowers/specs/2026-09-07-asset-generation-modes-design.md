# 角色与场景资产生图模式设计

## 背景

当前项目已经拥有角色四视图、人物状态工作台、场景单图和场景四宫格，但模式语义分散在函数名、全局复选框和不同生成通道中。角色主图始终走四视图接口，场景模式由资源区级 `sceneUseQuadGrid` 控制，人物状态没有独立模式，ChatGPT 网页通道也没有完整保存模式和负向提示词快照。

## 目标

1. 将“基础资产/状态资产”和“单图/多视图”拆成两个独立维度。
2. 角色基础资产与每个人物状态资产都能独立选择生图模式。
3. 每个场景独立选择普通单图或四宫格，不再由一个全局复选框控制全部场景。
4. API 与 ChatGPT 网页生图任务都携带并保存相同的资产模式、身份参考选择和负向提示词快照。
5. 复用现有 `CharacterVariantStudio` 右侧工作台，不新增割裂项目上下文的独立页面。

## 范围

本次实现当前项目已经具备执行能力的模式：

| 资产 | 模式 | 存储值 | 默认值 |
| --- | --- | --- | --- |
| 角色基础资产 | 单图、三/四视图 | `SINGLE`、`TURNAROUND` | `TURNAROUND`，保持现有行为 |
| 人物状态资产 | 单图、三/四视图 | `SINGLE`、`TURNAROUND` | `SINGLE` |
| 场景资产 | 单图、四宫格 | `NORMAL`、`QUAD_GRID` | `NORMAL` |

`DESIGN_SHEET`、`PANORAMA`、`TOP_DOWN` 不在本次实现范围内；接口通过统一模式校验器保留扩展边界，但 UI 不显示不可执行选项。

## 业务模型

`characters` 表示角色实体及当前基础视觉资产，`character_variants` 表示同一角色下的状态视觉资产。两类资产在用户心智中并列，但状态资产仍通过 `character_id` 归属于角色实体，以便分镜引用和身份一致性处理。

生图模式是资产属性，不是资产类型：

```text
角色实体
├── 基础资产：asset_mode = TURNAROUND
├── 白色衬衫：asset_mode = SINGLE
└── 黑色风衣：asset_mode = TURNAROUND
```

人物状态的身份参考是独立布尔选项 `use_identity_reference`：

- 开启且基础资产存在图片时，生成任务附带 `character_identity` 参考图；
- 开启但没有基础图时，仍允许生成，只在 UI 显示“当前无可用身份图”；
- 关闭时，不附加基础图，也不在 ChatGPT 执行提示词中声称已附带身份图；
- 身份参考只约束脸部、年龄感和体型，不覆盖状态服装、发型状态、姿势和版式。

## 数据设计

通过启动迁移补充以下列：

- `characters.asset_mode TEXT DEFAULT 'TURNAROUND'`
- `character_variants.asset_mode TEXT DEFAULT 'SINGLE'`
- `character_variants.use_identity_reference INTEGER DEFAULT 1`
- `scenes.asset_mode TEXT DEFAULT 'NORMAL'`
- `image_generation_tasks.asset_mode TEXT`
- `image_generation_tasks.negative_prompt_snapshot TEXT`
- `image_generation_tasks.style_snapshot TEXT`

资产表保存下次生成的默认选择；任务表保存不可变的本次生成快照。历史任务不会根据后来修改的资产模式重新解释。

## 后端模式协议

新增聚焦的模式模块，提供：

```js
normalizeAssetMode(targetType, value)
allowedAssetModes(targetType)
defaultAssetMode(targetType)
buildModePrompt(targetType, mode, prompt)
```

模式校验规则：

- `character`、`character_variant` 只接受 `SINGLE`、`TURNAROUND`；
- `scene` 只接受 `NORMAL`、`QUAD_GRID`；
- 未传值时读取资产已保存模式，再回退到类型默认值；
- 不支持的值在创建生成任务或同步生成前返回明确的 400 错误。

API 同步生成分发：

- 角色 `SINGLE` → `generateCharacterImage()`；
- 角色 `TURNAROUND` → `generateCharacterFourViewImage()`；
- 状态模式由 `generateVariantImage()` 的 `options.assetMode` 编译，`TURNAROUND` 增加多视图版式约束；
- 场景 `NORMAL` → `generateSceneSingleImage()`；
- 场景 `QUAD_GRID` → `generateSceneFourViewImage()`。

## ChatGPT 网页通道

前端创建统一图片任务时只提交目标、目标 ID、选择的模式和画幅。后端 `buildGenerationInput()` 负责重新读取可信资产数据并生成：

```text
prompt
negativePrompt
references
assetMode
styleSnapshot
```

`character_variant` 只有在 `use_identity_reference=1` 且能解析出基础角色图片时才附加身份参考。ChatGPT 包装提示词根据真实 `reference_manifest` 决定是否加入身份参考说明，不能仅凭目标类型推断存在参考图。

任务记录保存最终业务提示词、负向提示词、模式、参考图清单、风格快照和画幅。provider 执行包装可以追加“直接生成图片”等传输指令，但不能改变业务快照。

## 前端交互

### 项目详情页角色卡片

角色卡片主图下增加资产级模式选择器：

```text
[生图模式：三/四视图 ▼] [生成图片 ▼]
```

选择后立即保存 `characters.asset_mode`。现有 `ImageGenerateSplitButton` 继续负责默认模型/ChatGPT 通道选择与生成，不承担模式选择。

### 人物状态工作台

入口保持不变：角色卡片 → 状态 → 点击状态卡片或“打开工作台”。

在 `CharacterVariantStudio` 的“当前图与候选”标签中新增：

- 当前状态的生图模式选择器；
- 身份一致性开关；
- 身份参考可用状态；
- 生成按钮按当前状态模式生成。

切换状态资产时，模式和身份参考设置随当前状态切换。

### 场景卡片

删除资源区级“生成四宫格场景”复选框。每个场景卡片底部增加：

```text
[生图模式：单图 ▼] [生成图片 ▼]
```

选择后立即保存 `scenes.asset_mode`。批量生成或一键流程未显式指定模式时使用各场景保存的模式。

## 错误处理

- 模式非法：创建任务前返回 `Unsupported asset generation mode`，前端展示中文错误；
- 身份参考开启但无图片：任务继续，参考清单为空，UI 显示提示而不是报错；
- 模式保存失败：恢复控件原值并显示保存失败；
- ChatGPT 结果画幅与任务画幅不一致：本次不阻止绑定，任务详情保留画幅以便后续加入结果质量告警；
- 状态提示词为空：维持现有 `VARIANT_PROMPT_MISSING` 错误。

## 测试与验收

1. 迁移测试确认新旧数据库均补齐列和默认值。
2. 模式协议测试覆盖默认值、合法值、非法值和提示词版式。
3. 人物状态服务测试覆盖模式持久化、身份参考开关和无基础图降级。
4. 图片任务测试确认模式、负向提示词、风格快照和真实参考清单持久化。
5. 前端测试确认角色、状态、场景均展示资产级模式控件，场景全局复选框被移除。
6. 前端交互测试确认模式保存失败会回滚。
7. 运行后端相关测试、全部前端测试和前端生产构建。

## 非目标

- 不实现 RunningHub 的全景、俯视或设计表模型工作流；
- 不重构角色、状态为新的通用资产表；
- 不改变分镜引用 `character_variants` 的现有关系；
- 不修改已经生成图片的历史绑定规则；
- 不改变现有生成通道选择的交互含义。
