# 外部单集制作包来源追溯与字段投影收敛设计

**状态：** 待评审

**日期：** 2026-09-06

**范围：** 外部 AI JSON 单集制作包导入、项目分集列表、剧集制作页、角色/场景/道具字段投影、历史导入数据回填

## 1. 背景

项目已经支持在项目详情页导入外部 AI 生成的单集制作包。导入流程会保存原始 JSON、规范化 JSON、文件名、SHA-256、匹配决策和生成器元数据，但这些审计信息没有查询接口和前端入口。用户只能看到导入后的业务数据，无法确认源文件是否包含某个字段、系统是否进行了兼容转换，以及资源是新建还是复用了已有记录。

项目 5 的实际问题暴露了字段合同与正式数据模型之间的差异：

- 外部文件没有人物顶层 `appearance`，但人物默认变体含有 `appearance`。导入器只读取顶层字段，导致人物编辑弹窗外貌为空。
- 外部 Schema 没有定义 `role` 和 `personality`，而人物数据表和项目详情编辑器需要这两个字段。
- 场景包使用 `state`，项目详情编辑器只读取 `time`；场景 `description` 又被拼接进 `prompt`，没有独立持久化。
- 道具表和编辑器支持 `type`，外部 Schema 与导入 SQL 没有该字段。
- 分镜 `notes` 被 Schema 接受，却没有正式投影位置。
- 复用已有资产时不会覆盖资产内容，但当前 UI 不展示匹配决策，用户无法判断源 JSON 与最终业务数据为何不同。
- 较早导入的数据可能没有把后来新增的 `audio_plan` 和 `production_profile` 写入正式剧集字段。

这些现象的共同根因不是外部 AI 请求失败，而是外部合同、兼容规范化、数据库投影、API 投影和前端编辑之间没有一份可验证的字段覆盖清单。

## 2. 与现有设计的关系

本设计增量扩展：

- `2026-09-02-single-episode-production-package-import-design.md`
- `2026-09-05-storyboard-av-prompt-integrity-design.md`

既有的三步预览、目标空白判定、资产匹配、事务原子性、引用校验和原始审计快照保持不变。本设计补足以下能力：

1. 外部制作包合同升级与旧包适配。
2. 人物、场景、道具和分镜的完整字段投影。
3. 导入时生成可读的字段投影报告。
4. 项目页和制作页查看导入来源。
5. 对历史导入执行保守、幂等、可证明的回填。

若旧设计允许已定义字段静默不投影，本设计以“正式投影或明确标记为仅审计”覆盖该规则。

## 3. 目标

1. 用户能从每个外部导入分集查看原始 JSON、规范化 JSON、导入元数据和匹配/投影报告。
2. 新版外部 JSON 明确提供项目人物、场景和道具编辑所需要的字段。
3. 旧版 JSON 继续可导入，并通过确定性规则恢复能够恢复的字段。
4. Schema 中已定义的字段不得静默丢失：必须进入正式业务字段或被明确列为 `audit_only`。
5. 历史回填不覆盖用户在导入后手工修改的内容，不向数据库写入推测数据。
6. 项目 5 中人物外貌和场景字段可从已有审计数据恢复；源文件未提供的性格、角色类型和道具类型保持“未提供”。

## 4. 非目标

- 不调用外部 AI 补写缺失的性格、角色类型或道具类型。
- 不根据人物描述猜测 `role` 或 `personality`。
- 不要求浏览器获取或保存用户本地文件的完整绝对路径。
- 不改变“复用已有资源时默认不覆盖内容”的既有安全规则。
- 不把导入来源挂到共享角色、场景或道具上；来源仍属于分集导入操作。
- 不实现多次覆盖导入或导入版本回滚。

## 5. 方案选择

采用完整收敛方案：来源双入口、合同版本升级、旧包兼容规范化、字段映射补齐、导入报告、历史数据保守回填。

