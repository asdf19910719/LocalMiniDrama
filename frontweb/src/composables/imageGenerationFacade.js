export function createImageGenerationFacade(store, state) {
  return {
    ...state,
    loadSummary: store.loadSummary,
    loadDefault: store.loadDefault,
    setDefaultChannel: store.setDefaultChannel,
    checkEnvironment: store.checkEnvironment,
    open: store.openTask,
    refresh: store.refreshTask,
    sendToChatGPT: store.sendToChatGPT,
    recoverCapture: store.recoverCapture,
    requeueTask: store.requeueTask,
    selectResult: store.selectResult,
    close: store.closeDrawer,
  }
}
