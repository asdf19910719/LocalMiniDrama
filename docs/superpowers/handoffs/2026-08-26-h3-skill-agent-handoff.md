# H3 技能调用改造交接

更新时间：2026-08-26
状态：开发中，Task 1、Task 2 已完成；Task 3 尚未开始。

## 1. 问题背景与用户目标

主分支已包含此前两个并行窗口的成果：

- a12cbed：修复生成视频候选时 workflowId 缺失被拦截的问题，默认使用 h3-continuity-v1。
- 83eeedb：合并 ChatGPT 图片生成 provider / 外部网页单会话相关代码。

之后用户发现分镜提示词有台词，但生成视频没有人物说话。H3 编译器原来只是把一段缩减版格式说明交给通用 aiClient.generateText()，并检查少量字段；文本模型没有真实调用 h3-prompt-writing 技能，因此无法证明它完整读取并执行说话人 ID、台词 d 标签、声音、时间线及引用素材规则。

用户明确要求：让配置的文本 AI 真实调用技能，而不是把技能规则复制或注入普通提示词。用户已确认采用方案 1：后端内置受控的两轮工具调用代理。

## 2. 已确认方案

每次 H3 预览或正式生成执行同一条链路：

1. h3Mode() 确定 T2VA、I2VA、FL2VA、L2VA 或 Ref2VA。
2. 文本模型第一轮请求只提供 load_skill 工具，并强制 tool_choice 指向该工具。
3. 模型必须真实返回 load_skill，参数必须为 h3-prompt-writing。
4. 后端校验工具名、参数和白名单，加载项目内完整技能包。
5. 后端以 tool 消息返回 SKILL.md、当前模式所需参考指南及包 SHA-256。
6. 文本模型第二轮设置 tool_choice 为 none，只输出最终 H3 提示词。
7. validateH3Prompt() 校验结果，随后持久化技能溯源并提交视频 provider。

关键约束：

- 最多两次模型请求、恰好一次工具执行，不做递归代理。
- 只允许精确技能名 h3-prompt-writing，模型不能传文件路径。
- provider 不支持标准 assistant.tool_calls 时，以 H3_SKILL_TOOL_CALL_UNSUPPORTED 失败关闭。
- 不允许降级回旧的提示词注入方案。
- 非 H3 的 generateText() 和 streamGenerateText() 行为保持不变。
- 日志不得记录技能全文、完整提示词或 API key。
- 这能保证文本模型真实加载技能并生成合规提示词，但不能绝对保证视频模型渲染每个发音；最终仍受视频 provider 的音频和口型能力限制。

详细材料：

- docs/superpowers/specs/2026-08-26-h3-skill-agent-design.md
- docs/superpowers/plans/2026-08-26-h3-skill-agent.md

## 3. 仓库、分支和工作树

环境给出的 cwd 是 E:\project\AIStory，但实际运行项目仓库是：

    E:\project\LocalMiniDrama

本功能使用隔离工作树：

    工作树：E:\project\LocalMiniDrama\.worktrees\h3-skill-agent-work
    分支：feature/h3-skill-agent
    本文档提交前 HEAD：e49ca5e

后续所有实现必须在该隔离工作树进行。backend-node 和 frontweb 的 node_modules 通过目录联接复用主工作区依赖。

第一次创建工作树时 Git LFS 挂起，可能留下失败目录：

    E:\project\LocalMiniDrama\.worktrees\h3-skill-agent

有效目录是带 -work 后缀的工作树。收尾时不要粗暴删除失败目录；应先确认其绝对路径及 Git 注册状态。

## 4. 主工作区中必须保留的用户文件

开始时主工作区已有以下无关改动，不能覆盖、清理或提交：

    M  docs/research/_artifacts/director-iteration-browser-smoke.json
    M  docs/research/_artifacts/unified-video-desktop-acceptance.json
    ?? .worktree-deps-unified-video-provider-node24/
    ?? package-lock.json

## 5. 当前已完成工作

### 5.1 设计与计划

已提交：

    1c75e4e docs: design H3 skill-calling prompt agent
    7b2ae59 docs: plan H3 skill-calling prompt agent

### 5.2 Task 1：项目内技能包和安全注册表

已提交：

    99a65d4 feat: add allowlisted H3 skill package