未采用的方案：

- 仅增加查看来源：只能解释问题，无法阻止后续导入继续产生空字段。
- 只添加若干兜底映射：能够修复已知表现，但仍无法发现未来新增字段是否被静默丢弃。

## 6. 总体流程

```text
浏览器读取原始 JSON 文本
  → 识别 schema/version
  → Schema 与业务规则校验
  → Legacy Adapter / Canonical Normalizer
  → 生成字段投影计划与预览警告
  → 用户确认资产创建/复用决策
  → 单事务写入正式业务数据
  → 通过正常读取路径执行投影完整性校验
  → 保存原始快照、规范化快照与导入报告
```

规范化器是所有兼容规则的唯一入口。预览、正式导入、投影校验和历史回填必须复用相同的字段规则，不得各自实现一套不同的兜底。

## 7. 外部合同版本

### 7.1 版本支持

- `1.0`：作为 legacy 包继续接受，允许缺少新字段，但产生明确警告并执行确定性兼容。
- `1.1`：作为新提示词和示例文件默认版本，要求完整业务字段。
- 不识别的未来版本拒绝导入，提示当前支持版本范围；不能把未知版本当作 `1.0` 猜测处理。

### 7.2 人物字段

`1.1` 的 `characters[]` 增加并要求：

```json
{
  "role": "main",
  "personality": "冷静、警惕，压力下仍善于快速判断"
}
```

`role` 只允许 `main`、`supporting`、`minor`。现有的 `appearance`、`image_prompt`、`negative_prompt` 和 `voice_profile` 在 `1.1` 中继续要求非空。人物状态仍通过 `variants[]` 表达。

### 7.3 场景字段

场景继续使用以下独立语义：

- `name`：地点或场景名称。
- `state`：当前视觉/剧情状态，如“深夜停电”“凌晨安静状态”。
- `description`：空间和陈设描述。
- `atmosphere`：氛围与声画气质。
- `image_prompt`：纯生图提示词。
- `negative_prompt`：负向约束。

`state` 不等同于旧项目字段 `time`，两者不得互相覆盖。

### 7.4 道具字段

`1.1` 的 `props[]` 增加必填 `type`，例如“关键道具”“随身物件”“背景物件”。该值仍是可扩展字符串，不引入封闭枚举。

### 7.5 分镜备注和扩展字段

`storyboards[].notes` 是已知字段，保存到 `storyboards.production_metadata.import_notes`。对于 `additionalProperties` 接受但系统暂不消费的未知字段：

- 原值完整保留在 `episode_imports.raw_json` 和 `normalized_json`。
- 字段路径记录到导入报告的 `audit_only_fields`。
- 不把任意未知字段自动写进业务表，避免污染正式合同。

## 8. 兼容规范化规则

### 8.1 默认人物状态选择

对每个人物确定一个默认状态：

1. 优先选择唯一的 `is_default=true` 状态。
2. 未标记默认状态时选择数组第一个状态。
3. 多个状态同时标记默认时继续沿用现有业务校验并拒绝导入。

### 8.2 人物基础字段回退

当 `1.0` 人物顶层字段为空时：

- `appearance` 从默认状态的 `appearance` 回退。
- `image_prompt` 从默认状态的 `image_prompt` 回退。
- `negative_prompt` 从默认状态的 `negative_prompt` 回退；默认状态也为空时保持空值。
- `voice_profile` 没有状态级等价字段，不进行回退。

每一次回退都进入 `derived_fields`，包含源路径、目标路径和使用规则。例如：

```json
{
  "source": "characters[0].variants[0].appearance",
  "target": "characters[0].appearance",
  "rule": "default_variant_fallback"
}
```

`role`、`personality` 和道具 `type` 不从描述中推断。旧包缺失时保留 `null`，分别产生 `CHARACTER_ROLE_MISSING`、`CHARACTER_PERSONALITY_MISSING` 和 `PROP_TYPE_MISSING`。

