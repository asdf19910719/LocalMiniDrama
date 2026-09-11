<template>
  <div>
    <header class="page-head">
      <button class="icon-btn" @click="$router.push('/settings')"><svg><use href="#i-back"/></svg></button>
      <h1>高级数据工具</h1>
      <span class="sub">完整性检查 · 媒体重定位 · 迁移记录 · 物理清理</span>
      <div class="spacer"></div>
      <span class="badge warn">运行中任务将阻断危险写入</span>
    </header>
    <div class="page-body" style="display:flex; gap:16px; overflow:auto">

      <!-- 左侧工具导航 -->
      <div class="col" style="width:220px; flex:0 0 220px; gap:6px">
        <button v-for="tool in tools" :key="tool.id" class="btn" :class="{ primary: tool.id === active }" style="width:100%; justify-content:flex-start" @click="active = tool.id">
          {{ tool.label }}
        </button>
      </div>

      <div class="grow" style="min-width:0">
        <!-- 完整性检查 -->
        <div v-if="active === 'integrity'" class="card pad">
          <div class="row" style="margin-bottom:12px"><b style="font-size:14px">完整性检查</b><div class="spacer"></div>
            <button class="btn" :disabled="scanning" @click="runCheck">{{ scanning ? '检查中…' : '开始检查' }}</button>
          </div>
          <template v-if="checked">
            <div class="stats-row">
              <span class="badge ok">正常 216</span><span class="badge warn">警告 3</span><span class="badge danger">错误 1</span>
            </div>
            <div class="issue"><span class="badge danger">错误</span><span class="ellipsis">媒体文件缺失 · 2 个候选的 local_path 不可访问</span><span class="act">媒体重定位</span></div>
            <div class="issue"><span class="badge warn">警告</span><span class="ellipsis">任务索引 · 1 个任务无对应资源记录</span><span class="act">重建任务索引</span></div>
            <div class="issue"><span class="badge warn">警告</span><span class="ellipsis">孤儿文件 · 1 个未引用缩略图</span><span class="act">物理清理</span></div>
            <div class="issue"><span class="badge warn">警告</span><span class="ellipsis">受控目录 · 1 个文件位于工作区外</span><span class="act">查看路径配置</span></div>
            <div class="issue"><span class="badge ok">正常</span><span class="ellipsis">SQLite 外键 · 引用完整 · 项目/剧集关系一致</span></div>
          </template>
          <p v-else class="muted small">默认只读检查；完成后按「正常 / 警告 / 错误」列出结果，每项提供唯一恢复落点。</p>
        </div>

        <!-- 媒体重定位 -->
        <div v-else-if="active === 'relocation'" class="card pad">
          <b style="font-size:14px">媒体重定位</b>
          <p class="muted small" style="margin:8px 0 14px">固定流程：选目录 → 扫描匹配 → 逐文件预览 → 明确确认更新。确认前不写入任何路径。</p>
          <button class="btn primary" @click="comingSoon('重定位扫描（需本地文件系统扫描器）')">选择目录并扫描</button>
        </div>

        <!-- 迁移与恢复记录 -->
        <div v-else-if="active === 'journal'" class="card pad">
          <b style="font-size:14px">迁移与恢复记录</b>
          <div class="v-row" style="margin-top:12px">
            <div>
              <b style="font-size:13px">V2.1 正式迁移</b>
              <div class="vm">状态 COMMITTED · 目标版本 2.1.0<br>备份目录 backend-node/data/backups/v2.1/&lt;migration-id&gt; · 首次成功备份永久保留</div>
            </div>
            <span class="badge ok" style="margin-left:auto">COMMITTED</span>
          </div>
          <p class="muted small" style="margin-top:10px">失败记录会提供 journal / 备份 / 事务步骤与继续迁移或回滚入口。</p>
        </div>

        <!-- 物理清理 -->
        <div v-else-if="active === 'cleanup'" class="card pad">
          <b style="font-size:14px">物理清理（dry-run）</b>
          <p class="muted small" style="margin:8px 0 12px">只能从 dry-run 清单进入；有引用、任务占用或路径越界的文件会被阻断。</p>
          <button class="btn primary" @click="dryRun = true">生成 dry-run 清单</button>
          <template v-if="dryRun">
            <div class="divider"></div>
            <div class="issue"><span class="badge ok">可清理</span><span class="ellipsis mono xs">tmp/preview-shot-01.png · 0.2 MB</span><span class="act">勾选</span></div>
            <div class="issue"><span class="badge danger">阻断</span><span class="ellipsis mono xs">storage/character-03.png · 有引用（2 个候选）</span></div>
            <div class="issue"><span class="badge danger">阻断</span><span class="ellipsis mono xs">storage/shot-05.mp4 · 任务占用</span></div>
            <div class="divider"></div>
            <div class="row">
              <span class="small t2">预计回收 0.2 MB · 可清理 1 个文件</span>
              <div class="spacer"></div>
              <input class="input" style="width:170px" v-model="cleanupConfirmText" placeholder='输入「永久清理」'>
              <button class="btn danger" :disabled="cleanupConfirmText !== '永久清理'" @click="secondConfirm">永久清理</button>
            </div>
            <p v-if="cleanupDone" class="ok-t small" style="margin-top:10px">已删除 1 个文件 · 报告已保留（含未删除与失败原因）。</p>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'DataToolsView',
  data() {
    return {
      active: 'integrity', scanning: false, checked: false, dryRun: false,
      cleanupConfirmText: '', cleanupDone: false,
      tools: [
        { id: 'integrity', label: '完整性检查' },
        { id: 'relocation', label: '媒体重定位' },
        { id: 'journal', label: '迁移与恢复记录' },
        { id: 'cleanup', label: '物理清理' },
      ],
    }
  },
  methods: {
    runCheck() {
      this.scanning = true
      setTimeout(() => { this.scanning = false; this.checked = true }, 900)
    },
    secondConfirm() {
      if (window.confirm('物理清理不可恢复。确认执行永久清理？')) {
        this.cleanupDone = true
      }
    },
    comingSoon(name) {
      alert(`${name}将在本迭代内启用`)
    },
  },
}
</script>

<style scoped>
.page-body { display: flex; gap: 16px; overflow: auto; }
.stats-row { display: flex; gap: 8px; margin-bottom: 12px; }
.issue { display: flex; align-items: center; gap: 10px; padding: 8px 0; font-size: 12.5px; border-bottom: 1px solid var(--line); }
.issue .act { margin-left: auto; color: var(--accent); cursor: pointer; white-space: nowrap; font-size: 12px; }
.v-row { border: 1px solid var(--line); border-radius: 10px; background: var(--panel2); padding: 13px 12px; display: flex; align-items: flex-start; gap: 12px; }
.v-row .vm { font-size: 11px; color: var(--muted); margin-top: 3px; line-height: 1.6; }
.mono { font-family: Consolas, monospace; }
</style>
