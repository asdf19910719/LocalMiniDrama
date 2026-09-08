function normalizeReference(item, index) {
  const source = String(item.path || item.localPath || item.url || item.imageUrl || '').trim();
  if (!source) {
    const error = new Error(`第 ${index + 1} 个参考图缺少可用地址`);
    error.code = 'REFERENCE_SOURCE_MISSING';
    throw error;
  }
  return {
    source,
    role: String(item.role || 'reference').trim(),
    name: String(item.name || item.label || `参考图${index + 1}`).trim(),
    sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : index,
    originalIndex: index,
    realPerson: item.realPerson === true || item.real_person === true,
  };
}

function createReferenceRegistry(items = [], language = 'mixed') {
  const entries = items.map(normalizeReference)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.originalIndex - b.originalIndex)
    .map((entry, index) => ({
      ...entry,
      index: index + 1,
      promptLabel: language === 'en' ? `@Image${index + 1}` : `@图片${index + 1}`,
    }));
  return {
    entries,
    promptLabels: entries.map((entry) => entry.promptLabel),
    providerImages: entries.map((entry) => ({ source: entry.source, label: entry.promptLabel, role: entry.role })),
  };
}

module.exports = { createReferenceRegistry };
