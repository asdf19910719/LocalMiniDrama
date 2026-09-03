# 最终修复波报告 — 单集制作包导入(final review 发现)

- 日期:2026-09-03
- 基线 HEAD:b668fc5(feat: h3 draft drawer flow)
- 范围:最终全分支评审的 3 个发现(B-1 必修,B-2 / B-3 建议修),全部修复。

## B-1(Important)H3 草稿 flush 失败仍放行候选,本地编辑静默失效

**根因**:`frontweb/src/composables/useVideoGenerationPanel.js` 的 `generateCandidates` 先
`await flushH3DraftSave()` 再查 `h3UiState.canGenerate`;`saveH3DraftText` 失败时内部
catch(置 `h3Dirty=true` + setError)不上抛,flush 后 `canGenerate` 仍依据 DB 里旧的
valid 草稿放行,随后以 `draft.final_compiled_prompt`(旧文)提交,且先前保存错误被
`setError(null)` 清除。

**修复**(`frontweb/src/composables/useVideoGenerationPanel.js`):
- flush 后检查 `h3Dirty` 仍为 true 时直接 `return` 中止提交,不进入 `setError(null)`
  的提交流程;保存错误由 `saveH3DraftText` 设置并保持原样展示(不清除)。
- 边缘态兜底:若 `h3Dirty` 为 true 但 `error.value` 为空(如草稿已被清空导致 flush
  空转),以新增错误码 `H3_DRAFT_SAVE_FAILED` 设置错误,summary 为
  "H3 提示词保存失败,请重试后再生成候选。"(登记进 `ERROR_SUMMARIES`)。
- 展示通道说明:该组合式函数无 UI 依赖,沿用现有 H3 门禁(`H3_DRAFT_NOT_READY`)的
  `setError` 机制,由 `VideoGenerationPanel.vue` 的 el-alert 渲染 `error.summary`,
  与任务书中 ElMessage 提示的用户可见效果等价。

**测试**:`frontweb/test/videoGenerationPanel.test.js` 新增
"rejects candidate generation when the pending draft save failed and keeps the save error":
saveH3Draft 抛错后调用 generateCandidates,断言未发出候选请求且 `error.summary`
仍为原始保存失败信息(修复前 RED:提交发出,captured 1 !== 0)。

## B-2(建议修)制作包校验器不拦分镜内重复引用

**根因**:`backend-node/src/services/episodePackageValidator.js` 未拦截同一分镜内重复的
(character_ref, variant_ref) 对或重复 prop_ref;导入时 DB 域 `idx_sbv_variant` 唯一索引
会裸错,或 INSERT OR IGNORE 静默去重导致参考图槽位数漂移。

**修复**:在 `validateBusinessRules` 分镜循环内新增两条同分镜重复检查,错误码统一为
`PACKAGE_REF_DUPLICATE`,path 携带分镜 source_key(如
`storyboards[sb_01].character_refs[1]` / `storyboards[sb_01].prop_refs[1]`),message
说明重复项(引用键 + "同一分镜内重复引用会导致参考图槽位错位")。与跨分镜语义严格区分:
跨分镜重复引用同一资产合法,不报错(基准示例 sb_01/sb_02 均引用 prop_hot_coffee 仍
0 errors 0 warnings)。错误码经 `episodePackageService.validatePackage` 原样透传,无需
服务端注册。

**测试**:`backend-node/test/episodePackageValidator.test.js` 新增 describe
`PACKAGE_REF_DUPLICATE` 共 3 条:重复 variant_ref 对、重复 prop_ref、跨分镜同资产
(相同人物状态对落在 sb_02)不产生任何错误。既有用例全部保持绿。

## B-3(建议修)槽位接口失败静默回退 legacy 口径可发错参考图

**根因**:`frontweb/src/views/FilmCreate.vue` 的 `collectSlotReferenceAbsoluteUrls`
catch 静默回退 `collectSbOmniReferenceAbsoluteUrls`(取角色主图而非状态图),H3 门禁
不校验 refs 与快照一致,降级路径可能给 H3 提交错误参考图。

