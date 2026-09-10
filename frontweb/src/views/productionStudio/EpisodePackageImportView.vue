<template>
  <div class="page">
    <el-button text @click="$router.push(`/projects/${projectId}/episodes`)">← 返回剧集</el-button>
    <h1>导入制作包（V2.1 JSON）</h1>
    <el-steps :active="stepIndex" align-center>
      <el-step title="选择目标与文件" />
      <el-step title="预览" />
      <el-step title="写入草稿" />
    </el-steps>

    <section class="step-body">
      <template v-if="step === 0">
        <p class="hint">只接受 episode-package@2.1；可选择创建新剧集或填充空白剧集</p>
        <el-radio-group v-model="targetMode">
          <el-radio-button label="create_new">创建下一集</el-radio-button>
          <el-radio-button label="fill_blank">填充空白剧集</el-radio-button>
        </el-radio-group>
        <el-select v-if="targetMode === 'fill_blank'" v-model="targetEpisodeId" style="margin-top: 12px; width: 260px">
          <el-option v-for="ep in blankEpisodes" :key="ep.id" :label="`第 ${ep.episodeNumber} 集`" :value="ep.id" />
        </el-select>
        <el-input v-model="rawText" type="textarea" :rows="12" placeholder="粘贴制作包 JSON（schema: local-mini-drama.episode-package, version: &quot;2.1&quot;）" style="margin-top: 14px" />
        <div class="actions">
          <el-button type="primary" :disabled="!rawText.trim() || (targetMode === 'fill_blank' && !targetEpisodeId)" @click="preview">预览导入</el-button>
        </div>
      </template>

      <template v-else-if="step === 1">
        <template v-if="plan.ok">
          <p>目标：{{ plan.summary.target }}</p>
          <p>标题：{{ plan.script.title }} · 场次 {{ plan.script.sceneCount }}</p>
          <p>素材：新建 {{ plan.summary.creates }} · 复用 {{ plan.summary.reuses }}</p>
          <p>分镜 {{ plan.summary.shots }} · 时段 {{ plan.summary.segments }} · 媒体任务 {{ plan.summary.mediaTasks }}（零）</p>
        </template>
        <el-alert v-else type="error" :closable="false" :title="plan.errors.map((e) => `${e.path}: ${e.message}`).join('；') || '校验未通过'" />
        <div class="actions">
          <el-button @click="step = 0">上一步</el-button>
          <el-button type="primary" :disabled="!plan.ok" @click="confirm">确认写入草稿</el-button>
        </div>
      </template>

      <template v-else>
        <el-result icon="success" title="导入完成" :sub-title="`已写入第 ${importedEpisode} 集草稿（零媒体任务）`">
          <template #extra>
            <el-button type="primary" @click="$router.push(`/projects/${projectId}/episodes/${importedEpisode}/script`)">打开剧本页</el-button>
          </template>
        </el-result>
      </template>
    </section>
  </div>
</template>

<script>
import { ElMessage } from 'element-plus'
import v21 from '@/v21/api.js'
import axios from 'axios'

export default {
  name: 'EpisodePackageImportView',
  data() {
    return { step: 0, targetMode: 'create_new', targetEpisodeId: '', blankEpisodes: [], rawText: '', plan: null, importedEpisode: null }
  },
  computed: {
    projectId() { return this.$route.params.projectId },
    stepIndex() { return this.step },
  },
  async mounted() {
    const res = await axios.get(`/api/v2/projects/${this.projectId}/episodes/blank`)
    this.blankEpisodes = res.data?.data?.items || []
  },
  methods: {
    async preview() {
      try {
        const pkg = JSON.parse(this.rawText)
        this.plan = await v21.previewImportPackage(this.projectId, {
          pkg,
          dramaId: this.projectId,
          targetEpisodeId: this.targetMode === 'fill_blank' ? this.targetEpisodeId : null,
        })
        if (!this.plan.ok) {
          ElMessage.error(this.plan.errors?.[0]?.message || '校验未通过')
          if (this.plan.errors?.[0]?.code === 'TARGET_NOT_BLANK') this.step = 0
        }
        this.step = 1
      } catch (e) {
        ElMessage.error(`JSON 解析失败：${e.message}`)
      }
    },
    async confirm() {
      const pkg = JSON.parse(this.rawText)
      const result = await v21.confirmImportPackage(this.projectId, {
        pkg,
        targetEpisodeId: this.targetMode === 'fill_blank' ? this.targetEpisodeId : null,
      })
      this.importedEpisode = result.episodeId
      this.step = 2
    },
  },
}
</script>

<style scoped>
.page { padding: 24px 48px; max-width: 900px; margin: 0 auto; }
.step-body { margin-top: 24px; background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 24px; min-height: 320px; }
.actions { margin-top: 16px; display: flex; gap: 10px; }
.hint { color: #9ca3af; font-size: 12px; }
</style>