### 8.3 场景规范化

- `description` 保持独立字段。
- `image_prompt` 保持独立字段，不能再生成“描述 + 图片提示词”的拼接值。
- `state` 保持独立字段。
- `time` 仅保留项目内旧数据或用户手工输入，外部包不根据 `state` 自动生成 `time`。

### 8.4 规范化稳定性

同一原始文本必须得到逐字段相同的规范化结果。规范化不得调用 AI、读取当前数据库资产内容或依赖当前时间。资产匹配是规范化之后的独立阶段。

## 9. 正式数据投影

### 9.1 人物

| 规范化字段 | 数据库字段 |
|---|---|
| `role` | `characters.role` |
| `description` | `characters.description` |
| `personality` | `characters.personality` |
| `appearance` | `characters.appearance` |
| `image_prompt` | `characters.polished_prompt` |
| `negative_prompt` | `characters.negative_prompt` |
| `voice_profile` | `characters.voice_style` |
| `source_key` | `characters.source_key` |

项目详情人物编辑器不得把数据库中的空 `role` 在打开时自动转换为 `minor`。空值应显示“未指定”；只有用户明确选择并保存时才写入角色类型。

人物编辑器的基础区保留名称、类型、描述、性格和外貌；“生成参数”折叠区展示声音风格、图片提示词和负向提示词，避免已导入字段只能使用、无法查看。

### 9.2 场景

给 `scenes` 增加可空 `description TEXT`，并完整投影：

| 规范化字段 | 数据库字段 |
|---|---|
| `name` | `scenes.location` |
| `state` | `scenes.state` |
| `description` | `scenes.description` |
| `atmosphere` | `scenes.atmosphere` |
| `image_prompt` | `scenes.prompt` |
| `negative_prompt` | `scenes.negative_prompt` |
| `source_key` | `scenes.source_key` |

场景 API 同时返回 `time`、`state`、`description`、`atmosphere`、`prompt` 和 `negative_prompt`。项目详情编辑器显示地点、时间、状态、描述，并在“生成参数”折叠区展示氛围、图片提示词和负向提示词。

### 9.3 道具

| 规范化字段 | 数据库字段 |
|---|---|
| `name` | `props.name` |
| `type` | `props.type` |
| `description` | `props.description` |
| `image_prompt` | `props.prompt` |
| `negative_prompt` | `props.negative_prompt` |
| `source_key` | `props.source_key` |

道具编辑器在现有字段之外展示负向提示词。

### 9.4 剧集和分镜

- `episode.source_key` 保存到 `episodes.production_profile.source_key`。
- `episode.duration_target_seconds`、`episode.notes`、`generation_profile` 和生成器相关生产信息继续进入 `episodes.production_profile`。
- `audio_plan` 进入 `episodes.audio_plan`。
- `storyboards[].notes` 进入 `storyboards.production_metadata.import_notes`。
- 其余分镜视听字段继续遵循 2026-09-05 的 Canonical AV Contract。

### 9.5 复用资产

复用已有角色、场景或道具时继续不覆盖正式资产内容。导入报告必须记录：

- 外部 `source_key`。
- 复用目标 ID 和名称。
- 决策来源：自动建议或用户选择。
- 哪些外部字段因为复用规则未写入。
- 分镜最终绑定到哪个目标资产或人物状态。

因此“源 JSON 有值、正式资产显示另一个值”会成为可解释结果，而不是静默差异。

## 10. 投影完整性校验

建立明确的字段投影登记表。每个 Schema 已知字段必须声明为：

- `persisted`：进入正式业务字段。
- `derived`：经确定性转换后进入正式业务字段。
- `audit_only`：有意只保留在审计快照和导入报告。

没有登记的已知字段属于开发错误。导入事务提交前，通过项目正常读取服务回读新建记录并比较所有 `persisted/derived` 字段。发生不一致时抛出 `PACKAGE_PROJECTION_MISMATCH` 并回滚整个事务。

