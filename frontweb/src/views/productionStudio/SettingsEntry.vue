<template>
  <div class="page">
    <h1>设置</h1>
    <div class="entries">
      <router-link to="/ai-config" class="entry">
        <h3>AI 配置</h3>
        <p>Provider、密钥、模型映射与能力预检</p>
      </router-link>
      <div class="entry disabled">
        <h3>常规设置</h3>
        <p>工作区、目录与创作默认值（P1，随后开放）</p>
      </div>
      <div class="entry disabled">
        <h3>高级数据工具</h3>
        <p>完整性检查、媒体重定位、物理清理（P2）</p>
      </div>
    </div>
  </div>
</template>

<script>
export default { name: 'SettingsEntry' }
</script>

<style scoped>
.page { padding: 24px 32px; max-width: 900px; }
.entries { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-top: 18px; }
.entry { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 18px; text-decoration: none; color: inherit; }
.entry.disabled { opacity: 0.6; }
.entry h3 { margin: 0 0 8px; }
.entry p { margin: 0; color: #6b7280; font-size: 13px; }
</style>
