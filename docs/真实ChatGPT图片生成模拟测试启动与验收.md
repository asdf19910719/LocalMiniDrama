# 真实 ChatGPT 图片生成模拟测试：启动与验收

本文记录通过真实登录态 ChatGPT 网页、Playwright Chromium 和 MV3 扩展执行图片生成的可复现方式。该流程会在 ChatGPT 网页中真实填写提示词、点击发送、等待生成结果，再由扩展下载原图并导入本地后端。

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

必须让 Chromium 保留扩展相关默认参数被移除，并显式加载扩展目录：

```js
const context = await chromium.launchPersistentContext(
  'E:/project/AIStory/docs/research/_artifacts/chrome-live-playwright-run',
  {
    headless: false,
    executablePath: 'C:/Users/26373/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe',
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      '--disable-extensions-except=E:/AI/references/LocalMiniDrama/.worktrees/unified-chatgpt-image-generation/browser-extension',
      '--load-extension=E:/AI/references/LocalMiniDrama/.worktrees/unified-chatgpt-image-generation/browser-extension',
    ],
  },
)
```

上例中的第一个参数最终值必须是 `--disable-extensions-except=<extension>`，不要保留示例代码中的空格。若浏览器仍显示未加载扩展，先完全退出使用该 profile 的 Chrome 进程，再重新启动。启动后可检查：

- `chrome://extensions` 中出现 AIStory 扩展；
- ChatGPT 页面根节点存在 `data-aistory-chatgpt-bridge="v1"`；
- `context.serviceWorkers()` 能看到扩展 worker。

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
- 点击 ChatGPT 生图无反应：打开任务抽屉查看状态；若为“准备中”且有错误提示，点击“重试发送”。重点检查扩展是否注入（ChatGPT 页面根节点有 `data-aistory-chatgpt-bridge="v1"`）、页面是否登录以及当前 profile 是否就是启动扩展的 profile。
- 参考图上传失败：检查 `/static/...` 响应的 `Content-Type`。扩展会拒绝 `text/html` 等 SPA fallback，不会把 HTML 上传给 ChatGPT。
- 导入提示 attempt 不存在：从后端任务 API 读取真实 attempt ID，不要手工复用旧截图或旧脚本中的 ID。
- 预览空白：检查任务结果是否有 `preview_url`，并直接请求该地址确认 `image/png`；不要在工作台直接使用 ChatGPT 的临时 `source_url`。
