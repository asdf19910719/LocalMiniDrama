<template>
  <div class="page">
    <el-button text @click="$router.push('/projects')">← 返回项目列表</el-button>
    <header class="page-head">
      <h1>剧集</h1>
      <div class="head-actions">
        <el-input v-model="q" placeholder="搜索集号/标题" style="width: 200px" @input="load" />
        <el-select v-model="status" style="width: 130px" @change="load">
          <el-option label="全部" value="all" />
          <el-option label="需要处理" value="needs-attention" />
          <el-option label="制作中" value="making" />
          <el-option label="已完成" value="completed" />
        </el-select>
        <el-button type="primary" @click="newEpisode">新建剧集</el-button>
        <el-dropdown trigger="click" @command="onImportCommand">
          <el-button>导入 / 协作</el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="package">导入制作包（V2.1 JSON）</el-dropdown-item>
              <el-dropdown-item command="external-ai">外部 AI 制作</el-dropdown-item>
              <el-dropdown-item command="novel">小说 / 长文本拆集</el-dropdown-item>
              <el-dropdown-item command="video">从已有视频开始剪辑</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </header>

    <div v-if="items.length === 0" class="empty">
      <p>还没有剧集，点击“新建剧集”直达空白剧本</p>
    </div>

    <div class="rows">
      <div v-for="ep in items" :key="ep.id" class="ep-row">
        <div class="ep-main" role="button" tabindex="0" @click="open(ep)" @keydown.enter="open(ep)">
          <span class="ep-no">第 {{ ep.episodeNumber }} 集</span>
          <span class="ep-title">{{ ep.title || '未命名' }}</span>
          <span class="ep-stage">{{ stageLabel(ep.stage) }}</span>
          <span class="badge" :class="statusClass(ep.status)">{{ statusLabel(ep.status) }}</span>
          <span v-if="ep.hasImportSource" class="badge gray" @click.stop="showSource(ep)">外部来源</span>
        </div>
        <div class="ep-actions" @click.stop>
          <el-dropdown trigger="click" @command="(cmd) => onRowMenu(cmd, ep)">
            <el-button size="small" text>•••</el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="rename">重命名</el-dropdown-item>
                <el-dropdown-item command="reorder">调整集序</el-dropdown-item>
                <el-dropdown-item command="delete" divided>删除</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>
    </div>

    <el-dialog v-model="sourceOpen" title="导入来源（只读）" width="640px">
      <pre v-if="source" class="source">{{ JSON.stringify(source, null, 2) }}</pre>
    </el-dialog>
  </div>
</template>

<script>
import { ElMessage, ElMessageBox, ElInput } from 'element-plus'
import v21 from '@/v21/api.js'

export default {
  name: 'ProjectEpisodesView',
  components: { ElInput },
  data() {
    return { items: [], q: '', status: 'all', sourceOpen: false, source: null }
  },
  computed: {
    projectId() { return this.$route.params.projectId },
  },
  mounted() { this.load() },
  methods: {
    async load() {
      const data = await v21.listEpisodes(this.projectId, { q: this.q, status: this.status })
      this.items = data.items || []
    },
    stageLabel(stage) {
      return { script: '剧本', assets: '设定', storyboard: '分镜', cut: '成片' }[stage] || '未开始'
    },
    statusLabel(status) {
      return { making: '制作中', needs_attention: '需要处理', 'needs-attention': '需要处理', completed: '已完成', blank: '空白' }[status] || status
    },
    statusClass(status) {
      return { making: 'blue', 'needs-attention': 'red', completed: 'green', blank: 'gray' }[status] || 'gray'
    },
    async newEpisode() {
      const { value } = await ElMessageBox.prompt('创建空白草稿并直接进入剧本页；只需集号与可选标题。', '新建剧集', {
        inputValue: String(this.items.length + 1),
        message: '集号',
        inputPlaceholder: '集号',
      }).catch(() => ({ value: null }))
      if (!value) return
      const created = await v21.createEpisode(this.projectId, { episodeNumber: Number(value) || undefined })
      ElMessage.success(`第 ${created.episodeNumber} 集已创建`)
      this.$router.push(`/projects/${this.projectId}/episodes/${created.id}/script`)
    },
    open(ep) {
      const stage = ep.stage || 'script'
      this.$router.push(`/projects/${this.projectId}/episodes/${ep.id}/${stage}`)
    },
    async onImportCommand(cmd) {
      if (cmd === 'external-ai') this.$router.push(`/projects/${this.projectId}/episodes/external-ai`)
      else if (cmd === 'package') this.$router.push(`/projects/${this.projectId}/episodes/import-package`)
      else if (cmd === 'novel') ElMessage.info('小说拆集向导即将打开（P1）')
      else if (cmd === 'video') ElMessage.info('从已有视频开始剪辑即将打开（P1）')
    },
    async onRowMenu(cmd, ep) {
      if (cmd === 'rename') {
        const { value } = await ElMessageBox.prompt('新的标题', '重命名', { inputValue: ep.title }).catch(() => ({ value: null }))
        if (value === null) return
        await v21.renameEpisode(ep.id, { title: value })
        this.load()
      } else if (cmd === 'reorder') {
        const { value } = await ElMessageBox.prompt('新的集号', '调整集序', { inputValue: String(ep.episodeNumber) }).catch(() => ({ value: null }))
        if (!value) return
        const order = this.items.map((i) => i.id)
        const from = order.indexOf(ep.id)
        const to = Number(value) - 1
        order.splice(from, 1)
        order.splice(Math.max(0, Math.min(order.length, to)), 0, ep.id)
        try {
          await v21.reorderEpisodes(this.projectId, order)
          this.load()
        } catch (e) {
          ElMessage.error(e.message)
        }
      } else if (cmd === 'delete') {
        try {
          await v21.deleteEpisode(ep.id)
        } catch (e) {
          if (e.code === 'NOT_BLANK' || e.status === 409) { /* 服务端总返回影响清单 */ }
        }
        await ElMessageBox.confirm(`第 ${ep.episodeNumber} 集将移入回收站（可恢复）。`, '删除剧集', { type: 'warning' })
          .then(async () => {
            await v21.deleteEpisode(ep.id)
            ElMessage.success('已移入回收站')
            this.load()
          })
          .catch(() => {})
      }
    },
    async showSource(ep) {
      this.source = await v21.getImportSource(ep.id)
      this.sourceOpen = true
    },
  },
}
</script>

<style scoped>
.page { padding: 24px 32px; max-width: 1100px; }
.page-head { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; }
.head-actions { display: flex; gap: 12px; }
.rows { margin-top: 18px; display: flex; flex-direction: column; gap: 8px; }
.ep-row { display: flex; align-items: center; background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px 16px; }
.ep-main { flex: 1; display: flex; gap: 14px; align-items: center; cursor: pointer; }
.ep-no { font-weight: 600; width: 70px; }
.ep-title { color: #374151; }
.ep-stage { color: #6b7280; font-size: 13px; }
.badge { font-size: 12px; padding: 1px 8px; border-radius: 999px; cursor: default; }
.badge.blue { background: #eff6ff; color: #2563eb; }
.badge.green { background: #ecfdf5; color: #047857; }
.badge.red { background: #fef2f2; color: #b91c1c; }
.badge.gray { background: #f3f4f6; color: #6b7280; cursor: pointer; }
.empty { text-align: center; color: #6b7280; padding: 80px 0; }
.source { background: #f9fafb; padding: 12px; border-radius: 8px; max-height: 400px; overflow: auto; }
</style>
