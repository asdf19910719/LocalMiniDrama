<template>
  <div class="script-stage">
    <div class="toolbar">
      <span class="save-state">{{ saveStateText }}</span>
      <el-button v-if="model && model.canConfirm" type="primary" @click="confirm">
        {{ model.confirmLabel || '确认剧本' }}
      </el-button>
      <el-button v-if="model && model.approved" @click="$router.push(`?focus=assets`).then(() => $router.push(`/projects/${projectId}/episodes/${episodeId}/assets`))">进入本集设定</el-button>
      <el-button text @click="historyOpen = true">历史版本</el-button>
      <el-dropdown trigger="click" @command="onAi">
        <el-button :disabled="!model || !model.draft">AI 辅助</el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="continue">AI 续写</el-dropdown-item>
            <el-dropdown-item command="polish">AI 润色全文</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <div v-if="!model || !model.draft" class="empty">
      <h2>空白剧本</h2>
      <p>选择一种开始方式，三者写入同一份草稿</p>
      <div class="starts">
        <div class="start-card" @click="startWith('paste')">
          <h4>粘贴或导入剧本</h4><p>把现成文本粘贴进来</p>
        </div>
        <div class="start-card" @click="startWith('ai')">
          <h4>AI 生成剧本</h4><p>从一句话想法开始（无 Key 时为本地示例草稿）</p>
        </div>
        <div class="start-card" @click="startWith('write')">
          <h4>直接开始写</h4><p>从空白编辑器开始</p>
        </div>
      </div>
      <el-input v-if="mode === 'paste'" v-model="pasteText" type="textarea" :rows="10" placeholder="第一场 内景·xxx·深夜 …" />
      <div v-if="mode === 'paste'" style="margin-top: 12px">
        <el-button type="primary" :disabled="!pasteText.trim()" @click="saveDraft(pasteText)">保存为草稿</el-button>
      </div>
    </div>

    <div v-else class="editor-wrap">
      <el-input v-model="draftText" type="textarea" :rows="22" class="editor" @input="markDirty" />
      <aside class="scenes">
        <h4>场次结构</h4>
        <div v-for="scene in model.scenes" :key="scene.id" class="scene-item">
          <span class="scene-no">{{ scene.scene_number }}</span>
          <span class="scene-heading">{{ scene.heading }}</span>
        </div>
        <p v-if="model.scenes.length === 0" class="hint">保存后自动解析场次</p>
      </aside>
    </div>

    <el-dialog v-model="candidateOpen" title="AI 候选（先比较后应用）" width="720px">
      <div class="diff">
        <div class="diff-col"><h4>当前草稿</h4><pre>{{ model?.draft?.content }}</pre></div>
        <div class="diff-col"><h4>AI 候选（新增 {{ candidate?.diff?.added || 0 }} 行 / 删除 {{ candidate?.diff?.removed || 0 }} 行）</h4><pre>{{ candidate?.text }}</pre></div>
      </div>
      <template #footer>
        <el-button @click="candidateOpen = false">放弃</el-button>
        <el-button type="primary" @click="applyCandidate">应用到草稿</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="historyOpen" title="历史版本（只读）" width="640px">
      <div v-for="rev in model?.history || []" :key="rev.id" class="hist-row">
        <span>r{{ rev.revision }}</span>
        <span>{{ statusLabel(rev.status) }}</span>
        <span>{{ rev.chars }} 字 · {{ rev.created_at }}</span>
        <el-button size="small" @click="copyHistory(rev.revision)">复制为新草稿</el-button>
      </div>
    </el-dialog>
  </div>
</template>

<script>
import { ElMessage } from 'element-plus'
import v21 from '@/v21/api.js'

