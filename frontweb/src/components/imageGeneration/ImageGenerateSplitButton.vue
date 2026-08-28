<template>
  <el-dropdown split-button type="primary" size="small" :loading="loading" @click="generate(defaultChannel)" @command="generate">
    {{ defaultChannel === 'chatgpt_web' ? 'ChatGPT 生成' : '默认模型生成' }}
    <template #dropdown>
      <el-dropdown-menu>
        <el-dropdown-item command="chatgpt_web">ChatGPT 生成</el-dropdown-item>
        <el-dropdown-item command="api">默认模型生成</el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>

<script setup>
defineProps({ defaultChannel: { type: String, default: 'api' }, loading: Boolean })
const emit = defineEmits(['generate'])
function generate(channel) { emit('generate', channel) }
</script>
