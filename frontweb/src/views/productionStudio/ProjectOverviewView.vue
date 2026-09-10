<template>
  <div class="page">
    <el-button text @click="$router.push('/projects')">← 返回项目列表</el-button>
    <div v-if="overview" class="hero">
      <div class="cover">{{ (overview.hero.title || '项').slice(0, 1) }}</div>
      <div class="hero-info">
        <h1>{{ overview.hero.title }}</h1>
        <div class="meta">
          {{ overview.hero.genre || '未设置题材' }} · {{ overview.hero.aspectRatio }} · {{ overview.hero.episodeCount }} 集 ·
          最近编辑 {{ formatTime(overview.hero.updatedAt) }}
        </div>
        <div class="hero-desc">{{ overview.hero.description || '暂无简介' }}</div>
      </div>
      <div class="hero-actions">
        <el-button @click="editOpen = true">编辑项目</el-button>
        <el-button type="primary" @click="$router.push(`/projects/${projectId}/episodes`)">进入剧集</el-button>
      </div>
    </div>

    <div v-if="overview" class="grid">
      <section class="card next-step">
        <h3>下一步</h3>
        <template v-if="overview.nextStep">
          <p>第 {{ overview.nextStep.episodeNumber }} 集 · {{ stageLabel(overview.nextStep.stage) }}</p>
          <el-button type="primary" @click="$router.push(`/projects/${projectId}/episodes/${overview.nextStep.episodeId}/${overview.nextStep.stage}`)">
            继续制作
          </el-button>
        </template>
        <template v-else>
          <p>还没有剧集</p>
          <el-button type="primary" @click="$router.push(`/projects/${projectId}/episodes`)">创建第 1 集</el-button>
        </template>
        <div class="assets-line">
          项目素材：{{ overview.assetsAggregate.objectCount }} 个对象<span v-if="overview.assetsAggregate.missingImageCount">，{{ overview.assetsAggregate.missingImageCount }} 个缺少可用形象</span>
          <el-button text type="primary" @click="$router.push(`/projects/${projectId}/assets`)">去项目素材</el-button>
        </div>
      </section>

      <section class="card style-card">
        <h3>当前画面风格</h3>
        <p class="style-name">{{ overview.style.styleId || '未设置' }}</p>
        <p class="hint">应用风格只影响之后的新生成，不会改动现有素材与成片</p>
        <el-button @click="openStyleModal">更换画面风格</el-button>
      </section>
    </div>

    <el-drawer v-model="editOpen" title="编辑项目" size="420px">
      <el-form label-width="80px">
        <el-form-item label="名称"><el-input v-model="form.title" /></el-form-item>
        <el-form-item label="题材"><el-input v-model="form.genre" /></el-form-item>
        <el-form-item label="画幅">
          <el-select v-model="form.aspectRatio">
            <el-option label="16:9 横屏" value="16:9" />
            <el-option label="9:16 竖屏" value="9:16" />
            <el-option label="1:1 方形" value="1:1" />
          </el-select>
        </el-form-item>
        <el-form-item label="简介"><el-input v-model="form.description" type="textarea" :rows="3" /></el-form-item>
        <el-button type="primary" @click="saveProfile">保存</el-button>
      </el-form>
    </el-drawer>

    <el-dialog v-model="styleOpen" title="更换画面风格" width="720px">
      <el-tabs v-model="styleTab">
        <el-tab-pane label="预设风格" name="presets">
          <el-input v-model="styleQuery" placeholder="搜索风格" @input="loadStyles" />
          <div class="style-list">
            <div v-for="s in styles" :key="s.id" class="style-item" :class="{ selected: s.id === selectedStyleId }" @click="selectedStyleId = s.id">
              <div class="style-name">{{ s.labelZh || s.id }}</div>
              <div class="style-desc">{{ s.descriptionZh || '' }}</div>
            </div>
          </div>
        </el-tab-pane>
        <el-tab-pane label="我的风格" name="mine">
          <p class="hint">自定义风格保存后出现在此列表</p>
        </el-tab-pane>
        <el-tab-pane label="自定义风格" name="custom">
          <p class="hint">在风格目录基础上定义专属风格（首发以预设为准）</p>
        </el-tab-pane>
      </el-tabs>
      <template #footer>
        <el-button @click="styleOpen = false">取消</el-button>
        <el-button type="primary" :disabled="!selectedStyleId" @click="applyStyle">应用风格</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script>
import { ElMessage } from 'element-plus'
import v21 from '@/v21/api.js'

export default {
  name: 'ProjectOverviewView',
  data() {
    return { overview: null, editOpen: false, form: {}, styleOpen: false, styleTab: 'presets', styles: [], styleQuery: '', selectedStyleId: '' }
  },
  computed: {
    projectId() { return this.$route.params.projectId },
  },
  mounted() { this.load() },
  methods: {
    async load() {
      try {
        this.overview = await v21.getOverview(this.projectId)
        this.form = {
          title: this.overview.hero.title,
          genre: this.overview.hero.genre || '',
          aspectRatio: this.overview.hero.aspectRatio || '16:9',
          description: this.overview.hero.description || '',
        }
      } catch (e) {
        ElMessage.error(e.message)
      }
    },
    stageLabel(stage) {
      return { script: '剧本', assets: '设定', storyboard: '分镜', cut: '成片' }[stage] || '剧本'
    },
    formatTime(t) { return t ? String(t).slice(0, 10) : '' },
    async openStyleModal() {
      this.styleOpen = true
      this.selectedStyleId = this.overview.style.styleId || ''
      await this.loadStyles()
    },
    async loadStyles() {
      try {
        const items = await v21.listStyles({ query: this.styleQuery || undefined })
        this.styles = items || []
      } catch { this.styles = [] }
    },
    async applyStyle() {
      await v21.applyStyle(this.projectId, this.selectedStyleId)
      ElMessage.success('风格已应用，只影响之后的新生成')
      this.styleOpen = false
      this.load()
    },
    async saveProfile() {
      await v21.updateProject(this.projectId, this.form)
      ElMessage.success('已保存')
      this.editOpen = false
      this.load()
    },
  },
}
</script>

<style scoped>
.page { padding: 24px 32px; max-width: 1100px; }
.hero { display: flex; gap: 20px; margin-top: 16px; align-items: flex-start; }
.cover { width: 84px; height: 84px; border-radius: 12px; background: #e8efff; color: #2563eb; font-size: 34px; display: flex; align-items: center; justify-content: center; flex: none; }
.hero-info { flex: 1; }
.hero-info h1 { margin: 0 0 6px; }
.meta { color: #6b7280; font-size: 13px; }
.hero-desc { margin-top: 8px; color: #374151; font-size: 14px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 20px; }
.card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 20px; }
.card h3 { margin: 0 0 12px; }
.style-name { font-weight: 600; }
.hint { color: #9ca3af; font-size: 12px; }
.assets-line { margin-top: 16px; color: #6b7280; font-size: 13px; }
.style-list { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 12px; max-height: 320px; overflow: auto; }
.style-item { border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px; cursor: pointer; }
.style-item.selected { border-color: #2563eb; background: #eff6ff; }
.style-name { font-weight: 600; font-size: 13px; }
.style-desc { color: #9ca3af; font-size: 12px; margin-top: 4px; }
</style>