复用资产不比较外部字段与目标内容，只比较引用绑定和报告中声明的复用结果。

## 11. 导入报告持久化

给 `episode_imports` 增加：

```sql
import_report TEXT
```

标准结构：

```json
{
  "version": 1,
  "created": [],
  "reused": [],
  "derived_fields": [],
  "missing_fields": [],
  "audit_only_fields": [],
  "warnings": [],
  "projection": {
    "status": "verified",
    "verified_at": "2026-09-06T00:00:00.000Z"
  }
}
```

报告与正式业务写入处于同一个事务中。预览返回的警告和正式报告使用相同构建器；正式报告额外包含最终目标 ID 和投影校验结果。

## 12. 来源查询 API

### 12.1 分集摘要

现有剧目详情响应中的每个分集增加轻量 `import_source`：

```json
{
  "source_filename": "第一集.json",
  "schema_name": "local-mini-drama.episode-package",
  "schema_version": "1.0",
  "source_sha256": "...",
  "imported_at": "2026-09-04T15:14:27.811Z"
}
```

普通创建的分集返回 `import_source: null`。摘要不包含原始 JSON，避免项目详情一次加载多个最高 10 MB 的文本。项目详情和制作页都复用现有剧目数据，因此无需为每张卡片发起独立请求。

### 12.2 完整来源

新增：

```text
GET /api/v1/episodes/:episodeId/import-source
```

返回：

- 文件名、Schema、版本、SHA-256、导入时间。
- `raw_json_text`：逐字保留的原始文本。
- `normalized_json_text`：规范化后的 JSON 文本。
- `match_decisions`：解析后的对象。
- `generator_metadata`：解析后的对象。
- `import_report`：解析后的对象。

无记录返回 `404 IMPORT_SOURCE_NOT_FOUND`。JSON 辅助列损坏时仍返回原始文本和元数据，并用 `parse_warnings` 指出无法解析的列，不能让审计页面整体不可用。

`source_filename` 在写入、响应和下载时都只按 basename 处理，不接受目录分隔符或将其解释为服务器路径。下载响应需要清理控制字符并提供安全的兜底文件名。来源接口只返回文本和结构化审计数据，不读取 `source_filename` 指向的文件系统位置。

当前流程只允许空白集导入，正常情况下一个分集只有一条来源记录。读取时仍按 `imported_at DESC, id DESC` 选择最新记录，为异常历史数据提供确定行为。

## 13. 前端入口与交互

### 13.1 项目详情主入口

`/drama/:id` 的每张外部导入分集卡片显示“外部 JSON”标签。卡片底部从单一“进入制作”调整为：

```text
查看来源                     进入制作 >
```

- “查看来源”使用独立按钮语义和 `@click.stop`。
- 卡片主体继续点击进入制作。
- 普通分集不显示标签和来源按钮，现有卡片布局保持不变。
- 标签颜色使用现有信息/主色体系，不引入新的强警告颜色；外部来源是属性，不是错误状态。

### 13.2 制作页次入口

`/film/:id?episode=...` 顶部集数选择器旁，在当前集存在 `import_source` 时显示紧凑、可点击的“外部 JSON”标签。点击打开同一来源弹窗。不增加大尺寸按钮，避免顶部操作拥挤。

### 13.3 复用弹窗

新增独立的 `EpisodeImportSourceDialog`，由项目详情和制作页复用。弹窗包含：

1. **原始 JSON**：默认标签页，原样文本，只读，支持复制和按原始文件名下载。
2. **规范化数据**：格式化后的规范化 JSON，只读。
3. **导入报告**：显示创建、复用、兼容回退、缺失字段、仅审计字段和警告。

弹窗顶部展示文件名、导入时间、Schema 版本和完整 SHA-256，并提供哈希复制。原始内容必须作为文本渲染，禁止使用 `v-html`。

