<template>
  <el-select
    class="asset-generation-mode-select"
    :model-value="normalizedValue"
    :size="size"
    :disabled="disabled"
    aria-label="生图模式"
    @change="emit('update:modelValue', $event); emit('change', $event)"
  >
    <el-option
      v-for="option in options"
      :key="option.value"
      :label="compact ? option.shortLabel : option.label"
      :value="option.value"
    >
      <div class="asset-mode-option">
        <strong>{{ option.label }}</strong>
        <span>{{ option.description }}</span>
      </div>
    </el-option>
  </el-select>
</template>

<script setup>
import { computed } from 'vue'
import { assetGenerationModeOptions, normalizeAssetGenerationMode } from '@/constants/assetGenerationModes'

const props = defineProps({
  modelValue: { type: String, default: '' },
  targetType: { type: String, required: true },
  size: { type: String, default: 'small' },
  compact: { type: Boolean, default: false },
  disabled: Boolean,
})
const emit = defineEmits(['update:modelValue', 'change'])
const options = computed(() => assetGenerationModeOptions(props.targetType))
const normalizedValue = computed(() => normalizeAssetGenerationMode(props.targetType, props.modelValue))
</script>

<style scoped>
.asset-generation-mode-select { width: 124px; }
.asset-mode-option { display: grid; line-height: 1.25; padding: 4px 0; }
.asset-mode-option strong { font-size: 13px; font-weight: 600; }
.asset-mode-option span { color: var(--el-text-color-secondary); font-size: 11px; }
</style>
