<template>
  <div class="assets-stage">
    <div class="readiness-bar">
      <span class="badge" :class="readinessClass">{{ readinessText }}</span>
      <el-button type="primary" :loading="entering" @click="enterStoryboard">进入分镜</el-button>
    </div>

    <el-tabs v-model="tab">
      <el-tab-pane v-for="t in tabs" :key="t.id" :label="t.label" :name="t.id">
        <div class="cards">
          <div v-for="item in referenced[t.id] || []" :key="item.assetId" class="asset-card" :class="{ blocked: item.blocked }" @click="openDetail(item)">
            <div class="thumb">
              <img v-if="item.currentImage" :src="item.currentImage" alt="">
              <span v-else class="missing">缺形象</span>
            </div>
            <div class="info">
              <div class="name">{{ item.name }}</div>
              <div class="desc">{{ item.description || '' }}</div>
              <span v-if="item.blocked" class="badge red">缺少可用形象</span>
            </div>
          </div>
          <p v-if="(referenced[t.id] || []).length === 0" class="hint">本集剧本没有引用{{ t.label }}</p>
        </div>
      </el-tab-pane>
    </el-tabs>

    <el-drawer v-model="detailOpen" :title="detail ? detail.name : '素材'" size="600px">
      <template v-if="detail">
        <div class="detail-current">
          <img v-if="detail.currentImage" :src="detail.currentImage">
          <div v-else class="missing big">缺少可用形象</div>
        </div>
        <div class="candidates">
          <h4>候选图</h4>
          <div class="cand-row">
            <div v-for="c in detail.candidates" :key="c.candidateId" class="cand" @click="useCandidate(c)">
              <img :src="c.url"><span>候选 {{ c.candidateId }}</span>
            </div>
            <el-button size="small" :loading="generating" @click="generate">生成图片</el-button>
          </div>
        </div>
      </template>
    </el-drawer>
  </div>
</template>

<script>
import { ElMessage } from 'element-plus'
import v21 from '@/v21/api.js'

export default {
  name: 'AssetsStage',
  props: { projectId: String, episodeId: String },
  data() {
    return {
      tab: 'characters',
      tabs: [
        { id: 'characters', label: '角色' },
        { id: 'scenes', label: '场景' },
        { id: 'props', label: '道具' },
      ],
      referenced: { characters: [], scenes: [], props: [] },
      readiness: { status: 'checking' },
      detailOpen: false, detail: null, generating: false, entering: false,
    }
  },
  computed: {
    readinessText() {
      return {
        checking: '正在准备素材…',
        ready: '本集设定已准备好',
        'needs-attention': `有 ${this.readiness.missing?.length || 0} 项可稍后处理`,
        'snapshot-failed': '素材快照保存失败，媒体生成已暂停',
        'script-unapproved': '确认剧本后才能生成本集媒体',
      }[this.readiness.status] || '正在准备素材…'
    },
    readinessClass() {
      return { ready: 'green', 'needs-attention': 'amber', 'snapshot-failed': 'red', 'script-unapproved': 'red', checking: 'gray' }
    },
  },
  mounted() { this.load() },
  methods: {
    async load() {
      const data = await v21.getEpisodeAssets(this.episodeId)
      this.referenced = data.referenced
      this.readiness = data.readiness
    },
    async openDetail(item) {
      this.detail = await v21.getAssetDetail(item.assetType, item.assetId)
      this.detailOpen = true
    },
    async generate() {
      this.generating = true
      try {
        const result = await v21.generateAssetCandidate(this.projectId, {
          type: this.detail.assetType,
          assetId: this.detail.id,
          prompt: this.detail.name,
        })
        const refreshed = await v21.getAssetDetail(this.detail.assetType, this.detail.id)
        this.detail = refreshed
        ElMessage.success('生成完成，点击候选设为当前图')
        return result
      } finally {
        this.generating = false
      }
    },
    async useCandidate(candidate) {
      const result = await v21.useCandidate({ type: this.detail.assetType, assetId: this.detail.id, candidateId: candidate.candidateId })
      ElMessage.success({ message: '已设为当前图', grouping: true })
      this.detail.currentImage = result.current.imageUrl
      this.load()
    },
    async enterStoryboard() {
      this.entering = true
      try {
        const result = await v21.enterStoryboard(this.episodeId)
        if (result.readiness && result.readiness.status === 'script-unapproved') {
          ElMessage.warning('确认剧本后才能生成本集媒体；仍可进入分镜查看结构')
        } else if (result.readiness && result.readiness.status === 'needs-attention') {
          ElMessage.info(`有 ${result.readiness.missing.length} 项可稍后处理，已进入分镜`)
        }
        this.$router.push(`/projects/${this.projectId}/episodes/${this.episodeId}/storyboard`)
      } finally {
        this.entering = false
      }
    },
  },
}
</script>

<style scoped>
.assets-stage { padding: 16px 24px; }
.readiness-bar { display: flex; align-items: center; justify-content: space-between; background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px 16px; }
.badge { font-size: 13px; padding: 3px 12px; border-radius: 999px; }
.badge.green { background: #ecfdf5; color: #047857; }
.badge.amber { background: #fffbeb; color: #b45309; }
.badge.red { background: #fef2f2; color: #b91c1c; }
.badge.gray { background: #f3f4f6; color: #6b7280; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; margin-top: 14px; }
.asset-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px; cursor: pointer; display: flex; gap: 10px; }
.asset-card.blocked { border-color: #fecaca; }
.thumb { width: 64px; height: 64px; border-radius: 8px; overflow: hidden; background: #f3f4f6; flex: none; display: flex; align-items: center; justify-content: center; }
.thumb img { width: 100%; height: 100%; object-fit: cover; }
.missing { color: #b91c1c; font-size: 12px; }
.missing.big { width: 200px; height: 200px; background: #fef2f2; border-radius: 10px; display: flex; align-items: center; justify-content: center; }
.name { font-weight: 600; }
.desc { color: #6b7280; font-size: 12px; margin-top: 4px; }
.detail-current img { max-width: 100%; border-radius: 10px; }
.cand-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.cand { width: 96px; cursor: pointer; text-align: center; }
.cand img { width: 96px; height: 72px; object-fit: cover; border-radius: 8px; }
.cand span { font-size: 12px; color: #6b7280; }
.hint { color: #9ca3af; }
</style>