打开弹窗后才请求完整来源。切换标签页不重复请求；切换到另一个分集时清空上一个分集状态。请求失败在弹窗内显示可重试错误，不影响项目页面。

### 13.4 原始路径说明

浏览器 `File` API 只可靠提供文件名，不能读取用户机器上的完整绝对路径。本设计不增加虚假的 `source_path`。弹窗文案说明“浏览器导入仅保存原始文件名”，并以原始 JSON、哈希和导入时间作为可验证来源。

## 14. 历史数据回填

新增一次性、幂等的历史投影回填。它只读取已有 `episode_imports` 快照，并遵循以下保护规则：

1. 只处理仍能解析且 Schema 可识别的导入记录。
2. 只处理该次导入决策为 `create` 的资产；复用资产绝不改写。
3. 通过 `episode_id + source_key` 和关联表定位记录，不按名称模糊匹配。
4. 只填充空字段，已有非空值视为用户或后续流程结果并保留。
5. 人物 `appearance/polished_prompt/negative_prompt` 可按默认变体规则回填。
6. 新增的场景 `description` 可从原始包回填。
7. 场景 `prompt` 只有在仍精确等于旧算法生成的“description + image_prompt”时才拆回纯 `image_prompt`；不相等则视为已修改并保留。
8. 场景 `state` 已存在时保留；为空且源包有值时回填。
9. 剧集 `audio_plan/production_profile` 只在正式字段为空时从快照恢复。
10. 分镜 `notes` 只在 `production_metadata.import_notes` 不存在时回填。
11. 源文件没有的 `role/personality/type` 保持空值，不生成占位语义。

每条导入记录在独立数据库事务中完成“正式字段回填 + 导入报告更新”。单条记录无法解析或回填失败时回滚该条记录，记录可定位错误后继续处理其他记录，不能留下半写入状态。

回填生成或补全 `import_report`，列出实际回填项、跳过项和原因。重复运行不得继续改变数据。

项目 5 的预期结果：

- 人物外貌从默认状态回填并在编辑器中显示。
- 人物性格和未提供的角色类型保持“未指定”。
- 场景状态与描述能够独立显示，图片提示词不再混有描述前缀。
- 原始文件未提供的道具类型保持“未指定”。
- 如果旧包含有音频或生产配置且正式字段为空，则恢复这些字段。

## 15. 错误与警告

新增或标准化：

- `UNSUPPORTED_PACKAGE_VERSION`
- `CHARACTER_ROLE_MISSING`
- `CHARACTER_PERSONALITY_MISSING`
- `CHARACTER_BASE_FIELD_DERIVED`
- `PROP_TYPE_MISSING`
- `PACKAGE_PROJECTION_MISMATCH`
- `IMPORT_SOURCE_NOT_FOUND`
- `IMPORT_SOURCE_AUDIT_PARSE_WARNING`

`1.1` 必填字段缺失属于阻断错误；`1.0` 对应缺失属于可确认警告。兼容回退属于信息性警告，必须在预览和导入报告中可见。

## 16. 数据迁移与兼容

- 给 `scenes` 增加可空 `description`，不重写普通旧场景。
- 给 `episode_imports` 增加可空 `import_report`。
- 新增按 `episode_id` 和导入时间读取来源所需的索引。
- 旧 `1.0` 包继续导入；上游提示词模板和示例改为输出 `1.1`。
- 现有 API 字段只增不删，旧前端不会因新增 `state/description/import_source` 失败。
- 人物编辑器不再用 `minor` 替换空角色类型，但已有明确 `minor` 数据保持不变。
- 历史回填失败不应阻止服务启动；记录可定位的错误并保留原数据。数据库结构迁移失败仍按现有迁移策略处理。

## 17. 测试策略

### 17.1 合同与规范化

