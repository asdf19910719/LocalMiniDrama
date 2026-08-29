# 真实 ChatGPT 图片生成模拟测试：启动与验收

## 2026-08-28 session paused 恢复复验

- 根因：扩展本地会话曾因 `provider tab unavailable` 保留为 `paused`，浏览器重启后同一 ChatGPT conversation 已恢复，但旧逻辑没有清除暂停状态。
- 修复：当前标签页确认仍是已绑定的同一 conversation 时，扩展自动恢复会话为 `active`，并同步项目会话；身份漂移仍保持暂停保护。
- 回归测试：browser-extension 全量 `41/41`，构建通过。
- 真实任务：Task `1ecad200-89a8-47e1-ae7c-188718da4980`，Attempt `3d1324c0-db69-4d88-b37d-8b84786d3ca3`。
- ChatGPT 真实页面生成 3 张道具候选，扩展捕获 assistant `conversation-turn-12` 并导入；选择结果 `ab4ab05f-6a6f-4c51-8aa7-963707be907c` 后 Task 状态为 `completed`，道具主图完成绑定。

本文记录通过真实登录态 ChatGPT 网页、Playwright Chromium 和 MV3 扩展执行图片生成的可复现方式。该流程会在 ChatGPT 网页中真实填写提示词、点击发送、等待生成结果，再由扩展下载原图并导入本地后端。

## 当前代码与回归状态

统一图片生成已合并到本地 `main`。当前 Node 22.22.3 后端全量测试 `303/303`、扩展测试 `39/39`、前端测试 `61/61`、前端生产构建均通过。角色入口的提示词已修正为视觉外貌提示词，不再使用角色背景简介。

## 环境要求

- Node.js 22（本项目验证版本：`E:\AI\tools\node-v22.22.3-win-x64\node.exe`）
- 已安装依赖：`backend-node`、`frontweb`、`browser-extension`
- ChatGPT 账号已在测试 profile 中登录
- Playwright Chromium 可执行文件：`C:\Users\26373\AppData\Local\ms-playwright\chromium-1234\chrome-win64\chrome.exe`

测试不会替用户完成登录。首次运行时应在指定 profile 的 ChatGPT 页面手工登录一次，之后复用该 profile 即可。

## 启动后端

在工作树 `E:\AI\references\LocalMiniDrama\.worktrees\unified-chatgpt-image-generation\backend-node` 中运行：

```powershell
$env:PORT='5679'
& 'E:\AI\tools\node-v22.22.3-win-x64\node.exe' src/server.js
```

健康检查：

```powershell
curl.exe http://127.0.0.1:5679/health
```

应返回 `{"status":"ok"...}`。后端默认使用 `backend-node/data/drama_generator.db` 和 `backend-node/data/storage`。

## 启动前端

在另一个终端的工作树根目录运行：

```powershell
cd E:\AI\references\LocalMiniDrama\.worktrees\unified-chatgpt-image-generation\frontweb
npm run dev -- --host 127.0.0.1 --port 3013
```

工作台地址：`http://127.0.0.1:3013/drama/3/canvas`。Vite 代理默认把 `/api` 转发到 `http://127.0.0.1:5679`。

项目默认生图方式可在 `FilmCreate` 的“一键全流程”工具条或“剧集管理”页面的“剧集信息”中设置为“ChatGPT 生成”。保存后，所有统一图片按钮的主操作都会使用 `chatgpt_web`；按钮下拉菜单仍可只对当前任务临时切换。

## 构建扩展

扩展源码修改后，在 `browser-extension` 目录运行：

```powershell
cd E:\AI\references\LocalMiniDrama\.worktrees\unified-chatgpt-image-generation\browser-extension
npm run build
```

## 启动真实浏览器

日常启动可直接运行仓库根目录脚本：

```powershell
.\start_chatgpt_browser.ps1
```

脚本默认使用 Chrome for Testing 和 `data/chatgpt-browser-profile`。可通过 `CHATGPT_BROWSER_PATH`、`CHATGPT_BROWSER_PROFILE` 覆盖路径。它不会替用户登录；首次登录后凭据保存在该 Profile，后续启动自动复用。

