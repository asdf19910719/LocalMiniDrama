<template>
  <section v-if="episodeId" class="episode-generation-progress section card" aria-label="本集生成进度">
    <div class="episode-progress-header">
      <div>
        <h2 class="section-title">本集生成进度</h2>
        <span class="episode-progress-subtitle">图片、视频和合成状态实时汇总</span>
      </div>
      <div class="episode-progress-actions">
        <ImageGenerationEnvironmentStatus :environment="environment" @check="$emit('check-environment')" />
        <el-button size="small" plain :loading="loading" title="刷新进度" aria-label="刷新进度" @click="refresh">
          <el-icon><Refresh /></el-icon>
        </el-button>
      </div>
    </div>

    <el-alert v-if="error" type="warning" :closable="false" show-icon class="episode-progress-error">
      {{ error }}
    </el-alert>

    <div v-if="!progress && loading" class="episode-progress-loading">
      <el-icon class="is-loading"><Loading /></el-icon> 正在读取本集生成状态...
    </div>
    <div v-else-if="progress" class="episode-progress-body">
      <div class="episode-progress-overview">
        <div class="progress-overview-item image-overview">
          <div class="progress-overview-label"><strong>生图</strong><span>{{ progress.image?.completed || 0 }}/{{ progress.image?.total || 0 }}</span></div>
          <el-progress :percentage="progress.image?.percent || 0" :status="progress.image?.failed ? 'exception' : undefined" />
          <small>进行中 {{ progress.image?.active || 0 }} · 待审核 {{ progress.image?.needs_review || 0 }} · 失败 {{ progress.image?.failed || 0 }}</small>
        </div>
        <div class="progress-overview-item video-overview">
          <div class="progress-overview-label"><strong>生视频</strong><span>{{ progress.video?.completed || 0 }}/{{ progress.video?.total || 0 }}</span></div>
          <el-progress :percentage="progress.video?.percent || 0" :status="progress.video?.failed ? 'exception' : undefined" />
          <small>进行中 {{ progress.video?.active || 0 }} · 待处理 {{ progress.video?.pending || 0 }} · 失败 {{ progress.video?.failed || 0 }}</small>
        </div>
      </div>

      <div class="episode-progress-columns">
        <div class="progress-detail-block">
          <div class="progress-detail-title">图片明细</div>
          <div class="progress-type-list">
            <div v-for="(bucket, key) in (progress.image?.by_type || {})" :key="key" class="progress-type-row">
              <span>{{ progressBucketLabel(key) }}</span>
              <el-progress :percentage="bucket.percent || 0" :show-text="false" />
              <em>{{ bucket.completed }}/{{ bucket.total }}</em>
            </div>
          </div>
        </div>
        <div class="progress-detail-block">
          <div class="progress-detail-title">视频明细</div>
          <div v-if="progress.video?.active_items?.length" class="video-active-list">
            <button v-for="item in progress.video.active_items" :key="item.storyboard_id" type="button" class="video-active-row" @click="$emit('open-video', item.storyboard_id)">
              <span>分镜 {{ item.storyboard_number ?? item.storyboard_id }}</span>
              <el-progress :percentage="Math.max(0, Math.min(100, Number(item.progress) || 0))" :show-text="false" />
              <em>{{ item.progress || 0 }}%</em>
            </button>
          </div>
          <div v-else class="progress-empty">暂无进行中的视频任务</div>
          <div v-if="progress.merge" class="merge-status-row">
            <span>整集合成</span><el-tag size="small" :type="mergeTagType(progress.merge.status)" effect="plain">{{ mergeLabel(progress.merge.status) }}</el-tag>
            <span v-if="progress.merge.progress > 0">{{ progress.merge.progress }}%</span>
          </div>
        </div>
      </div>
      <small class="progress-updated-at">更新于 {{ formatTime(progress.generated_at) }}</small>
    </div>
    <div v-else class="progress-empty">当前集暂无可统计的生成目标</div>
  </section>
</template>

<script setup>
import { Refresh, Loading } from '@element-plus/icons-vue'
import ImageGenerationEnvironmentStatus from '@/components/imageGeneration/ImageGenerationEnvironmentStatus.vue'
import { useEpisodeGenerationProgress, progressBucketLabel } from '@/composables/useEpisodeGenerationProgress'

const props = defineProps({ episodeId: { type: [Number, String], default: null }, environment: { type: Object, default: null } })
const emit = defineEmits(['open-video', 'check-environment'])
const { progress, loading, error, refresh } = useEpisodeGenerationProgress(() => props.episodeId)

function formatTime(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString()
}
function mergeLabel(status) {
  return { pending: '等待中', queued: '排队中', processing: '合成中', running: '合成中', completed: '已完成', failed: '失败' }[status] || status || '未知'
}
function mergeTagType(status) {
  if (status === 'completed') return 'success'
  if (status === 'failed') return 'danger'
  if (['processing', 'running'].includes(status)) return 'warning'
  return 'info'
}
</script>

<style scoped>
.episode-generation-progress { margin-top: 16px; }
.episode-progress-header, .episode-progress-actions, .progress-overview-label, .merge-status-row { display: flex; align-items: center; }
.episode-progress-header { justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.episode-progress-actions { gap: 8px; }
.episode-progress-subtitle, .progress-overview-item small, .progress-updated-at { color: var(--el-text-color-secondary); font-size: 12px; }
.episode-progress-overview { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.progress-overview-item { padding: 12px; border: 1px solid var(--el-border-color-lighter); border-radius: 6px; }
.progress-overview-label { justify-content: space-between; margin-bottom: 5px; }
.progress-overview-item small { display: block; margin-top: 4px; }
.episode-progress-columns { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(260px, 1fr); gap: 18px; margin-top: 16px; }
.progress-detail-title { font-size: 13px; font-weight: 600; margin-bottom: 8px; }
.progress-type-list, .video-active-list { display: grid; gap: 8px; }
.progress-type-row { display: grid; grid-template-columns: 78px minmax(0, 1fr) 52px; align-items: center; gap: 8px; font-size: 12px; }
.progress-type-row em, .video-active-row em { font-style: normal; text-align: right; color: var(--el-text-color-secondary); }
.video-active-row { border: 0; background: transparent; color: inherit; display: grid; grid-template-columns: 70px minmax(0, 1fr) 42px; align-items: center; gap: 8px; padding: 4px 0; cursor: pointer; text-align: left; font-size: 12px; }
.video-active-row:hover { color: var(--el-color-primary); }
.merge-status-row { gap: 8px; margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--el-border-color-lighter); font-size: 12px; }
.merge-status-row span:last-child { margin-left: auto; color: var(--el-text-color-secondary); }
.progress-empty, .episode-progress-loading { color: var(--el-text-color-secondary); font-size: 13px; padding: 12px 0; }
.episode-progress-error { margin-bottom: 12px; }
@media (max-width: 760px) { .episode-progress-overview, .episode-progress-columns { grid-template-columns: 1fr; } .episode-progress-header { align-items: flex-start; } }
</style>