**修复**:
- `frontweb/src/utils/videoModeCompatibility.js` 新增纯函数
  `slotReferenceFallbackPolicy(cfg)`:H3 配置(`isH3ComfyUiConfig`)返回 `'abort'`,
  其余返回 `'legacy_fallback'`。
- `collectSlotReferenceAbsoluteUrls` catch:`console.warn('[FilmCreate] 参考图槽位接口加载失败', sbId, error)` 留痕;
  按 `getActiveVideoAiConfig()`(带 TTL 缓存)判定,H3 下 `ElMessage.error('参考图槽位加载失败,请重试')`
  并返回 `null`(中止信号);非 H3 保留 legacy 兜底(可用性优先)。
- 4 处调用点全部接住 `null` 中止:
  1. `onGenerateSbVideo`:`if (omniRefs === null) return`(H3 单镜路径实际不经过该收集,
     此为配置竞态的防御);
  2. 批量视频 worker:记入 `batchVideoErrors`("参考图槽位加载失败,已跳过")+ failed+1
     + 跳过该分镜,连贯帧链路上 `prevVideoItem` 置空;
  3. / 4. 两条一键流水线:在 `pipelineWithRetry` 回调内
     `throw new Error('参考图槽位加载失败')`,按流水线失败记账(重试即重新拉取槽位,
     瞬时故障可自愈)。

**测试**:新增 `frontweb/test/filmCreateSlotReferenceFallback.test.js` 3 条:
- 纯函数行为测试:`slotReferenceFallbackPolicy` 仅对 H3 配置返回 abort(comfyui+
  h3-continuity-v1 / minimax-h3-* → abort;seedance、其他 comfyui 模型、null → legacy_fallback);
- 组件逻辑静态测试(沿用 `filmCreateExtraStrip.test.js` 的函数体提取口径):收集函数
  catch 含 console.warn、策略判定、ElMessage 提示、`return null`,且非 H3 分支保留
  legacy 兜底;
- 4 处调用点均存在 null 中止守卫(return / 批量跳过 / 流水线抛错)。

## 验证(verification-before-completion)

| 命令 | 结果 |
| --- | --- |
| `cd backend-node && node22 --test test/*.test.js` | tests 559 / pass 559 / fail 0(基线 556 + 3) |
| `cd frontweb && node --test test/*.test.js` | tests 166 / pass 166 / fail 0(基线 162 + 4) |
| `cd frontweb && npm run build` | 成功(仅既有的 chunk >500kB 提示) |

TDD:三项修复均先写测试并确认 RED(B-1:captured 1!==0;B-2:两条重复用例
"应报同分镜内人物状态引用重复/道具引用重复";B-3:缺失导出的 SyntaxError + 静态断言未命中),
再实现转 GREEN。

## 涉及文件

- `frontweb/src/composables/useVideoGenerationPanel.js`(B-1)
- `frontweb/test/videoGenerationPanel.test.js`(B-1)
- `backend-node/src/services/episodePackageValidator.js`(B-2)
- `backend-node/test/episodePackageValidator.test.js`(B-2)
- `frontweb/src/utils/videoModeCompatibility.js`(B-3)
- `frontweb/src/views/FilmCreate.vue`(B-3)
- `frontweb/test/filmCreateSlotReferenceFallback.test.js`(B-3,新增)

## 疑虑 / 备注

1. B-1 的"ElMessage 提示"以组合式函数既有的 `setError` + 面板 el-alert 呈现(文案
   一致),避免向无 UI 依赖的 composable 引入 element-plus;如需弹 toast 可后续在面板层
   统一加。
2. B-3 流水线路径走 `pipelineWithRetry`,槽位接口持续失败时该分镜会重试 3 次(每次都会
   提示一次),属可接受的失败噪音;重试语义同时让瞬时故障可自愈。
3. `videoModeCompatibility.isH3ComfyUiConfig`(FilmCreate 侧 H3 判定)与
   `useVideoGenerationPanel.isH3Config`(额外接受 `minimax_h3_director_r2v` 模型名)口径
   存在既有差异,本波未改动;B-3 采用 FilmCreate 自身的 H3 口径,与其 h3DirectorMode
   判定一致。
