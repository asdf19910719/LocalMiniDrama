<template>
  <div class="page">
    <header class="page-head">
      <h1>项目</h1>
      <div class="head-actions">
        <el-input v-model="q" placeholder="搜索项目名" style="width: 200px" @input="onSearch" />
        <el-select v-model="status" style="width: 130px" @change="load">
          <el-option label="全部" value="all" />
          <el-option label="制作中" value="making" />
          <el-option label="需要处理" value="needs-attention" />
          <el-option label="已完成" value="completed" />
          <el-option label="已归档" value="archived" />
        </el-select>
        <el-button type="primary" @click="$router.push('/projects/new')">新建项目</el-button>
      </div>
    </header>
    <el-alert v-if="error" type="error" :title="error" show-icon @close="error = ''" />
    <div v-if="items.length === 0 && !loading" class="empty">
      <p>{{ status === 'archived' ? '回收站为空' : '还没有项目' }}</p>
      <el-button v-if="status !== 'archived'" type="primary" @click="$router.push('/projects/new')">新建项目</el-button>
    </div>
    <div class="cards">
      <div v-for="card in items" :key="card.id" class="project-card" tabindex="0" role="button"
           @click="enter(card)" @keydown.enter="enter(card)" @keydown.space.prevent="enter(card)">
        <div class="thumb">{{ (card.title || '项目').slice(0, 1) }}</div>
        <div class="info">
          <div class="name">{{ card.title }}</div>
          <div class="meta">
            {{ card.episodeCount }} 集 ·
            <span v-if="card.lastWork">上次：第 {{ card.lastWork.episodeNumber }} 集 · {{ stageLabel(card.lastWork.stage) }}</span>
            <span v-else>尚未开始制作</span>
          </div>
          <div class="health">
            <span v-if="card.health.generating" class="badge blue">生成中 {{ card.health.generating }}</span>
            <span v-if="card.health.pending" class="badge amber">待处理 {{ card.health.pending }}</span>
            <span v-if="card.health.needsUpdate" class="badge red">需要更新 {{ card.health.needsUpdate }}</span>
          </div>
        </div>
        <div class="card-actions" @click.stop>
          <el-button v-if="card.lastWork" size="small" type="primary" plain
                     @click="$router.push(episodeStagePath(card))">
            继续第 {{ card.lastWork.episodeNumber }} 集 · {{ stageLabel(card.lastWork.stage) }}
          </el-button>
          <el-dropdown trigger="click" @command="(cmd) => onMenu(cmd, card)">
            <el-button size="small" text>•••</el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item v-if="card.status !== undefined && status !== 'archived'" command="delete">移入回收站</el-dropdown-item>
                <el-dropdown-item v-if="status === 'archived'" command="restore">恢复项目</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ElMessage, ElMessageBox } from 'element-plus'
import v21 from '@/v21/api.js'

export default {
  name: 'ProjectsView',
  data() {
    return { items: [], q: '', status: 'all', loading: false, error: '', searchTimer: null }
  },
  watch: {
    '$route.query': {
      immediate: true,
      handler() { this.syncFromUrl(); this.load() },
    },
  },
  methods: {
    syncFromUrl() {
      this.q = String(this.$route.query.q || '')
      this.status = String(this.$route.query.status || 'all')
    },
    writeUrl() {
      this.$router.replace({ query: { q: this.q || undefined, status: this.status !== 'all' ? this.status : undefined } })
    },
    onSearch() {
      clearTimeout(this.searchTimer)
      this.searchTimer = setTimeout(() => { this.writeUrl(); this.load() }, 280)
    },
    async load() {
      this.loading = true
      this.error = ''
      try {
        const data = await v21.listProjects({ q: this.q, status: this.status })
        this.items = data.items || []
      } catch (e) {
        this.error = e.message
      } finally {
        this.loading = false
      }
    },
    stageLabel(stage) {
      return { script: '剧本', assets: '设定', storyboard: '分镜', cut: '成片' }[stage] || '剧本'
    },
    episodeStagePath(card) {
      const stage = card.lastWork?.stage || 'script'
      return `/projects/${card.id}/episodes/${card.lastWork.episodeId}/${stage}`
    },
    enter(card) {
      if (this.status === 'archived') return
      this.$router.push(`/projects/${card.id}`)
    },
    async onMenu(cmd, card) {
      if (cmd === 'delete') {
        await ElMessageBox.confirm(`确定将项目“${card.title}”移入回收站？删除可恢复。`, '删除项目', { type: 'warning' })
        await v21.deleteProject(card.id)
        ElMessage.success('已移入回收站')
        this.load()
      } else if (cmd === 'restore') {
        await v21.restoreProject(card.id)
        ElMessage.success('已恢复')
        this.load()
      }
    },
  },
}
</script>

<style scoped>
.page { padding: 24px 32px; max-width: 1200px; }
.page-head { display: flex; align-items: center; justify-content: space-between; }
.head-actions { display: flex; gap: 12px; align-items: center; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; margin-top: 20px; }
.project-card {
  display: flex; gap: 12px; background: #fff; border: 1px solid #e5e7eb; border-radius: 10px;
  padding: 16px; cursor: pointer; align-items: flex-start;
}
.project-card:hover { border-color: #2563eb; }
.thumb { width: 48px; height: 48px; border-radius: 8px; background: #e8efff; color: #2563eb; display: flex; align-items: center; justify-content: center; font-size: 20px; flex: none; }
.info { flex: 1; min-width: 0; }
.name { font-weight: 600; }
.meta { color: #6b7280; font-size: 12px; margin-top: 4px; }
.health { margin-top: 8px; display: flex; gap: 6px; }
.badge { font-size: 12px; padding: 1px 8px; border-radius: 999px; }
.badge.blue { background: #eff6ff; color: #2563eb; }
.badge.amber { background: #fffbeb; color: #b45309; }
.badge.red { background: #fef2f2; color: #b91c1c; }
.card-actions { display: flex; flex-direction: column; gap: 6px; align-items: flex-end; }
.empty { text-align: center; color: #6b7280; padding: 80px 0; }
</style>