使用 `run_dev.ps1` 或 `run_dev.bat` 启动整个项目时，不必再单独运行该脚本：后端健康后会读取“API 配置 -> 生成设置 -> 统一图片通道”，若 ChatGPT Web 已启用则自动启动浏览器。浏览器可执行文件留空时会自动查找 `%LOCALAPPDATA%\ms-playwright\chromium-*\chrome-win64\chrome.exe`。

Windows 下启动器会额外传入 `--do-not-de-elevate` 和 `--no-sandbox`。这是当前 Chrome for Testing 在项目启动上下文中稳定保留 Profile、扩展和调试端口所需的组合；该浏览器必须使用独立的 `data/chatgpt-browser-profile`，只用于 ChatGPT 生图，不作为日常浏览器。脚本会等待默认调试端口 `9223` 进入监听状态，端口未就绪时输出失败告警，不再仅凭 `Start-Process` 返回就报告成功。

必须让 Chromium 保留扩展相关默认参数被移除，并显式加载扩展目录：

```js
const context = await chromium.launchPersistentContext(
  'E:/AI/references/LocalMiniDrama/data/chatgpt-browser-profile',
  {
    headless: false,
    executablePath: 'C:/Users/26373/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe',
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      '--do-not-de-elevate',
      '--no-sandbox',
      '--disable-extensions-except=E:/AI/references/LocalMiniDrama/browser-extension',
      '--load-extension=E:/AI/references/LocalMiniDrama/browser-extension',
    ],
  },
)
```

上例中的第一个参数最终值必须是 `--disable-extensions-except=<extension>`，不要保留示例代码中的空格。若浏览器仍显示未加载扩展，先完全退出使用该 profile 的 Chrome 进程，再重新启动。启动后可检查：

不要把可执行文件替换为 `C:\Program Files\Google\Chrome\Application\chrome.exe`。正式版 Chrome 151 即使命令行里保留 `--load-extension`，也可能直接忽略未打包扩展；本项目验收必须使用上方 Playwright Chrome for Testing/Chromium 可执行文件。2026-08-28 已复现并确认：正式版 Chrome 的扩展列表为空，换回 Chrome for Testing 后 ChatGPT 根节点恢复 `data-aistory-chatgpt-bridge="v1"`。

- `chrome://extensions` 中出现 AIStory 扩展；
- ChatGPT 页面根节点存在 `data-aistory-chatgpt-bridge="v1"`；
- `context.serviceWorkers()` 能看到扩展 worker。

2026-08-28 自动启动复验：`9223` 实际监听；`/json/list` 同时列出 `https://chatgpt.com/` 页面与 `chrome-extension://.../src/background.js` service worker；CDP 读取 ChatGPT 根节点得到 `data-aistory-chatgpt-bridge="v1"`。在同一浏览器打开 `http://127.0.0.1:3013/film/3?episode=3`，13 个图片入口按钮均为“ChatGPT 生成”。

## 真实用户流程

1. 打开 `https://chatgpt.com/`，确认测试 profile 已登录。
2. 打开工作台 `drama/3/canvas`，选择道具“赤红玉简”。
3. 点击图片生成入口并选择“ChatGPT 生成”。
4. 扩展自动把提示词填入 ChatGPT，用户流程在 ChatGPT 页面真实点击发送。
5. 等待 ChatGPT 生成图片。扩展监听当前 assistant turn，恢复页面或重新连接后仍可捕获结果。
6. 扩展通过 `POST /api/v1/external-generation/results/import` 上传原始图片字节。
7. 工作台候选列表显示本地 `preview_url`，选择“设为当前图片”完成绑定。

本次真实验收记录：

- Task：`1684a88f-690c-49fb-9799-2272dce7c37d`
- Job：`7e4d5310-0c43-4d07-bcf9-c60bd9ab71cc`
- Attempt：`b2c164a8-4d55-4059-8379-2332ff95a86d`
- Conversation：`6a9075b9-6fdc-83ec-84e0-22964ad096b9`
- 真实生成候选数：3，原图尺寸：`1672x941`
- 选择第一候选后 Task 状态：`completed`
- 道具主图已绑定，候选状态为 `bound/selected=1`

## 后端验收查询

