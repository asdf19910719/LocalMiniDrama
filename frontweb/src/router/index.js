import { createRouter, createWebHistory } from 'vue-router'

// V2.1 canonical 路由（Phase 6 切换）：项目 / 资产库 / 任务 / 设置 + 单集四阶段
const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', redirect: '/projects' },
    {
      path: '/projects',
      name: 'projects',
      component: () => import('@/views/productionStudio/ProjectsView.vue'),
      meta: { title: '项目' },
    },
    {
      path: '/projects/new',
      name: 'project-new',
      component: () => import('@/views/productionStudio/ProjectNewView.vue'),
      meta: { title: '新建项目' },
    },
    {
      path: '/projects/:projectId',
      name: 'project-overview',
      component: () => import('@/views/productionStudio/ProjectOverviewView.vue'),
      meta: { title: '项目概览' },
    },
    {
      path: '/projects/:projectId/episodes',
      name: 'project-episodes',
      component: () => import('@/views/productionStudio/ProjectEpisodesView.vue'),
      meta: { title: '剧集' },
    },
    {
      path: '/projects/:projectId/episodes/external-ai',
      name: 'external-ai-wizard',
      component: () => import('@/views/productionStudio/ExternalAiWizardView.vue'),
      meta: { title: '外部 AI 制作' },
    },
    {
      path: '/projects/:projectId/episodes/import-package',
      name: 'episode-import-package',
      component: () => import('@/views/productionStudio/EpisodePackageImportView.vue'),
      meta: { title: '导入制作包' },
    },
    {
      path: '/projects/:projectId/episodes/import-novel',
      name: 'episode-import-novel',
      component: () => import('@/views/productionStudio/NovelImportView.vue'),
      meta: { title: '小说 / 长文本拆集' },
    },
    {
      path: '/projects/:projectId/episodes/import-video',
      name: 'episode-import-video',
      component: () => import('@/views/productionStudio/SourceVideoView.vue'),
      meta: { title: '从已有视频开始剪辑' },
    },
    {
      path: '/projects/import-archive',
      name: 'project-import-archive',
      component: () => import('@/views/productionStudio/ArchiveImportView.vue'),
      meta: { title: '导入项目归档' },
    },
    {
      path: '/projects/:projectId/assets',
      name: 'project-assets',
      component: () => import('@/views/productionStudio/ProjectAssetsView.vue'),
      meta: { title: '项目素材' },
    },
    {
      // stage 值在路由层放开（不限定枚举）：未知值由 StudioShell 在运行时回退到该集 /script
      path: '/projects/:projectId/episodes/:episodeId/:stage',
      name: 'studio-stage',
      component: () => import('@/views/productionStudio/studio/StudioShell.vue'),
      meta: { title: '制作' },
    },
    {
      path: '/tasks',
      name: 'tasks',
      component: () => import('@/views/productionStudio/TasksView.vue'),
      meta: { title: '任务' },
    },
    {
      path: '/library',
      name: 'library',
      component: () => import('@/views/productionStudio/LibraryView.vue'),
      meta: { title: '资产库' },
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('@/views/productionStudio/SettingsView.vue'),
      meta: { title: '设置' },
    },
    {
      path: '/settings/data-tools',
      name: 'data-tools',
      component: () => import('@/views/productionStudio/DataToolsView.vue'),
      meta: { title: '高级数据工具' },
    },
    {
      path: '/quick-create',
      name: 'quick-create',
      component: () => import('@/views/productionStudio/QuickCreateView.vue'),
      meta: { title: '自由创作' },
    },
    {
      path: '/projects/:projectId/episodes/:episodeId/canvas',
      name: 'advanced-canvas',
      component: () => import('@/views/productionStudio/AdvancedCanvasView.vue'),
      props: true,
      meta: { title: '高级画布' },
    },
    // 既有独立工具页（不属于四阶段制作链，继续可用）
    {
      path: '/ai-config',
      name: 'ai-config',
      component: () => import('@/views/productionStudio/AiConfigV21View.vue'),
      meta: { title: 'AI 配置' },
    },
    {
      path: '/ai-config/advanced',
      name: 'ai-config-advanced',
      component: () => import('@/views/AiConfig.vue'),
      meta: { title: 'AI 配置 · 高级' },
    },
    {
      path: '/media-library',
      name: 'media-library',
      component: () => import('@/views/MediaLibrary.vue'),
      meta: { title: '媒体素材库' },
    },
    // 旧四阶段前制作页与旧画布已整体删除：不注册旧路由、不提供回退跳转
    // （迁移矩阵 §2：开发期书签失效不构成产品兼容需求）。
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('@/views/productionStudio/NotFoundView.vue'),
      meta: { title: '页面不存在' },
    },
  ],
})

router.beforeEach((to) => {
  if (to.meta.title) {
    document.title = `${to.meta.title} - LocalMiniDrama`
  }
  return true
})

export default router
