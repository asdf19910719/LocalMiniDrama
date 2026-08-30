<template>
  <el-popover placement="bottom-start" :width="320" trigger="click">
    <template #reference>
      <el-button size="small" :type="buttonType" plain :loading="checking" title="检测生图环境">
        <el-icon><CircleCheck v-if="healthy" /><WarningFilled v-else /></el-icon>
        {{ label }}
      </el-button>
    </template>
    <div class="environment-checks">
      <div class="environment-header">
        <strong>生图环境</strong>
        <el-button link size="small" :loading="checking" @click="$emit('check')">重新检测</el-button>
      </div>
      <p v-if="!checks.length" class="environment-empty">尚未检测</p>
      <div v-for="check in checks" :key="check.key" class="environment-row">
        <el-icon :class="`status-${check.status}`"><CircleCheck v-if="check.status === 'ok'" /><WarningFilled v-else /></el-icon>
        <span>{{ check.message || check.code || check.key }}</span>
      </div>
      <small v-if="environment?.checkedAt">检测时间：{{ formatTime(environment.checkedAt) }}</small>
    </div>
  </el-popover>
</template>

<script setup>
import { computed } from 'vue'
import { CircleCheck, WarningFilled } from '@element-plus/icons-vue'

const props = defineProps({ environment: { type: Object, default: null }, checking: Boolean })
defineEmits(['check'])
const checks = computed(() => Array.isArray(props.environment?.checks) ? props.environment.checks : [])
const healthy = computed(() => props.environment?.canProceed === true)
const label = computed(() => props.checking ? '检测中' : healthy.value ? '环境正常' : '环境异常')
const buttonType = computed(() => props.checking ? 'info' : healthy.value ? 'success' : 'warning')
function formatTime(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString()
}
</script>

<style scoped>
.environment-checks { display: grid; gap: 8px; }
.environment-header { display: flex; align-items: center; justify-content: space-between; }
.environment-row { display: flex; gap: 7px; align-items: flex-start; font-size: 12px; line-height: 1.4; }
.environment-row .el-icon { flex: 0 0 auto; margin-top: 2px; }
.status-ok { color: var(--el-color-success); }
.status-failed { color: var(--el-color-danger); }
.environment-empty { color: var(--el-text-color-secondary); margin: 0; }
small { color: var(--el-text-color-secondary); }
</style>