```powershell
$task = Invoke-RestMethod -Uri 'http://127.0.0.1:5679/api/v1/image-generation-tasks/1684a88f-690c-49fb-9799-2272dce7c37d'
$task.data.status
$task.data.external_job.attempts[0].results | Select-Object id,status,selected,preview_url
```

候选预览地址形如：

```text
/api/v1/external-generation/results/<resultId>/content
```

请求应返回 `200 image/png`。该接口读取后端已保存的原始文件，不依赖 ChatGPT 临时 URL 或浏览器登录态。

## 常见故障

- 扩展不显示：确认 `ignoreDefaultArgs: ['--disable-extensions']` 和两个显式扩展参数同时存在，并关闭旧 Chrome profile 锁。
- 启动脚本显示失败或浏览器闪退：确认使用 Chrome for Testing，并检查命令行同时包含 `--do-not-de-elevate`、`--no-sandbox`、独立 `--user-data-dir` 和两个扩展参数；再检查 `Get-NetTCPConnection -LocalPort 9223 -State Listen`。不要用同一个 Profile 启动多个浏览器实例。
- 页面仍显示“默认模型”：全局启用只表示 ChatGPT 通道可用，不会覆盖既有剧集。到剧集管理将当前剧集的“默认生图方式”切换为 ChatGPT，或调用 `PUT /api/v1/dramas/<dramaId>/image-generation-default` 保存 `{"channel":"chatgpt_web"}`，然后刷新制作页。
- 点击 ChatGPT 生图无反应：打开任务抽屉查看状态；若为“准备中”且有错误提示，点击“重试发送”。重点检查扩展是否注入（ChatGPT 页面根节点有 `data-aistory-chatgpt-bridge="v1"`）、页面是否登录以及当前 profile 是否就是启动扩展的 profile。
- 任务显示“已发送”但没有候选：保持原 ChatGPT 会话打开，点击“恢复结果捕获”。该操作只重新挂接扩展监听，不会再次发送提示词；前端随后每 3 秒刷新任务，导入结果会自动出现在候选区。
- 2026-08-28 对遗留角色任务 `ae204682-e843-477e-9fa8-7838d502ddba` 的诊断：后端已有真实 `SUBMITTED` 事件，但 9343 profile 的 ChatGPT 页面注入标记为空且扩展 service worker 不存在，说明扩展当时未运行；任务本身并非未创建。
- 参考图上传失败：检查 `/static/...` 响应的 `Content-Type`。扩展会拒绝 `text/html` 等 SPA fallback，不会把 HTML 上传给 ChatGPT。
- 导入提示 attempt 不存在：从后端任务 API 读取真实 attempt ID，不要手工复用旧截图或旧脚本中的 ID。
- 预览空白：检查任务结果是否有 `preview_url`，并直接请求该地址确认 `image/png`；不要在工作台直接使用 ChatGPT 的临时 `source_url`。

## 2026-08-28 本轮回归与真实复验

代码回归结果：Node 22.22.3 后端串行全量 `305/305`、前端全量 `66/66`、扩展全量 `40/40`，前端生产构建和扩展构建均通过。后端必须使用 `--test-concurrency=1`，否则共享临时数据库的旧 Director 套件会互相争用。

本轮真实浏览器已按专用 Profile 重启，`9223` 可访问，ChatGPT 页面注入 `data-aistory-chatgpt-bridge="v1"`，扩展 service worker 存在。通过真实工作台按钮创建道具任务后，抽屉显示正确的“赤红玉简”道具提示词，新任务保持独立 `preparing` 状态。

重启后的自动会话恢复已在扩展层验证：首页会自动导航到项目绑定会话并等待 composer ready；中文页面的发送按钮同时兼容 `Send` 和“发送” aria-label。若 ChatGPT 仍在登录加载、限流或 composer 未 ready，任务会停留在 `preparing` 并显示可重试错误，不会伪报“已发送”；重试不创建新任务，也不重复发送已提交 Attempt。

## 2026-08-28 图片绑定后页面刷新复验

