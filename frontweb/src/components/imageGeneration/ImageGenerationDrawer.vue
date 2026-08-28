<template>
  <el-drawer :model-value="visible" title="图片生成" size="420px" @close="$emit('close')">
    <template v-if="task">
      <el-tag>{{ statusText }}</el-tag>
      <el-input :model-value="task.prompt_snapshot" type="textarea" :rows="5" readonly class="prompt" />
      <p v-if="task.generation_channel === 'chatgpt_web'">发送到 ChatGPT 后可继续其他工作，结果会自动回到这里。</p>
      <el-button
        v-if="(task.status === 'draft' || (task.status === 'preparing' && task.error_message)) && task.generation_channel === 'chatgpt_web'"
        type="primary"
        :loading="sending"
        @click="$emit('send', task)"
      >
        {{ task.status === 'preparing' ? '重试发送' : '发送到 ChatGPT' }}
      </el-button>
      <el-alert v-if="task.status === 'preparing' && !task.error_message" type="info" title="正在等待浏览器插件确认" show-icon />
      <div v-if="results.length" class="results">
        <div v-for="result in results" :key="result.id" class="result">
          <img :src="result.preview_url || result.image_url" alt="候选图片" />
          <el-button type="primary" size="small" @click="$emit('select', result)">设为当前图片</el-button>
        </div>
      </div>
      <el-alert v-if="task.error_message" type="error" :title="task.error_message" show-icon />
    </template>
  </el-drawer>
</template>

<script setup>
import { computed } from 'vue'
const props = defineProps({ visible: Boolean, task: Object, results: { type: Array, default: () => [] }, sending: Boolean })
defineEmits(['close', 'send', 'select'])
const labels = { draft: '待确认', queued: '排队中', preparing: '准备中', submitted: '已发送', generating: '生成中', needs_review: '请选择图片', completed: '已完成', failed: '失败', cancelled: '已取消' }
const statusText = computed(() => labels[props.task?.status] || props.task?.status || '')
</script>

<style scoped>
.prompt { margin: 14px 0; }.results { display:grid;gap:12px;margin-top:16px }.result { display:flex;gap:10px;align-items:center }.result img { width:96px;height:96px;object-fit:cover;border-radius:6px }
</style>