- `1.0` 人物顶层外貌为空、默认变体有值时正确回退。
- 未标记默认状态时稳定选择第一个状态。
- 多默认状态继续被业务校验拒绝。
- `role/personality/type` 不从描述推断，并产生精确警告。
- `1.1` 缺少必填字段时拒绝导入。
- 未知版本拒绝导入。
- 同一输入多次规范化结果一致。

### 17.2 正式投影

- 人物全部字段通过正常剧目详情 API 回读一致。
- 场景状态、描述、氛围、图片提示词和负向提示词独立回读。
- 道具类型与负向提示词回读一致。
- 分镜备注进入 `production_metadata.import_notes`。
- 已知但未登记字段使测试或导入失败。
- 任一投影校验失败时事务零写入。

### 17.3 复用与报告

- 复用资产不被覆盖。
- 报告包含目标 ID、未写入字段和最终引用关系。
- 预览警告与正式导入报告使用相同字段规则。
- 未知扩展字段完整保留并出现在 `audit_only_fields`。

### 17.4 历史回填

- 对真实旧包结构回填人物外貌和场景描述。
- 不覆盖非空人物、场景、剧集和分镜字段。
- 不修改复用资产。
- 只有符合旧拼接算法的场景提示词才拆分。
- 连续运行两次，第二次数据库无变化。
- 无法解析的审计记录被跳过并记录错误。

### 17.5 来源 API 与前端

- 普通分集 `import_source=null`，外部导入分集返回轻量摘要。
- 完整来源接口返回逐字一致的 `raw_json_text`。
- 无来源、损坏辅助 JSON、非法分集 ID 均得到稳定响应。
- 项目卡片的来源操作不触发制作页跳转。
- 制作页切换集数后来源标签同步变化。
- 复制、下载、加载失败和重试行为正确。
- 深浅主题下标签、弹窗和代码文本可读。

### 17.6 全量验证

```bash
cd backend-node && node --test test/*.test.js
cd frontweb && node --test test/*.test.js
cd frontweb && npm run build
```

另外使用浏览器复验 `/drama/5`：项目 5 的来源弹窗能打开真实原始 JSON，人物外貌和场景字段显示符合本设计，未提供的性格明确保持为空。

## 18. 验收标准

1. 外部导入分集在项目详情卡片和制作页顶部均有来源入口，普通分集不显示。
2. 原始 JSON 文本、文件名、哈希、导入时间、规范化数据和匹配报告均可查看。
3. 新 `1.1` 包中的人物、场景、道具和分镜已知字段没有静默丢失。
4. 旧 `1.0` 包人物外貌可从默认状态确定性回退，并在预览中说明来源。
5. 场景 `state`、`description` 和 `image_prompt` 独立持久化和编辑。
6. 复用资产的未覆盖字段在导入报告中明确可见。
7. 历史回填不覆盖任何已有非空值，重复执行不产生额外变化。
8. 项目 5 中可恢复字段完成恢复；源文件未提供的字段没有被伪造。
9. 后端测试、前端测试和前端构建全部通过。
10. 根目录 `CHANGELOG.md` 的 `[未发布]` 修复与优化条目同步更新。

## 19. 实施顺序

1. 补充失败测试，建立合同版本、规范化器和投影登记表。
2. 增加数据库字段与来源摘要/详情读取。
3. 修正人物、场景、道具、剧集和分镜投影及事务内验证。
4. 生成并持久化导入报告。
5. 实现保守历史回填及幂等测试。
6. 实现复用来源弹窗和项目详情主入口。
7. 实现制作页顶部次入口并补齐资源编辑字段。
8. 更新上游 AI 提示词、Schema 示例和导入说明。
9. 运行全量自动化、前端构建与项目 5 浏览器验收。
10. 更新根目录 `CHANGELOG.md`。

每一步先建立失败测试，再做最小实现。不得用前端显示兜底掩盖数据库空值，也不得在历史回填中覆盖用户修改。
