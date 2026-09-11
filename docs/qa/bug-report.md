# QA Bug Report（发布前全量测试）

> 测试时间：2026-09-12 · 测试人：QA Agent（四角色：真实用户/QA/UX/修复工程师）
> 环境：backend :5679 + frontend :3013（Vite dev），Chrome IAB 1440×900，数据卷含历史测试项目
> 证据目录：docs/qa/screenshots/

## Bug 列表

### QA-001｜P3｜剧本确认弹窗标题重复
- Page: 剧本阶段（/projects/10/episodes/13/script）
- Scenario: 粘贴剧本→保存→点「确认剧本」
- Steps: 打开确认弹窗
- Expected: 标题「确认剧本 · 影响摘要」
- Actual: 标题「确认确认剧本 · 影响摘要」（"确认"前缀重复）
- Evidence: docs/qa/screenshots/t03_confirm_modal.png
- Root Cause: 待定位（弹窗标题拼接处）
- Status: OPEN

### QA-002｜P1｜剧本确认后页面显示"空白剧本"空态，内容看似丢失
- Page: 剧本阶段
- Scenario: 保存草稿→确认剧本→（刷新）
- Steps: 1) 粘贴三场次剧本并保存 2) 确认剧本成功（导航变"已确认 v1"、完成度 25%）3) 页面立即回退为"空白剧本"三起点空态+粘贴框；刷新后仍如此
- Expected: 已确认后应呈现已确认内容（只读视图/以 v1 为底的编辑器），主 CTA 为「进入设定」或「以已确认版本新建草稿」，不得渲染"空白剧本"空态
- Actual: 空态渲染，用户会误以为剧本丢失
- Evidence: docs/qa/screenshots/t04_after_confirm_empty.png
- Root Cause: `GET /api/v2/episodes/:id/script` 确认后返回 `draft:null, approved:{revision:1}`（设计如此——草稿升为已批准版本），前端 ScriptStage 仅按"有无草稿"判断空态，未消费 approved 内容
- Fix: ScriptStage 增加"无草稿但有已批准版本"分支：编辑器只读展示已确认正文 + 提示条 + 「以此版本新建草稿」按钮 + 主 CTA 变「进入设定」
- Status: OPEN

### 观察项（非用户可见 Bug）
- QA-OBS-001：Playwright locator 点击在该应用上系统性超时（hit-test 通过、无遮挡、无动画），改用坐标点击完成全部测试。真实鼠标操作不受影响，疑似 IAB 工具层 actionability 判定问题。
- QA-OBS-002：制作头显示"第 1 集 · 第 1 集"（集号与标题同为"第 1 集"造成重复观感）；新建项目页 CTA 文案随来源切换正确。
