<template>
  <el-drawer :model-value="visible" title="图片生成" size="420px" @close="$emit('close')">
    <template v-if="task">
      <el-tag>{{ statusText }}</el-tag>
      <el-input :model-value="task.prompt_snapshot" type="textarea" :rows="5" readonly class="prompt" />
      <p v-if="task.generation_channel === 'chatgpt_web'">点击页面上的“ChatGPT 生成”后会立即自动发送；此处用于查看进度、重试和选择结果，无需再次确认。</p>
      <el-button
        v-if="task.status === 'draft' && task.generation_channel === 'chatgpt_web'"
        type="primary"
        :loading="sending"
        @click="$emit('send', task)"
      >
        发送到 ChatGPT
      </el-button>
      <el-alert v-if="task.status === 'preparing' && !task.error_message" type="info" title="正在等待浏览器插件确认" show-icon />
      <el-alert v-if="task.status === 'queued'" type="info" title="已加入队列，将自动依次发送" show-icon />
      <el-alert v-if="task.status === 'submitted' || task.status === 'generating'" type="info" title="ChatGPT 已接收任务，正在等待生成结果" show-icon />
      <el-button
        v-if="task.status === 'submitted' || task.status === 'generating'"
        :loading="sending"
        @click="$emit('recover', task)"
      >
        恢复结果捕获
      </el-button>
      <el-button v-if="task.status === 'failed'" :loading="sending" @click="$emit('requeue', task)">重新排队</el-button>
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
defineEmits(['close', 'send', 'recover', 'requeue', 'select'])
const labels = { draft: '待确认', queued: '排队中', preparing: '准备中', submitted: '已发送', generating: '生成中', needs_review: '请选择图片', completed: '已完成', failed: '失败', cancelled: '已取消' }
const statusText = computed(() => labels[props.task?.status] || props.task?.status || '')
</script>

<style scoped>
.prompt { margin: 14px 0; }.results { display:grid;gap:12px;margin-top:16px }.result { display:flex;gap:10px;align-items:center }.result img { width:96px;height:96px;object-fit:cover;border-radius:6px }
</style>
