// 分镜 × 人物状态（角色变体）关联：全删全插同步、投影 storyboards.characters、列表回读

/**
 * 列出某分镜的人物状态关联：JOIN character_variants 带出状态名/图片，
 * JOIN characters 带出人物名；sort_order 非空在前按序排列，空值排最后，同序按 id。
 */
function listStoryboardVariantLinks(db, storyboardId) {
  const rows = db.prepare(
    `SELECT
       l.id,
       l.storyboard_id,
       l.character_id,
       l.variant_id,
       l.reference_role,
       l.sort_order,
       l.framing_note,
       v.name AS variant_name,
       v.image_url,
       v.local_path,
       v.is_default,
       c.name AS character_name
     FROM storyboard_character_variants l
     LEFT JOIN character_variants v ON v.id = l.variant_id
     LEFT JOIN characters c ON c.id = l.character_id
     WHERE l.storyboard_id = ?
     ORDER BY (l.sort_order IS NULL), l.sort_order, l.id`
  ).all(Number(storyboardId));
  return rows.map((r) => ({
    id: r.id,
    storyboard_id: r.storyboard_id,
    character_id: r.character_id,
    variant_id: r.variant_id,
    reference_role: r.reference_role ?? null,
    sort_order: r.sort_order ?? null,
    framing_note: r.framing_note ?? null,
    variant_name: r.variant_name ?? null,
    character_name: r.character_name ?? null,
    image_url: r.image_url ?? null,
    local_path: r.local_path ?? null,
    is_default: r.is_default ?? 0,
  }));
}

/**
 * 校验一组关联：variant 必须存在且归属于 link.character_id；sort_order 必须为
 * 非空数字且本组内不重复。返回归一化（Number 化 id/sort_order）后的行数组。
 */
function validateVariantLinks(db, links) {
  const seenSortOrders = new Set();
  return (Array.isArray(links) ? links : []).map((link) => {
    const characterId = Number(link.character_id);
    const variantId = Number(link.variant_id);
    const variant = Number.isFinite(variantId)
      ? db.prepare('SELECT id, character_id FROM character_variants WHERE id = ? AND deleted_at IS NULL').get(variantId)
      : null;
    if (!variant || variant.character_id !== characterId) {
      const e = new Error('人物状态与人物不匹配，请重新选择');
      e.code = 'VARIANT_CHARACTER_MISMATCH';
      throw e;
    }
    const sortOrder = link.sort_order;
    if (typeof sortOrder !== 'number' || !Number.isFinite(sortOrder)) {
      const e = new Error('人物状态排序值无效：必须为非空数字');
      e.code = 'VARIANT_SORT_ORDER_DUPLICATE';
      throw e;
    }
    if (seenSortOrders.has(sortOrder)) {
      const e = new Error('人物状态排序值重复：' + sortOrder);
      e.code = 'VARIANT_SORT_ORDER_DUPLICATE';
      throw e;
    }
    seenSortOrders.add(sortOrder);
    return {
      character_id: characterId,
      variant_id: variantId,
      reference_role: link.reference_role ?? null,
      sort_order: sortOrder,
      framing_note: link.framing_note ?? null,
    };
  });
}

/**
 * 同步分镜的人物状态关联：校验通过后事务内全删全插，并把 storyboards.characters
 * 投影更新为 links 顺序的纯 ID 数组 JSON（与 updateStoryboard 现格式一致）。
 * 返回 listStoryboardVariantLinks 结果。
 */
function syncStoryboardVariantLinks(db, storyboardId, links) {
  const sid = Number(storyboardId);
  const rows = validateVariantLinks(db, links);
  const projection = JSON.stringify(rows.map((r) => r.character_id));
  const sync = db.transaction(() => {
    db.prepare('DELETE FROM storyboard_character_variants WHERE storyboard_id = ?').run(sid);
    const ins = db.prepare(
      `INSERT INTO storyboard_character_variants (storyboard_id, character_id, variant_id, reference_role, sort_order, framing_note)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const row of rows) {
      ins.run(sid, row.character_id, row.variant_id, row.reference_role, row.sort_order, row.framing_note);
    }
    db.prepare('UPDATE storyboards SET characters = ?, updated_at = ? WHERE id = ?').run(
      projection,
      new Date().toISOString(),
      sid
    );
  });
  sync();
  return listStoryboardVariantLinks(db, sid);
}

module.exports = {
  syncStoryboardVariantLinks,
  listStoryboardVariantLinks,
};
