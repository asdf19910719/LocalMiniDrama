# 真实 ChatGPT 图片生成模拟测试：启动与验收

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
