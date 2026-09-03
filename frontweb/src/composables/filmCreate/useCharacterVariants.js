import { ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

/**
 * 由「分镜已勾选角色 + 各自选择的人物状态」组装 links payload（纯函数，供测试与保存复用）。
 * @param {Array<{character_id: number|string, variant_id: number|string}>} selections - 按展示顺序
 * @param {number} [sortStart=1] - sort_order 起始值
 * @returns {Array<{character_id: number, variant_id: number, reference_role: string, sort_order: number, framing_note: null}>}
 */
export function buildVariantLinks(selections, sortStart = 1) {
  const list = Array.isArray(selections) ? selections : []
  const start = Number.isFinite(Number(sortStart)) ? Number(sortStart) : 1
  return list.map((s, i) => ({
    character_id: Number(s?.character_id),
    variant_id: Number(s?.variant_id),
    reference_role: 'primary',
    sort_order: start + i,
    framing_note: null
  }))
}

/**
 * 人物状态（角色变体）Composable
 * @param {object} deps - 共享依赖
 * @param {object} deps.characterAPI - 人物 API（listVariants/createVariant/updateVariant/deleteVariant/generateVariantImage）
 * @param {object} deps.storyboardsAPI - 分镜 API（updateVariantLinks）
 * @param {Function} deps.getSbCharacterIds - (sbId) => number[] 当前分镜已勾选角色 id 列表
 * @param {Function} [deps.getCharacterName] - (characterId) => string 角色名称（缺失提示用）
 * @param {object} [deps.notify] - 消息通知对象（默认 ElMessage；测试注入桩）
 */
export function useCharacterVariants(deps) {
  const {
    characterAPI,
    storyboardsAPI,
    getSbCharacterIds,
    getCharacterName,
    notify = ElMessage
  } = deps || {}

  // ── 状态数据（懒加载缓存） ─────────────────────────────
  /** characterId -> variant[]，进入角色卡状态折叠区或分镜勾选时按需加载 */
  const variantsByCharacterId = ref(new Map())
  /** characterId -> Promise<variant[]|null> 在途加载共享 promise（并发调用等待同一次请求） */
  const variantsLoadingPromises = new Map()
  /** 正在生成图片的状态 id（非 null 时禁用全部状态生图按钮，防并发重复生图） */
  const generatingVariantId = ref(null)
  const variantDefaultSettingId = ref(null)

  // ── 状态编辑弹窗 ──────────────────────────────────────
  const showVariantEditor = ref(false)
  const variantEditorCharacterId = ref(null)
  const variantEditorForm = ref(null)
  const variantEditorSaving = ref(false)

  // ── 角色卡「状态」折叠区 ───────────────────────────────
  /** 当前展开状态面板的角色 id（同一时间展开一个，null = 全部收起） */
  const variantPanelCharacterId = ref(null)

  // ── 分镜 × 人物状态选择 ───────────────────────────────
  /** sbId -> { characterId -> variantId } 用户显式选择的分镜人物状态 */
  const sbVariantSelections = ref({})
  const sbVariantLinksSaving = ref(false)

  // ── 加载 ──────────────────────────────────────────────
  /**
   * 加载角色状态列表（懒加载，重复调用直接命中缓存跳过；在途请求共享同一 promise）
   * @param {number|string} characterId
   * @param {{ force?: boolean }} [options] force=true 强制刷新（增删改后用）
   * @returns {Promise<Array|null>} 成功返回状态列表（可能为空数组=该角色暂无状态），失败返回 null
   */
  function loadVariants(characterId, options = {}) {
    const key = Number(characterId)
    if (!Number.isFinite(key)) return Promise.resolve([])
    if (!options.force && variantsByCharacterId.value.has(key)) {
      return Promise.resolve(variantsByCharacterId.value.get(key) || [])
    }
    if (variantsLoadingPromises.has(key)) {
      return variantsLoadingPromises.get(key)
    }
    const pending = (async () => {
      try {
        const res = await characterAPI.listVariants(key)
        const arr = Array.isArray(res) ? res : []
        variantsByCharacterId.value.set(key, arr)
        return arr
      } catch (e) {
        notify.error(e?.message || '加载人物状态失败')
        return null
      } finally {
        variantsLoadingPromises.delete(key)
      }
    })()
    variantsLoadingPromises.set(key, pending)
    return pending
  }

  /** 模板读取某角色的状态列表（未加载时返回空数组，不触发请求） */
  function getVariantsForCharacter(characterId) {
    return variantsByCharacterId.value.get(Number(characterId)) || []
  }

  /** 角色默认状态 id（is_default 优先，否则第一个），无状态返回 null */
  function defaultVariantIdFor(characterId) {
    const list = getVariantsForCharacter(characterId)
    if (!list.length) return null
    const def = list.find((v) => v.is_default)
    return (def || list[0])?.id ?? null
  }

  /** 展开状态列表选项的标签 */
  function variantOptionLabel(v) {
    if (!v) return ''
    return v.is_default ? `${v.name || '未命名'}（默认）` : (v.name || '未命名')
  }

  // ── 角色卡状态折叠区 ──────────────────────────────────
  function toggleVariantPanel(char) {
    if (!char?.id) return
    if (variantPanelCharacterId.value === char.id) {
      variantPanelCharacterId.value = null
      return
    }
    variantPanelCharacterId.value = char.id
    loadVariants(char.id)
  }

  // ── 状态 CRUD ─────────────────────────────────────────
  /** 打开状态编辑弹窗；variant 为空 = 新增 */
  function openVariantEditor(characterId, variant = null) {
    if (!characterId) return
    variantEditorCharacterId.value = characterId
    variantEditorForm.value = {
      id: variant?.id ?? null,
      name: variant?.name || '',
      appearance: variant?.appearance || '',
      image_prompt: variant?.image_prompt || '',
      negative_prompt: variant?.negative_prompt || '',
      is_default: !!variant?.is_default
    }
    showVariantEditor.value = true
  }

  function closeVariantEditor() {
    showVariantEditor.value = false
  }

  /** 保存状态编辑弹窗（有 id → PUT，否则 POST） */
  async function saveVariant() {
    const form = variantEditorForm.value
    const characterId = variantEditorCharacterId.value
    if (!form?.name?.trim() || !characterId) return
    variantEditorSaving.value = true
    try {
      const payload = {
        name: form.name.trim(),
        appearance: form.appearance || undefined,
        image_prompt: form.image_prompt || undefined,
        negative_prompt: form.negative_prompt || undefined,
        is_default: !!form.is_default
      }
      if (form.id) {
        await characterAPI.updateVariant(form.id, payload)
      } else {
        await characterAPI.createVariant(characterId, payload)
      }
      await loadVariants(characterId, { force: true })
      notify.success(form.id ? '状态已保存' : '状态已新增')
      showVariantEditor.value = false
    } catch (e) {
      notify.error(e?.message || '保存失败')
    } finally {
      variantEditorSaving.value = false
    }
  }

  /** 删除状态；被分镜引用（409 VARIANT_IN_USE）时提示先解除关联 */
  async function removeVariant(variant) {
    const v = typeof variant === 'object' ? variant : { id: variant }
    if (!v?.id) return
    try {
      await ElMessageBox.confirm(
        `确定删除状态「${v.name || '未命名'}」吗？`,
        '删除确认',
        { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
      )
    } catch (_) {
      return
    }
    try {
      await characterAPI.deleteVariant(v.id)
      if (Number.isFinite(Number(v.character_id))) {
        await loadVariants(v.character_id, { force: true })
      }
      notify.success('状态已删除')
    } catch (e) {
      if (e?.response?.status === 409 || e?.response?.data?.error?.code === 'VARIANT_IN_USE') {
        notify.warning('该状态已被分镜使用，请先解除关联')
        return
      }
      notify.error(e?.message || '删除失败')
    }
  }

  /** 同步生图（后端可能数十秒）；期间禁用全部状态生图按钮 */
  async function generateVariantImage(variant) {
    const id = typeof variant === 'object' ? variant?.id : variant
    if (!id || generatingVariantId.value != null) return
    generatingVariantId.value = id
    try {
      const updated = await characterAPI.generateVariantImage(id)
      const characterId = updated?.character_id ?? (typeof variant === 'object' ? variant?.character_id : null)
      if (Number.isFinite(Number(characterId))) {
        await loadVariants(characterId, { force: true })
      }
      notify.success('状态图片已生成')
    } catch (e) {
      notify.error(e?.message || '生成失败')
    } finally {
      generatingVariantId.value = null
    }
  }

  /** 设为默认状态（PUT is_default=true 后刷新列表） */
  async function setVariantDefault(variant) {
    const v = typeof variant === 'object' ? variant : { id: variant }
    if (!v?.id || v.is_default) return
    variantDefaultSettingId.value = v.id
    try {
      await characterAPI.updateVariant(v.id, { is_default: true })
      if (Number.isFinite(Number(v.character_id))) {
        await loadVariants(v.character_id, { force: true })
      }
      notify.success('已设为默认状态')
    } catch (e) {
      notify.error(e?.message || '设置失败')
    } finally {
      variantDefaultSettingId.value = null
    }
  }

  // ── 分镜人物状态选择 ──────────────────────────────────
  /** 读取分镜中某角色的状态 id（用户未选时回落到默认状态） */
  function getSbVariantId(sbId, characterId) {
    const explicit = sbVariantSelections.value?.[sbId]?.[Number(characterId)]
    if (explicit != null) return explicit
    return defaultVariantIdFor(characterId)
  }

  function setSbVariantId(sbId, characterId, variantId) {
    const cur = sbVariantSelections.value[sbId] || {}
    sbVariantSelections.value = { ...sbVariantSelections.value, [sbId]: { ...cur, [Number(characterId)]: variantId } }
  }

  /** 分镜勾选角色变化后调用：按需预加载各角色的状态列表（缓存命中自动跳过） */
  function ensureSbVariantsLoaded(sbId) {
    const ids = getSbCharacterIds?.(sbId) || []
    for (const id of ids) loadVariants(id)
  }

  /** 分镜人物状态选择变更：全量保存该分镜已勾选角色的 links */
  async function onSbVariantChange(sb, characterId, variantId) {
    const sbId = sb?.id ?? sb
    setSbVariantId(sbId, characterId, variantId)
    await saveSbVariantLinks(sbId)
  }

  /**
   * 收集当前分镜全部已勾选角色的状态选择并 PUT 保存。
   * 后端 syncStoryboardVariantLinks 为事务内全删全插并覆写 storyboards.characters 投影：
   * links payload 漏掉任何已勾选角色都会静默删除其关联，因此保存前必须
   * 1) 等待全部已勾选角色的状态列表就绪（在途加载共享同一 promise）；
   * 2) 任一角色加载失败或没有任何可用状态（无法解析出 variant_id）时中止保存，不提交残缺 links。
   */
  async function saveSbVariantLinks(sbId) {
    const ids = (getSbCharacterIds?.(sbId) || []).map(Number).filter((n) => Number.isFinite(n))
    const loaded = await Promise.all(ids.map((id) => loadVariants(id, { force: false })))
    if (loaded.some((r) => r === null)) {
      notify.error('人物状态加载失败，已取消保存，请稍后重试')
      return
    }
    const missingNames = ids
      .filter((cid) => getSbVariantId(sbId, cid) == null)
      .map((cid) => getCharacterName?.(cid) || `#${cid}`)
    if (missingNames.length) {
      notify.error(`「${missingNames.join('、')}」暂无人物状态，已取消保存，请先在角色卡中为其创建状态`)
      return
    }
    const selections = ids.map((cid) => ({ character_id: cid, variant_id: getSbVariantId(sbId, cid) }))
    sbVariantLinksSaving.value = true
    try {
      await storyboardsAPI.updateVariantLinks(sbId, buildVariantLinks(selections))
    } catch (e) {
      notify.error(e?.message || '保存人物状态关联失败')
    } finally {
      sbVariantLinksSaving.value = false
    }
  }

  return {
    // 状态数据
    variantsByCharacterId,
    generatingVariantId,
    variantDefaultSettingId,
    loadVariants,
    getVariantsForCharacter,
    defaultVariantIdFor,
    variantOptionLabel,
    // 角色卡折叠区
    variantPanelCharacterId,
    toggleVariantPanel,
    // 编辑弹窗
    showVariantEditor,
    variantEditorCharacterId,
    variantEditorForm,
    variantEditorSaving,
    openVariantEditor,
    closeVariantEditor,
    saveVariant,
    removeVariant,
    generateVariantImage,
    setVariantDefault,
    // 分镜状态选择
    sbVariantSelections,
    sbVariantLinksSaving,
    getSbVariantId,
    setSbVariantId,
    ensureSbVariantsLoaded,
    onSbVariantChange,
    saveSbVariantLinks
  }
}
