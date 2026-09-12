# L3 运行共享上下文（所有波次子代理必读）

run_id: run_20260912_072912 · 模式 L3 · scope=全项目 · 分支 codex/v2-1-implementation

## 用户强制约束（不可违反）

1. **真实测试，禁止 mock**。文本生成走 DeepSeek 真实 key；视频生成走 ComfyUI H3（8188 已运行）。
2. **唯一例外：图片超分（upscale）允许模拟**（远端 Zealman 供应商不可用）。
3. 图像生成成功路径走 ChatGPT 网页通道（chatgpt_web），由主会话的 E2E 阶段覆盖；
   API 层对 18080 shim 的测试只测真实错误路径（该服务当前离线，属真实外部状态，不是 mock）。
4. 不得为让用例通过而跳过、降级断言或改产品代码。只记录缺陷，不修复。

## 环境事实

- 后端: http://127.0.0.1:5679 （健康检查 /health）— **必须用 Node 22**: `E:/AI/tools/node-v22.22.3-win-x64/node.exe`
  （PATH 上默认 node 是 v24，better-sqlite3 ABI 不匹配会崩溃）
- 前端: http://127.0.0.1:3013 （Vite dev，/api 代理到 5679）
- ComfyUI: http://127.0.0.1:8188 （H3 视频模型齐全：r2v_te_speed / r2v 工作流，1312x736）
- DeepSeek: ai_service_configs id=4，service_type=text，default=1（真实 key 已配置）
- 图像默认通道: Local Shim 127.0.0.1:18080（离线）
- DB: backend-node/data/drama_generator.db（SQLite，只读查询用 python sqlite3）
- **服务由主会话管理：子代理禁止启动/杀死/重启任何服务进程**
- 测试数据一律加前缀 `QA-L3-`，结束后不清理（供复核）

## 测试命令（真实执行）

```bash
NODE22="E:/AI/tools/node-v22.22.3-win-x64/node.exe"
cd /e/project/LocalMiniDrama/backend-node && "$NODE22" --test test/*.test.js   # 后端既有套件
cd /e/project/LocalMiniDrama/frontweb && node --test test/*.test.js            # 前端既有套件
```

## 需求文档（按优先级）

1. 主需求: docs/current/feature-inventory.md（15 组功能 + BROKEN/PARTIAL/LEGACY 标注 = 异常用例来源）
2. 设计: docs/current/architecture.md · docs/current/data-model.md
3. 参考: docs/current/product-model.md · docs/qa/product-test-map.md（23 页面+17 核心流）·
   docs/qa/bug-report.md（已知缺陷，验证不回归）· docs/superpowers/specs/2026-09-08-production-studio-v2.1-e2e-acceptance-matrix.md
4. 指引分册: E:/project/TestAgent/agents/guidance/backend-api.md · web-frontend.md（用例 YAML schema 与执行规范）

## 产出约定

- 用例: `qa/cases/<模块码>/TC-<模块码>-<NNN>.yml`（schema 见 guidance；requirement 引用文档条款）
- 执行日志: 逐条 append `qa/run/execution-log.jsonl`，字段:
  `{"case_id","title","module","level","priority","status":"passed|failed|blocked","evidence","duration_ms","error_summary"}`
  - blocked 仅限：外部依赖不可用且用户未允许模拟（如 18080 图像成功路径→由 E2E 阶段覆盖的除外）
  - evidence 必须是可复核证据：命令输出摘要 / HTTP 状态+响应片段 / DB 查询结果 / 文件:行
- 缺陷: `qa/bugs/BUG-L3-<序号>.yml`（case_id, severity, title, steps, expected, actual, evidence, suspected_cause）
- 波次总结: `qa/run/wave-<N>-results.md`

## 模块码

SHELL 应用壳与导航 · PROJ 项目与剧集 · IMPORT 导入导出 · PKG 剧集包与外部AI · SCRIPT 故事与脚本 ·
ASSET 角色场景道具 · EPSET 本集设定 · STORYBOARD 分镜 · IMAGE 图像生成 · VIDEO 视频生成 ·
AUDIO 音频字幕成片 · UPSCALE 超分后处理 · CANVAS 画布导演 · AICONF AI配置 · MEDIA 媒体库 · TASK 任务可靠性

## 真实调用成本约束

- DeepSeek 真实调用：每功能流 ≤2 次（正常 1 + 异常/边界 1）
- ComfyUI 真实视频生成：全 run ≤3 次（单次数分钟，生成前确认 8188 队列为空）
- 不得对 ChatGPT 网页通道做 API 级模拟