- 发现并修复前端将 Windows 绝对 `local_path` 直接拼成 `/static/E:/...` 的问题；该地址会命中 Vite fallback HTML，导致生成成功后卡片空白。
- 统一媒体 URL 现在会识别 `data/external-web/<drama>/<storyboard>/<resultId>/...`，改用 `/api/v1/external-generation/results/<resultId>/content` 本地内容接口；旧的 storage 相对路径仍走 `/static/`。
- 真实重载 `http://127.0.0.1:3013/film/3?episode=3` 后，赤红玉简图片使用结果内容接口，浏览器 `naturalWidth=1672`、`naturalHeight=941`，接口返回 `200 image/png`。
- 前端回归测试 `68/68`，前端生产构建通过；该验证覆盖 DramaDetail、FilmCreate、FilmList 和 MediaLibrary 的图片展示入口。

## 2026-08-28 捕获链路缺陷修复与全链路复验

按真实用户流程对分镜主图做 GUI 黑盒验收（专用 Chrome 9223 + 真实工作台页面），发现结果自动捕获链路 4 类缺陷并全部修复。修复提交：`6c59b16`（扩展）、`27ba15f`（后端），全部先写失败测试再实现。

### 缺陷与修复

1. **旧 turn 劫持绑定**：`beginAttempt` 在提交前快照的 turn ID 集合无法识别"已在 DOM 但身份未渲染"的旧 turn，页面刚加载完就提交时旧回复被误绑为新回复，ChatGPT 重编号后观察器成孤儿、捕获静默失败。修复：`beginAttempt` 改为快照提交前已存在的 assistant 节点（WeakSet），只绑提交后新出现的节点。
2. **user turn 劫持导入**：selector 兜底 `[data-testid^="conversation-turn-"]` 把新提交的用户消息也当绑定候选，其参考图缩略图（estuary https URL）通过白名单被当作生成结果导入（实测导入 1254x1254 四宫格缩略图、`assistant_message_id` 记录为 user turn）。修复：候选发现与 `findAssistant` 排除 `data-turn="user"`；`extractResultSet` 对 user turn 返回 GENERATING 兜底。
3. **blob: 占位图硬失败**：图片尚未物化时 `currentSrc` 为 `blob:`，抓取被 URL 白名单拒绝 → `ORIGINAL_URL_NOT_ALLOWED` → attempt 永久 `needs_review`。修复：`extractResultSet` 过滤非 http(s) 来源，保持 GENERATING 等真实 URL。
4. **needs_review 无法再导入 + 失败不可见**：`importExternalResult` 拒绝 `needs_review` attempt，而恢复路径恰恰要导入该状态；且 ADAPTER_ERROR 只写 attempt 级事件，`image_generation_tasks.error_message` 恒空，抽屉看不到失败原因（toast 约 3 秒消失 + 3 秒轮询覆盖本地错误，造成"恢复按钮点击无效"假象）。修复：允许 `needs_review` 重导入并在成功后恢复 attempt 为 `submitted`、清除任务级错误字段；`recordAttemptEvent` 将 ADAPTER_ERROR 的 code/message 镜像到关联任务，健康生命周期事件清除之。

### 回归与部署

- Node 22.22.3：后端全量 `307/307`（`--test-concurrency=1`）、前端 `69/69`、扩展 `45/45`，前端 Vite 与扩展 esbuild 构建通过。新增测试：blob 过滤 x2、幽灵 turn 排除、user turn 劫持排除（扩展）；needs_review 导入、任务错误镜像（后端）。
- 后端需重启加载新服务代码；扩展 content bundle 对 unpacked 安装在 tab 导航时从磁盘重读，无需扩展重载。注意：`chrome.runtime.reload()` 会把 unpacked 扩展置为 DISABLED（Chrome 怪癖），重载后若"插件未响应"先到 `chrome://extensions` 检查启用状态。

### 修复后全链路复验（真实生成一次）

分镜 12「记忆的倔强」点击"ChatGPT 生成"→ 任务自动创建并真实发送 → ChatGPT 生成 1672x941 → **60 秒内 3 个候选全自动导入，零手动干预**；attempt 正确绑定本次 assistant 回复（`conversation-turn-12`），user turn 被排除；抽屉显示"请选择图片"→ 选择候选后任务 `completed`、候选 `bound`、storyboard `local_path` 指向选中候选；刷新页面后分镜图正确显示。证据：AIStory 仓库 `docs/research/_artifacts/unified-chatgpt-image-fix-verification-2026-08-28.json`。

