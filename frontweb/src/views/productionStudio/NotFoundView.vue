<template>
  <div>
    <header class="page-head">
      <h1>页面不存在</h1>
      <span class="sub">404</span>
    </header>
    <div class="page-body">
      <div class="nf-box">
        <p class="muted">链接可能已失效，或该页面已迁移</p>
        <router-link to="/projects" class="btn primary" style="text-decoration:none">返回项目列表</router-link>
      </div>
    </div>
  </div>
</template>

<script>
export default { name: 'NotFoundView' }
</script>

<style scoped>
.nf-box { text-align: center; padding: 120px 0; display: flex; flex-direction: column; gap: 18px; align-items: center; }
</style>
