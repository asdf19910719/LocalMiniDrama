# Production Studio V2.1 作用域、版本、并发与依赖失效规范

日期：2026-09-08
状态：P0 权威附件，所有可写流程前置契约

## 1. Look 作用域与解析顺序

V2.1 只支持三个 Look 层级，固定优先级：

```text
Shot 特殊覆盖
> StoryScene 场次 Look
> Project Look
```

V2.1 不增加 Episode Look。需要整集特殊风格时，为本集所有场次设置同一场次 Look；避免形成难以解释的第四层继承。

解析结果必须是不可变 `ResolvedLook`：

```js
{
  projectLookVersionId,
  storySceneLookVersionId,
  shotOverrideVersionId,
  resolvedDefinition,
  positivePromptBlock,
  negativeTerms,
  fingerprint,
}
```

项目 Look 更新不直接改写任何已批准对象。新解析 fingerprint 与旧快照不同后，自动 prompt、H3/Omni 编译、受影响资产草稿、Shot Package 和 Color Gate 按依赖图变为 stale；旧媒体与旧批准版本保留。

Shot 覆盖只允许明确列出的字段，不接受任意整段 StyleSpec 覆盖。覆盖必须记录用途和来源；删除覆盖后恢复继承并产生新 fingerprint。

## 2. 资产作用域与跨集复用

- 角色、角色状态、场景资产、道具是项目级实体。
- 资产版本不可变；Episode、StoryScene 和 Shot 引用准确 `asset_version_id`，不只引用实体当前值。
- 跨集使用可以引用同一精确资产版本；每集点击进入分镜时自动把版本/hash 写入自己的 asset set snapshot，不复制媒体数据。
- 用户需要独立演化时执行“派生版本”，保留 parent version；不是复制一个无谱系的新实体。
- 公共库导入默认复制为项目实体并保存 `library_source_id/version/hash`，避免公共库后续修改令项目漂移。
- 外部 JSON 匹配顺序：项目内 `source_key` 精确匹配 → 来源 id/hash 精确匹配 → 名称相似仅提示冲突，绝不自动复用。
- 精确匹配实体时，优先引用与导入定义 fingerprint 相同的当前使用版本；只有候选而没有 current 时允许复用实体，但导入预览必须提示用户先选择使用项。

## 3. 强制事实源与一次性迁移输入

以下为 V2.1 强制事实源，不再使用“条件新增”口径。第三列只用于首次迁移读取，迁移成功后不得成为运行期写目标或兼容事实源：

| 领域 | 强制事实源 | 一次性迁移输入/当前派生读模型 |
|---|---|---|
| 阶段当前状态 | `production_stage_states` | 无 |
| 阶段历史 | `production_stage_events` | 无 |
| 剧本版本 | `episode_script_revisions` | 首次读取 `episodes.title/script_content` |
| Look 版本 | `look_profiles/look_profile_versions` | 首次读取 `dramas.style_id` |
| 资产媒体版本与 current | `production_asset_versions` + source entity current pointer | 首次读取实体 `image_url/local_path` |
| 剧集资产集合快照 | `episode_asset_set_snapshots` | 首次按旧剧集实际引用与当前媒体生成迁移快照 |
| Shot 业务输入 | `shot_packages` | 首次读取 `storyboards` 现有字段 |
| 稳定引用 | `reference_bindings` | 首次读取 `scene_id`、角色 JSON、`storyboard_props` |
| Prompt 编译 | Prompt revision 与 Provider 编译快照 | 首次读取旧 prompt/H3 draft 字段 |
| 视频候选/采用 | Director candidate/artifact + adopted pointer/event | 首次读取 `storyboards.video_url` |
| 时间线 | `director_timeline_revisions` | 旧 `video_merges` 仅迁为历史 artifact |
| 画面锁定 | `picture_lock_revisions` | 无 |
| 后期声画 | `post_revisions` | 首次读取可识别的 merge/postprocess 输出 |
| 交付 | `delivery_revisions` | API 可派生当前交付读模型，不写回旧字段 |
| Gate 豁免 | `gate_waivers` | 无 |
| 外部导入审计 | `episode_imports` | 首次读取剧集来源摘要 |

当前值必须由 immutable revision/event 加明确 current pointer 表达；禁止靠覆盖旧行保留历史，也禁止迁移后继续双写旧字段。

## 4. 版本关系

```text
ScriptRevision
  ├─ ResolvedLook fingerprint
  ├─ AssetVersion set
  └─ ShotPackageRevision
       ├─ ReferenceBinding set
       ├─ Prompt/Provider snapshot
       └─ VideoCandidateGroup
            └─ AdoptedVideoRevision
                 └─ TimelineRevision
                      └─ PictureLockRevision
                           └─ PostRevision
                                └─ DeliveryRevision
```

每个下游 revision 保存直接上游 id 和 fingerprint。查询影响时沿显式依赖边传播，不能通过更新时间猜测。

## 5. 统一并发契约

所有可写命令必须提供下列至少一种前置条件：