### 挂起观察

- 首次发送环节出现过一次未复现的后端 500（`prepare-send` 对 draft 会原地转 preparing，相关路由均为 400 包装，源头待复现捕获）；修复后任务级错误已可见，复现时可直接从抽屉与日志定位。
- 测试遗留任务：`64698fd1`（needs_review，含 3 个有效候选可选）、`44959032`（preparing）、`725feae6`（submitted，attempt needs_review）可手动取消或清理。
- storyboard 绑定后 `status` 字段仍为 `pending`（图片显示不受影响，字段语义待确认）。

## 2026-08-28 恢复按钮 postMessage 克隆错误修复

用户点击"恢复结果捕获"时页面报 `Failed to execute 'postMessage' on 'Window': #<Object> could not be cloned`。根因：`recoverCapture` 把 store reactive 树里的 attempt 对象（Vue 深层 Proxy）直接传入 `window.postMessage`，而 postMessage 使用结构化克隆算法、无法克隆 Proxy。`sendToChatGPT` 的消息全部来自 API 响应（纯 JSON）不受影响，因此该错误只在恢复/重绑路径出现。

修复（`2f656bf`，TDD）：

1. 桥接边界 `sendImageGenerationBridgeMessage` 新增 `toPlainMessage` 规范化：递归展开 Proxy/嵌套对象为纯数据、丢弃函数值、保留 Uint8Array 等结构化克隆支持的二进制类型。
2. `recoverCapture` 改为只传 attempt 的纯字段（id/status/sequence/assistant_message_id/conversation_id）。

回归：前端 `72/72`（新增 3 个桥接规范化测试，用 Node `structuredClone` 与浏览器同算法验证）、Vite 构建通过。实机复验：场景任务真实发送成功 → 点击"恢复结果捕获"无任何错误（修复前必现）→ 80 秒后 3 个候选自动导入闭环。

## 2026-08-28 单独生图串行队列 + 全局通知上线验收

实现计划 `docs/superpowers/plans/2026-08-28-chatgpt-image-serial-queue.md`（spec `2026-08-28-chatgpt-image-serial-queue-design.md`）已按子代理驱动流程完成 6 个任务，每个任务独立实现子代理 + 评审子代理把关（Task 5 经一轮修复）。

### 行为变更

- 单独点击任意资源的"ChatGPT 生成"：任务直接落 `queued`，抽屉显示"排队中/已加入队列"，不再立即发送；页面驱动器每 5 秒领取（`POST claim-next`，全局并发 1）自动依次发送，瞬时错误（NOT_READY 等）自动重试 2 次后转 `failed` 并推进下一个（单项失败不阻塞）。
- 抽屉新增：queued 提示条、failed"重新排队"按钮；移除 preparing+error 的手动"重试发送"（与驱动器双重驱动冲突）。
- 全局通知（右上角 ElNotification）：候选导入（生图完成：N 张候选待选择）、任务失败（含原因）、点击打开对应任务抽屉；进度态不提示，同任务同事件去重。
- DramaCanvas / DramaDetail 的生图入口同步改为纯入队（修复轮 1，防回归源断言已内置）。
- preparing 超 10 分钟的弃置任务由 claim-next 自动转 failed（error_code `send_timeout`），队列自愈。

### 回归

后端 `310/310`（`--test-concurrency=1`）、前端 `80/80`、扩展 `45/45`、前端 Vite 与生产构建通过。

### 真实验收（专用 Chrome，一次真实生成 3 个任务）

连续点击角色（云青）、道具（赤红玉简）、场景（宗门外门弟子居所）三个生图按钮：

1. 三任务全部入队，角色立即被领取发送，其余保持 `queued`——全程零 NOT_READY。
2. 约 2 分钟后角色候选导入（`needs_review`，3 候选）+ 右上角通知"生图完成：3 张候选待选择"。
3. 驱动器立即领取道具 → preparing → submitted → 候选导入（9 候选）+ 第二条通知。
4. 场景同样自动推进 → 导入 3 候选。
5. 全程零手动干预、任何时刻只有一个任务在生成（严格串行）。三任务共导入 15 个候选，全部进入待选状态。
6. 刷新页面后驱动器自动恢复推进已实测（2026-08-28 验收中驱动器随页面 reload 重启并继续消费队列，claim-next 幂等、无需额外恢复状态）。