export default {
  name: 'ScriptStage',
  props: { projectId: String, episodeId: String },
  data() {
    return {
      model: null, draftText: '', dirty: false, saving: false, lastSavedAt: '',
      mode: '', pasteText: '', candidate: null, candidateOpen: false, historyOpen: false,
    }
  },
  computed: {
    saveStateText() {
      if (this.saving) return '保存中…'
      if (this.dirty) return '有未保存修改（更改会自动保存）'
      if (this.lastSavedAt) return `已保存于 ${this.lastSavedAt}`
      return '更改会自动保存'
    },
  },
  mounted() { this.load() },
  methods: {
    async load() {
      this.model = await v21.getScript(this.episodeId)
      this.draftText = this.model.draft ? this.model.draft.content : ''
      this.dirty = false
    },
    startWith(mode) {
      this.mode = mode
      if (mode === 'write') this.saveDraft('第一场 内景·地点·时间\n').then(() => { this.mode = '' })
      if (mode === 'ai') {
        v21.generateAiCandidate(this.episodeId, { mode: 'continue' }).then((cand) => {
          this.candidate = cand
          this.candidateOpen = true
        })
      }
    },
    markDirty() {
      this.dirty = true
      clearTimeout(this.timer)
      this.timer = setTimeout(() => this.saveDraft(this.draftText, this.model?.draft?.revision), 800)
    },
    async saveDraft(content, expectedRevision) {
      if (this.saving) return
      this.saving = true
      try {
        const result = await v21.saveScriptDraft(this.episodeId, {
          content: content ?? this.draftText,
          expectedRevision: expectedRevision ?? this.model?.draft?.revision ?? null,
        })
        this.dirty = false
        this.lastSavedAt = new Date().toLocaleTimeString()
        await this.load()
        return result
      } catch (e) {
        ElMessage.error(e.code === 'REVISION_CONFLICT' ? '草稿已被其他窗口更新，请刷新比较' : e.message)
      } finally {
        this.saving = false
      }
    },
    async confirm() {
      try {
        await v21.confirmScript(this.episodeId, this.model?.draft?.revision ?? null)
        ElMessage.success('剧本已确认，可进入本集设定')
        await this.load()
      } catch (e) {
        ElMessage.error(e.message)
      }
    },
    async onAi(cmd) {
      const candidate = await v21.generateAiCandidate(this.episodeId, { mode: cmd })
      this.candidate = candidate
      this.candidateOpen = true
    },
    async applyCandidate() {
      await v21.applyAiCandidate(this.episodeId, this.candidate)
      this.candidateOpen = false
      await this.load()
      ElMessage.success('候选已应用到草稿')
    },
    async copyHistory(revision) {
      await v21.copyScriptHistory(this.episodeId, revision)
      this.historyOpen = false
      await this.load()
      ElMessage.success('已复制为新草稿')
    },
    statusLabel(status) {
      return { draft: '草稿', approved: '已确认', superseded: '已被取代' }[status] || status
    },
  },
}
</script>

<style scoped>
.script-stage { padding: 16px 24px; max-width: 1200px; }
.toolbar { display: flex; gap: 12px; align-items: center; justify-content: flex-end; }
.save-state { color: #6b7280; font-size: 13px; margin-right: auto; }
.empty { text-align: center; margin-top: 60px; }
.starts { display: flex; gap: 16px; justify-content: center; margin: 20px 0; }
.start-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 20px 24px; cursor: pointer; width: 220px; text-align: left; }
.start-card:hover { border-color: #2563eb; }
.start-card h4 { margin: 0 0 6px; }
.start-card p { margin: 0; color: #6b7280; font-size: 13px; }
.editor-wrap { display: flex; gap: 16px; margin-top: 12px; }
.editor { flex: 1; }
.scenes { width: 240px; background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px; }
.scene-item { display: flex; gap: 8px; padding: 6px 0; font-size: 13px; border-bottom: 1px dashed #f3f4f6; }
.diff { display: flex; gap: 16px; }
.diff-col { flex: 1; }
.diff-col pre { background: #f9fafb; padding: 10px; max-height: 320px; overflow: auto; font-size: 12px; }
.hist-row { display: flex; gap: 14px; align-items: center; padding: 8px 0; border-bottom: 1px solid #f3f4f6; }
.hint { color: #9ca3af; font-size: 12px; }
</style>