```text
expected_revision
expected_version
expected_fingerprint
```

| 写操作 | 必需前置条件 | 冲突码 |
|---|---|---|
| 剧本保存/提交/批准 | expected_revision | REVISION_CONFLICT |
| Look 提交/确认、资产 current 改选 | expected_version + expected_fingerprint | VERSION_CONFLICT |
| Shot Package/时段/引用保存 | expected_revision | SHOT_REVISION_CONFLICT |
| Prompt 人工覆盖/确认 | expected_revision + expected_fingerprint | PROMPT_STALE |
| 候选采用/取消采用 | expected_adoption_revision | ADOPTION_CONFLICT |
| Timeline 编辑 | expected_revision | TIMELINE_REVISION_CONFLICT |
| Picture Lock | expected_timeline_revision | PICTURE_LOCK_CONFLICT |
| Post/音频/字幕编辑 | expected_post_revision | POST_REVISION_CONFLICT |
| Delivery | expected_picture_lock_id + expected_post_revision | DELIVERY_INPUT_STALE |
| 外部 JSON 提交 | expected source hash + 事务内目标重检 | PACKAGE_HASH_MISMATCH / TARGET_NOT_BLANK |
| 高级画布命令 | 与目标对象相同条件 | 复用目标对象冲突码 |

冲突统一返回 HTTP 409，并携带 current revision/version/fingerprint 和安全刷新入口；不得 last-write-wins，不得自动重放非幂等命令。

后台任务完成时只附加 candidate/artifact/attempt，不直接覆盖用户已采用或批准的 current pointer。输入已 stale 的结果仍保存，但标 `based_on_stale_input=true`。

## 6. 失效规则

失效发生在“新上游 revision 被确认或生成输入实际绑定的版本指针发生变化”时；项目资产 current 改选不静默改写已确认剧集快照，只把可能受影响的剧集标记为可刷新。

| 事件 | stale 范围 | 保留内容 |
|---|---|---|
| 批准新 ScriptRevision | 受影响场次、资产解析、Shot、Prompt、Timeline 后续 | 旧批准剧本与所有媒体 |
| 批准新 Project Look | 所有继承项目 Look 的自动 prompt/Shot/Color | 场次/Shot 覆盖和旧媒体 |
| 批准新 StoryScene Look | 该场次下继承项 | 其他场次 |
| 批准 Shot 覆盖 | 当前 Shot 编译与候选输入 | 其他 Shot |
| 重新确认 Episode Asset Set | 使用变化版本的 Shot/Prompt | 旧 episode snapshot、旧媒体和未引用变化版本的 Shot |
| 修改 Shot 时长/时段/引用 | Prompt、候选输入、直接相关时间线 | 旧候选和旧时间线历史 |
| 改用视频候选 | 下游 anchor、受依赖后镜、timeline/picture/post/delivery | 未采用候选 |
| 改 continuity anchor | 直接依赖的后镜 Prompt/候选并继续传播 | 源视频 |
| 派生并锁定新 Timeline | 旧 Post/Delivery 不变；新链待处理 | 旧 Picture Lock/交付 |
| 修改 PostRevision | 只令 Delivery stale | Picture Lock 不变 |

“是否刷新”只控制是否立即启动重新解析、重编或生成任务；永远不能跳过 stale 写入。

## 7. Picture Lock、Post Revision 与 Delivery

Picture Lock 只锁画面剪辑决定：视频候选、顺序、入出点、画面变速、转场和最终画面时长。

- 锁定后该 Timeline revision 不可修改；画面变化必须派生新 Timeline 并重新 Picture Lock。
- 对白、旁白、音乐、音效、字幕、水印、调色和超分参数属于 `PostRevision`，绑定一个 `picture_lock_id`。
- 不改变画面时长的音频/字幕调整只派生 Post Revision，不打破 Picture Lock。
- 会改变画面时长或镜头边界的字幕/音频操作不得在 Post 层执行，必须回到 Timeline 派生新版本。
- Delivery Revision 固定绑定 `picture_lock_id + post_revision_id + output manifest/hash`；任何一项 stale 都不能通过 Delivery Gate。

## 8. 高级画布 canonical 入口

Canonical URL 固定为当前阶段路由加 `?mode=advanced`：

```text
/projects/:projectId/episodes/:episodeId/:stage?mode=advanced
```

V2.1 只提供该 canonical URL。旧 `/film/:id/canvas`、`/drama/:id/canvas`、`/projects/:projectId/episodes/:episodeId/canvas` 路由及其页面直接删除，不承担跳转或回退。高级画布没有独立保存协议，所有写操作调用标准模式相同的 command API。

## 9. 自动选片边界

V2.1 不进行基于构图、角色身份、动作、风格或相似度的自动选片，不自动采用候选。

系统可以自动运行技术检测：文件可读、解码、时长、帧率、分辨率、黑帧、冻结、缺帧、音频流/削波。通过只产生 `technically_eligible=true`，用户仍需采用；不存在“相似度达到阈值自动选片”的 V2.1 配置。
