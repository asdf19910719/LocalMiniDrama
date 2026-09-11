<template>
  <div class="v21-state" :class="'v21-state-' + state">
    <!-- loading：简洁行骨架占位（加载完成前绝不渲染空态/错误文案） -->
    <template v-if="state === 'loading'">
      <div class="v21-state-skeleton" aria-hidden="true">
        <i class="sk-line" style="width:38%"></i>
        <i class="sk-line" style="width:82%"></i>
        <i class="sk-line" style="width:66%"></i>
        <i class="sk-line" style="width:74%"></i>
      </div>
      <span v-if="message" class="v21-state-msg">{{ message }}</span>
    </template>
    <!-- error：危险消息 + 重试（调用方监听 @retry 执行各自 load） -->
    <template v-else-if="state === 'error'">
      <svg class="v21-state-ic"><use href="#i-warn"/></svg>
      <span class="v21-state-msg">{{ message }}</span>
      <button v-if="retry" class="btn" @click="$emit('retry')"><svg><use href="#i-refresh"/></svg>重试</button>
    </template>
    <!-- empty：空态消息 + 动作插槽（保留各页现有文案与动作） -->
    <template v-else>
      <svg class="v21-state-ic"><use :href="icon || '#i-cube'"/></svg>
      <span class="v21-state-msg">{{ message }}</span>
      <slot></slot>
    </template>
  </div>
</template>

<script>
// Task 5-B（Phase 5 横切 B）：页面状态机统一的最小复用组件。
// 用法：<StateBlock v-if="loading && !loaded" state="loading" />
//      <StateBlock v-else-if="loadError" state="error" :message="'xx加载失败：' + loadError" @retry="load" />
//      <StateBlock v-else-if="items.length === 0" state="empty" message="还没有xx"><button …/></StateBlock>
export default {
  name: 'StateBlock',
  props: {
    // 'loading' | 'error' | 'empty'
    state: { type: String, default: 'loading' },
    message: { type: String, default: '' },
    // error 态是否显示重试按钮
    retry: { type: Boolean, default: true },
    // empty 态图标（可选，默认 #i-cube）
    icon: { type: String, default: '' },
  },
  emits: ['retry'],
}
</script>
