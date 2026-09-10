<template>
  <div class="page">
    <el-button text @click="$router.push(`/projects/${projectId}`)">← 返回概览</el-button>
    <header class="page-head">
      <h1>项目素材</h1>
      <div class="head-actions">
        <el-radio-group v-model="type" size="small" @change="load">
          <el-radio-button label="all">全部</el-radio-button>
          <el-radio-button label="character">角色</el-radio-button>
          <el-radio-button label="scene">场景</el-radio-button>
          <el-radio-button label="prop">道具</el-radio-button>
        </el-radio-group>
        <el-button type="primary" @click="createOpen = true">创建素材</el-button>
      </div>
    </header>

    <div class="cards">
      <div v-for="item in items" :key="item.assetType + item.id" class="asset-card" :class="{ blocked: item.blocked }" @click="openDetail(item)">
        <div class="thumb">
          <img v-if="item.currentImage" :src="item.currentImage">
          <span v-else class="missing">缺形象</span>
        </div>
        <div class="info">
          <div class="name">{{ item.name }}</div>
          <div class="desc">{{ item.description || '' }}</div>
        </div>
      </div>
    </div>

    <el-dialog v-model="createOpen" title="创建素材（两步）" width="420px">
      <el-form label-width="80px">
        <el-form-item label="类型">
          <el-select v-model="createForm.type">
            <el-option label="角色" value="character" />
            <el-option label="场景" value="scene" />
            <el-option label="道具" value="prop" />
          </el-select>
        </el-form-item>
        <el-form-item label="名称"><el-input v-model="createForm.name" /></el-form-item>
        <el-form-item label="描述"><el-input v-model="createForm.description" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createOpen = false">取消</el-button>
        <el-button type="primary" :disabled="!createForm.name" @click="create">创建素材</el-button>
      </template>
    </el-dialog>

    <el-drawer v-model="detailOpen" :title="detail?.name || '素材'" size="620px">
      <template v-if="detail">
        <div class="detail-current">
          <img v-if="detail.currentImage" :src="detail.currentImage">
          <div v-else class="missing big">缺少可用形象</div>
        </div>
        <div class="cand-row">
          <div v-for="c in detail.candidates" :key="c.candidateId" class="cand" @click="useCandidate(c)">
            <img :src="c.url">
          </div>
          <el-button size="small" :loading="generating" @click="generate">生成图片</el-button>
        </div>
        <el-divider />
        <el-button size="small" type="danger" plain @click="remove">删除</el-button>
      </template>
    </el-drawer>
  </div>
</template>

<script>
import { ElMessage, ElMessageBox } from 'element-plus'
import v21 from '@/v21/api.js'

export default {
  name: 'ProjectAssetsView',
  data() {
    return { items: [], type: 'all', createOpen: false, createForm: { type: 'character', name: '', description: '' }, detailOpen: false, detail: null, generating: false }
  },
  computed: {
    projectId() { return this.$route.params.projectId },
  },
  mounted() { this.load() },
  methods: {
    async load() {
      const data = await v21.listAssets(this.projectId, { type: this.type })
      this.items = data.items || []
    },
    async create() {
      await v21.createAsset(this.projectId, { type: this.createForm.type, fields: { name: this.createForm.name, description: this.createForm.description } })
      this.createOpen = false
      this.createForm = { type: this.createForm.type, name: '', description: '' }
      ElMessage.success('素材已创建；创建本身不调用 AI')
      this.load()
    },
    async openDetail(item) {
      this.detail = await v21.getAssetDetail(item.assetType, item.id)
      this.detailOpen = true
    },
    async generate() {
      this.generating = true
      try {
        await v21.generateAssetCandidate(this.projectId, { type: this.detail.assetType, assetId: this.detail.id, prompt: this.detail.name })
        this.detail = await v21.getAssetDetail(this.detail.assetType, this.detail.id)
        ElMessage.success('生成完成，已进入候选')
      } finally {
        this.generating = false
      }
    },
    async useCandidate(candidate) {
      const result = await v21.useCandidate({ type: this.detail.assetType, assetId: this.detail.id, candidateId: candidate.candidateId })
      ElMessage.success({ message: '已设为当前图（5 秒内可撤销：点击旧候选即可恢复）', grouping: true })
      this.detail.currentImage = result.current.imageUrl
      this.load()
    },
    async remove() {
      const result = await v21.deleteAsset(this.detail.assetType, this.detail.id)
      if (result.blocked) {
        ElMessageBox.alert(result.message, '无法删除（被引用保护）', { type: 'warning' })
        return
      }
      await ElMessageBox.confirm('素材将移入回收站（可恢复）。', '删除素材', { type: 'warning' })
        .then(async () => {
          await v21.deleteAsset(this.detail.assetType, this.detail.id)
          this.detailOpen = false
          this.load()
        })
        .catch(() => {})
    },
  },
}
</script>

<style scoped>
.page { padding: 24px 32px; max-width: 1200px; }
.page-head { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; }
.head-actions { display: flex; gap: 12px; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 14px; margin-top: 18px; }
.asset-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px; cursor: pointer; display: flex; gap: 10px; }
.asset-card.blocked { border-color: #fecaca; }
.thumb { width: 64px; height: 64px; border-radius: 8px; overflow: hidden; background: #f3f4f6; flex: none; display: flex; align-items: center; justify-content: center; }
.thumb img { width: 100%; height: 100%; object-fit: cover; }
.missing { color: #b91c1c; font-size: 12px; }
.missing.big { width: 220px; height: 220px; background: #fef2f2; border-radius: 10px; display: flex; align-items: center; justify-content: center; }
.name { font-weight: 600; }
.desc { color: #6b7280; font-size: 12px; margin-top: 4px; }
.cand-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.cand { width: 96px; cursor: pointer; }
.cand img { width: 96px; height: 72px; object-fit: cover; border-radius: 8px; }
</style>
