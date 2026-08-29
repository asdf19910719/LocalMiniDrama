<template>
  <el-dropdown split-button type="primary" size="small" :loading="loading" @click="generate(defaultChannel)" @command="selectChannel">
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
const emit = defineEmits(['generate', 'select-channel'])
function generate(channel) { emit('generate', channel) }
// 选择菜单项只切换默认通道（不触发生成），由父级持久化到剧集设置
function selectChannel(channel) { emit('select-channel', channel) }
</script>