注：串行队列上线前的历史遗留任务（preparing/submitted/draft 共 23 条）已批量标记 `cancelled`（error_code `stale_test_cleanup`），避免阻塞全局并发 1。

## 2026-08-29 抽屉重开 / 提示词恢复 / 生成耗时 / 通道切换

四个交互改进（`74fc4eb`，TDD）：

1. **生图任务常驻入口**：项目页新增"生图任务"状态胶囊（FilmCreate / DramaCanvas / DramaDetail），实时显示"排队 N · 生成中 N · 待选 N"，点击打开对应任务抽屉——不再需要重新点生图按钮才能查看结果（成功/失败/排队中均可随时查看）。
2. **下拉箭头改为切换默认通道**：拆分按钮的菜单项（ChatGPT 生成 / 默认模型生成）现在只切换剧集默认生图方式（持久化到剧集设置，与剧集管理页同源），不再立即触发生成；生成仍由主按钮发起。
3. **视频面板提示词恢复**：抽屉关闭后重新打开（"视频生成与候选"/分镜"编辑"），表单自动恢复**上次生成实际使用的提示词**（统一通道取 `video_generations.prompt`，H3 通道取 `director_jobs.input_json`），并显示"已恢复上次生成使用的提示词"提示。根因是抽屉 `destroy-on-close` 销毁内存状态且候选查询未带 prompt 快照。
4. **候选生成耗时**：视频候选卡片显示"生成耗时 X 分 X 秒"（H3 通道取 job started/completed，统一通道取 video created/completed）。

回归：后端 `312/312`（`--test-concurrency=1`）、前端 `89/89`、Vite 构建通过。实机复验：分镜 1 视频抽屉重开后提示词恢复 + 耗时"1 分 51 秒"显示；下拉切换为"默认模型生成"后默认通道持久化为 `api` 且不创建新任务。

## 2026-08-29 H3 视频生成支持角色音色参考（可选）

H3 官方 ComfyUI 工作流原生支持参考音频（`MiniMaxH3Director` 节点含 `audio_vae`/`shift_audio`，timeline v4 结构有 `global.refAudios` 与 `segments[].refAudios`）。本功能把角色已上传的音色接入该接口。

### 流程

1. 前置：角色卡上传音色（可选功能，不上传则该角色不参与，生成不受影响）。
2. 视频面板（H3 配置时）出现"角色音色参考"开关，**默认关闭**。
3. 开启后生成候选：请求带 `useVoiceReference: true` → 路由解析分镜绑定角色的**有效**音色资产（stale 的自动排除）→ 写入任务 `input_json.reference_audios`。
4. workflow 填充：`reference_audios` 映射进 timeline `global.refAudios` + `segments[0].refAudios`，ComfyUI `MiniMaxH3Director` 消费。
5. **提示词编译联动**（关键步骤）：编译源包加入 `REFERENCE_AUDIO: <角色名>` 与指令"角色语音必须与参考音频一致、说话时口型对齐"——编译出的 H3 提示词会包含 `<Audio N>` 参考标签与说话/口型描述（Ref2VA 格式原生允许 Audio 标签）。

### 实现与回归

`voiceReference.js`（解析）、`workflowRegistry.js`（timeline 填充）、`h3PromptCompiler.js`（编译源包）、`director.js`（useVoiceReference 路由接线）、视频面板开关（默认关闭）。回归：后端 `315/315`、前端 `90/90`、构建通过。实机：面板开关显示 ✓、提示词恢复 ✓、耗时显示 ✓。

### 待一次真实生成确认

ComfyUI 端 `MiniMaxH3Director` 对 `refAudios.audioFile` 路径的读取（音色文件位于应用存储目录）需一次真实 H3 生成做最终确认；若节点无法读取该路径，需将音色文件复制到 ComfyUI input 目录后再填充。