新增文件：

    backend-node/skills/h3-prompt-writing/SKILL.md
    backend-node/skills/h3-prompt-writing/references/base-en.txt
    backend-node/skills/h3-prompt-writing/references/ref-en.txt
    backend-node/src/services/skillRegistry.js
    backend-node/test/skillRegistry.test.js

接口为 loadSkillPackage(skillName, { mode })，返回 skillName、sha256 和 resources。

已实现精确白名单、模式相关资源选择、路径包含检查、单资源及包大小限制、规范化 SHA-256 和稳定错误码。三个项目内资源已与安装源逐字节核对：

    SKILL.md
    a7000443588ca3f145e3b3fd8900f14e0325dc460bd811268fac89a9dc8e56d0

    references/base-en.txt
    2cfebc096a6e08370f288d468d90b60f7f9bcb938f94bf090816e910e48e75fc

    references/ref-en.txt
    1e574f356716ad55612247ffb7bbccbcdb484ad96599d63c7dca1af186b1fab7

聚焦测试结果：4/4 通过。

### 5.3 Task 2：原生 tool_calls 文本传输

已提交：

    e49ca5e feat: support text model tool calls

修改或新增：

    backend-node/src/services/aiClient.js
    backend-node/test/aiClientToolCalling.test.js

新增 createChatCompletion(db, log, serviceType, messages, options)，支持 scene_key、tools、tool_choice、temperature、max_tokens 和 stream:false，返回完整 message、model、configId、elapsedMs。

postJSONNonStream() 保留原 body 行为并增加 json，因此未破坏既有视觉调用。工具调用与既有流式 AI 客户端测试合计 4/4 通过。

## 6. 测试基线

改造开始前在隔离工作树完整验证：

    后端：250 passed，0 failed
    前端：55 passed，0 failed

所有测试固定使用：

    E:\AI\tools\node-v22.22.3-win-x64\node.exe

## 7. 下一步从 Task 3 继续

先严格 TDD 新建失败测试：

    backend-node/test/h3SkillAgent.test.js

再实现：

    backend-node/src/services/h3SkillAgent.js

目标接口：createH3SkillAgent({ createChatCompletion, loadSkillPackage }).run(db, log, { mode, durationSeconds, sourceBundle })。

返回 prompt 和 provenance；provenance 包含 skillName、skillSha256、skillResources、toolCallId、model、configId。

Task 3 测试至少覆盖：

1. 第一轮强制 load_skill，且总共恰好两轮请求。
2. tool 消息使用模型原始 tool_call_id。
3. 缺少 tool_calls 返回 H3_SKILL_TOOL_CALL_UNSUPPORTED。
4. 错误工具名、畸形 JSON、错误技能名、缺失 call ID 返回 H3_SKILL_TOOL_CALL_INVALID。
5. 第二轮再次调用工具返回 H3_SKILL_TOOL_CALL_REPEATED。
6. 第二轮空内容返回 H3_SKILL_FINAL_EMPTY。

随后按计划继续：

- Task 4：h3PromptCompiler 从 generateText() 切到 skill agent，版本改为 h3-skill-agent-v1。
- Task 5：增加 migration 26 并持久化技能 provenance。
- Task 6：前端映射不支持 tool calling 的中文错误，更新配置文档，执行全量测试、构建和本地 H3 预览 smoke check。

## 8. 开发纪律

- 使用 apply_patch 修改文件。
- 严格 TDD：先写测试并确认预期失败，再实现。
- 非预期失败先按 systematic debugging 查根因。
- 不改变通用 generateText() 行为。
- 技能全文只能在模型实际调用工具后作为 tool 消息返回，不能提前拼入 system prompt。
- 每个 Task 绿灯后单独提交。
- 宣称完成前执行完整后端、前端测试和前端构建。
- 最终按 requesting-code-review、verification-before-completion、finishing-a-development-branch 收尾。

## 9. 新窗口首批命令

    Set-Location E:\project\LocalMiniDrama\.worktrees\h3-skill-agent-work
    git status --short
    git log --oneline -6
    Get-Content -Raw docs\superpowers\handoffs\2026-08-26-h3-skill-agent-handoff.md
    Get-Content -Raw docs\superpowers\plans\2026-08-26-h3-skill-agent.md

确认当前 HEAD 包含本交接文档提交后，从 Task 3 的失败测试开始。
