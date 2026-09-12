<template>
  <div>
    <header class="page-head">
      <button class="icon-btn" @click="$router.push('/ai-config')"><svg><use href="#i-back"/></svg></button>
      <h1>AI 配置 · 高级</h1>
      <span class="sub">Provider 管理与业务配置（v1 配置面，渐进迁移中）</span>
      <div class="spacer"></div>
      <span class="badge outline">v1 配置面</span>
    </header>
    <div class="page-body legacy-host">
      <AIConfigContent />
    </div>
  </div>
</template>

<script setup>
import AIConfigContent from '@/components/AIConfigContent.vue'
</script>

<style scoped>
/* V2.1 深色宿主：把 Element Plus 的 CSS 变量域整体压到深色令牌，
   v1 配置面（AIConfigContent）无需改造即可融入工作台；逐元素重样式随迁移逐步替换 */
.legacy-host {
  --el-bg-color: #12151d;
  --el-bg-color-page: #0b0d12;
  --el-bg-color-overlay: #181c26;
  --el-fill-color-blank: #12151d;
  --el-fill-color: #181c26;
  --el-fill-color-light: #181c26;
  --el-fill-color-lighter: #14171f;
  --el-text-color-primary: #f4f6fb;
  --el-text-color-regular: #c3c9d6;
  --el-text-color-secondary: #8d95a8;
  --el-text-color-placeholder: #5c6478;
  --el-border-color: #2a3040;
  --el-border-color-light: #232936;
  --el-border-color-lighter: #232936;
  --el-color-primary: #7c5cff;
}
h1 {
  font-size: 20px;
  font-weight: 600;
}
.legacy-host :deep(.el-card) {
  background: var(--panel);
  border-color: var(--line);
  border-radius: 10px;
  color: var(--text-2);
}
.legacy-host :deep(.el-button) {
  border-radius: 8px;
}
.legacy-host :deep(.el-button--primary) {
  --el-button-bg-color: var(--accent);
  --el-button-border-color: var(--accent);
  --el-button-hover-bg-color: var(--accent-hover);
  --el-button-hover-border-color: var(--accent-hover);
}
.legacy-host :deep(.el-button--default) {
  --el-button-bg-color: var(--panel2);
  --el-button-border-color: var(--line);
  --el-button-text-color: var(--text);
  --el-button-hover-bg-color: #1e2330;
  --el-button-hover-border-color: var(--line-strong);
  --el-button-hover-text-color: var(--text);
}
.legacy-host :deep(.el-table) {
  --el-table-bg-color: var(--panel);
  --el-table-tr-bg-color: var(--panel);
  --el-table-header-bg-color: var(--panel2);
  --el-table-header-text-color: var(--muted);
  --el-table-text-color: var(--text-2);
  --el-table-border-color: var(--line);
  --el-table-row-hover-bg-color: var(--panel2);
}
/* theme.css 的 html.light 斑马行 !important 规则在此页需要被深色覆盖 */
.legacy-host :deep(.el-table--striped .el-table__body tr.el-table__row--striped td.el-table__cell) {
  background: var(--panel2) !important;
}
.legacy-host :deep(.el-dialog) {
  background: var(--panel);
  border: 1px solid var(--line-strong);
  border-radius: 14px;
  --el-dialog-title-text-color: var(--text);
}
.legacy-host :deep(.el-dialog__body) { color: var(--text-2); }
.legacy-host :deep(.el-input__wrapper),
.legacy-host :deep(.el-textarea__inner),
.legacy-host :deep(.el-select__wrapper) {
  background: var(--panel2);
  box-shadow: 0 0 0 1px var(--line) inset;
}
.legacy-host :deep(.el-input__wrapper.is-focus),
.legacy-host :deep(.el-select__wrapper.is-focused),
.legacy-host :deep(.el-textarea__inner:focus) {
  box-shadow: 0 0 0 1px var(--focus) inset;
}
.legacy-host :deep(.el-input__inner),
.legacy-host :deep(.el-textarea__inner) {
  color: var(--text);
}
.legacy-host :deep(.el-input__inner::placeholder),
.legacy-host :deep(.el-textarea__inner::placeholder) { color: #5c6478; }
.legacy-host :deep(.el-tabs__item) { color: var(--muted); }
.legacy-host :deep(.el-tabs__item.is-active) { color: var(--accent); }
.legacy-host :deep(.el-tabs__active-bar) { background: var(--accent); }
.legacy-host :deep(.el-tabs__nav-wrap::after) { background: var(--line); }
.legacy-host :deep(.el-switch) {
  --el-switch-on-color: var(--accent);
  --el-switch-off-color: #2a3040;
}
.legacy-host :deep(.el-tag) {
  background: var(--neutral-subtle);
  border-color: transparent;
  color: var(--text-2);
}
.legacy-host :deep(.el-popper.is-light) {
  background: var(--panel2);
  border-color: var(--line-strong);
  color: var(--text-2);
}
</style>
