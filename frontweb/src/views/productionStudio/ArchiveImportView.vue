<template>
  <div>
    <header class="page-head">
      <button class="btn ghost" @click="$router.push('/projects')"><svg><use href="#i-back"/></svg>返回项目列表</button>
      <h1 style="font-size:20px;font-weight:600">导入项目归档</h1>
    </header>
    <div class="page-body" style="display:flex;align-items:center;justify-content:center">
      <div class="card pad" style="max-width:520px;text-align:center;padding:40px">
        <svg style="width:36px;height:36px;color:var(--muted)"><use href="#i-box"/></svg>
        <h3 style="margin:12px 0 8px;font-size:16px">项目归档导入向导</h3>
        <p class="muted" style="font-size:13px">三阶段向导（选择归档 → 校验并确认 → 导入结果）将在本迭代内启用</p>
      </div>
    </div>
  </div>
</template>

<script>
export default { name: 'ArchiveImportView' }
</script>
