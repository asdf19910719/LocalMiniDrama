# Wave 1 结果报告（AICONF / TASK / SHELL + 既有套件全量回归）

run_id: run_20260912_072912 · L3 · Wave 1/4 · 执行时间 2026-09-12 08:00–08:06 (UTC+8 换算自记录时间戳) · 分支 codex/v2-1-implementation
执行脚本: `qa/scripts/wave1/`（run-shell.js / run-aiconf.js / run-task.js / run-regr.js，共享 lib.js）
逐条证据: `qa/run/execution-log.jsonl`（54 条原始记录，同 case 取最后一条为最终态）+ `qa/run/wave1-logs/TC-*.log`

---

## 1. 既有测试套件全量回归（真实执行）

| 套件 | 命令 | 总数 | 通过 | 失败 | 跳过 | 耗时 | 日志 |
|---|---|---|---|---|---|---|---|
| 后端 | `E:/AI/tools/node-v22.22.3-win-x64/node.exe --test test/*.test.js`（175 个文件） | 1156 | 1156 | 0 | 0 | 10.8s | qa/run/wave1-backend-suite.log |
| 前端 | `node --test test/*.test.js`（48 个文件） | 366 | 366 | 0 | 0 | 4.6s | qa/run/wave1-frontend-suite.log |

合计 1522/1522 全通过，无失败项摘要需要。

## 2. 用例设计清单（40 条，YAML 于 qa/cases/<模块码>/）

需求条款引用约定：`INV-<节>.<行>` = docs/current/feature-inventory.md 对应功能行；`ARCH-9.3` = architecture.md §9.3；`BUG-QA-00x` = docs/qa/bug-report.md。

### AICONF（18 条）
| ID | 标题 | 优先级 | 需求 |
|---|---|---|---|
| TC-AICONF-001 | GET /ai-configs 列表契约与默认 DeepSeek 配置存在 | P0 | INV-11.1 |
| TC-AICONF-002 | 创建 QA-L3 文本配置 201 + 回读一致 | P0 | INV-11.1 |
| TC-AICONF-003 | 更新配置后回读新值 | P0 | INV-11.1 |
| TC-AICONF-004 | 删除配置后再查 404 | P0 | INV-11.1 |
| TC-AICONF-005 | 创建缺必填字段 400 | P1 | INV-11.1 |
| TC-AICONF-006 | GET 不存在配置 404 | P1 | INV-11.1 |
| TC-AICONF-007 | service_type=text 过滤 | P1 | INV-11.1 |
| TC-AICONF-008 | 配置测试接口对 DeepSeek 真实调用成功（本模块唯一 1 次真实调用） | P0 | INV-11.2 |
| TC-AICONF-009 | 测试连接缺 api_key 400 | P1 | INV-11.2 |
| TC-AICONF-010 | 测试连接不可达地址真实失败路径 | P1 | INV-11.2 |
| TC-AICONF-011 | 一键预设（Agnes）等价创建 4 类配置并可见后清理 | P1 | INV-11.4 |
| TC-AICONF-012 | 场景模型映射 CRUD 闭环 + 重复 key 400 | P1 | INV-11.6 |
| TC-AICONF-013 | 提示词覆盖 list/update/reset 闭环（10 组定义） | P1 | INV-11.7 |
| TC-AICONF-014 | 提示词未知 key/空 content 400 | P1 | INV-11.7 |
| TC-AICONF-015 | 全局生成设置越界 400/写读一致/恢复 | P0 | INV-11.8 |
| TC-AICONF-016 | 语言非法值 400 且不改当前值 | P2 | INV-11.8 |
| TC-AICONF-017 | vendor-lock 可读 + 非锁定模式 bulk-update-key 400 | P1 | INV-11.9 |
| TC-AICONF-018 | 明文 api_key 暴露与导出脱敏缺失复核 | P0 | INV-11.3, ARCH-9.3 |

### TASK（13 条）
| ID | 标题 | 优先级 | 需求 |
|---|---|---|---|
| TC-TASK-001 | GET 不存在任务 404 | P1 | INV-14.1 |
| TC-TASK-002 | GET /tasks 缺 resource_id 400 | P1 | INV-14.1 |
| TC-TASK-003 | 真实故事生成任务状态机 pending→processing→completed + 产出写回项目 | P0 | INV-14.1/14.4 |
| TC-TASK-004 | 任务详情字段契约完整 | P0 | INV-14.1 |
| TC-TASK-005 | 按资源查询任务列表一致 | P1 | INV-14.1 |
| TC-TASK-006 | 同资源进行中任务去重返回相同 task_id | P0 | INV-14.1 |
| TC-TASK-007 | 取消已完成任务幂等 already_done=true | P1 | INV-14.2 |
| TC-TASK-008 | 取消不存在任务 404 | P1 | INV-14.2 |
| TC-TASK-009 | 运行中取消：标 failed 但不能中止外部调用（PARTIAL 语义实证） | P0 | INV-14.2 |
| TC-TASK-010 | 不存在项目发起生成 400 | P1 | INV-14.1 |
| TC-TASK-011 | 重启恢复语义核验（源码+DB 只读，遵守禁重启约束） | P1 | INV-14.3 |
| TC-TASK-012 | 前端任务去重与续接源码核验（taskKey/pollPromises/attach） | P2 | INV-14.8 |
| TC-TASK-013 | 缺 premise：入口 200 建任务、后台失败落库（无外部调用） | P1 | INV-14.1 |

### SHELL（6 条）
| ID | 标题 | 优先级 | 需求 |
|---|---|---|---|
| TC-SHELL-001 | 3013 全部 10 条顶级路由 200 + index.html | P0 | INV-1.1 |
| TC-SHELL-002 | 路由表 21 条与视图文件一致 + 覆盖 test-map P01–P23 | P0 | INV-1.1/1.2 |
| TC-SHELL-003 | 未知路径 SPA 回退 200 + 前端 catch-all 渲染 404 | P1 | INV-1.1 |
| TC-SHELL-004 | /api 未知路径 404 JSON 不回退 HTML（v1/v2 一致） | P1 | INV-1.1 |
| TC-SHELL-005 | /static 资源 3013 代理与 5679 直连字节一致 | P1 | INV-1.2 |
| TC-SHELL-006 | /health 健康检查契约 | P2 | INV-1.1 |

### 已知已修 P1 不回归核验（3 条）
| ID | 标题 | 优先级 | 需求 |
|---|---|---|---|
| TC-SCRIPT-901 | QA-002 不回归：draft=null 时 script 接口返回 approved 正文（305 字） | P1 | BUG-QA-002 |
| TC-ASSET-902 | QA-003 不回归：项目素材 API 返回已有数据（林夏） | P1 | BUG-QA-003 |
| TC-PROJ-903 | QA-004 不回归：归档列表 API 真实返回软删剧集（deletedAt 保留） | P1 | BUG-QA-004 |

## 3. 执行统计（最终态，同 case 取最后一条日志）

| 模块 | 用例 | 通过 | 失败 | blocked |
|---|---|---|---|---|
| SHELL | 6 | 6 | 0 | 0 |
| AICONF | 18 | 18 | 0 | 0 |
| TASK | 13 | 12 | 1 | 0 |
| 不回归（SCRIPT/ASSET/PROJ） | 3 | 3 | 0 | 0 |
| **合计** | **40** | **39** | **1** | **0** |

- 通过率 39/40 = 97.5%；无 P0 失败；唯一失败为 P1 契约缺陷（见 §4）。
- blocked：无。
- 真实调用成本：DeepSeek 共 3 次 —— AICONF 流 1 次（TC-008 连接测试成功 2021ms）；TASK 流 2 次（TC-003 正常完成 15.3s + TC-009 取消后仍在后台完成）。每功能流 ≤2 次预算合规。ComfyUI 0 次（本 wave 无视频用例）。

## 4. 失败与缺陷清单

### BUG-L3-101（P1，安全）— AI 配置明文 api_key 暴露 + 前端导出不脱敏
- 用例 TC-AICONF-018（该用例按"确认问题是否仍存在"设计，确认成立故记 passed，缺陷另立）。
- 实证：GET /api/v1/ai-configs 返回 35 字符完整明文 key；AIConfigContent.vue:2424 exportConfigs 仅剔除 id/created_at/updated_at，api_key 随 rest 写出导出文件。
- 结论：feature-inventory §11.3 PARTIAL"导出包含明文 API Key，安全边界不合格"在当前源码仍成立。详见 qa/bugs/BUG-L3-101.yml。

### BUG-L3-102（P3，契约）— 取消终态任务响应丢失 already_done 标志（TC-TASK-007 失败根因）
- taskService.cancelTask 对终态任务返回 `{ok, already_done:true, task}`，但 routes/task.js:33 `response.success(res, result.task || ...)` 只透传 task，客户端拿不到幂等标志。状态本身未被破坏（completed 保持）。
- 详见 qa/bugs/BUG-L3-102.yml。

### 重要观察（不判缺陷，需求已声明该边界）
- **取消语义实证（TC-TASK-009）**：任务在取消后 14 秒被后台完成的 DeepSeek 调用覆盖为 completed（error 字段仍是"QA-L3 用户取消原因"，completed_at=00:04:38.725Z，剧集《深夜伞与电池》写入项目 12）。与 feature-inventory §14.2"可将记录标记失败，不能中止已经运行的外部调用"一致；但"已取消记录最终显示为 completed"对用户有误导性，建议后续版本在保存结果前检查任务是否已被取消。
- 重启恢复（TC-TASK-011）：源码 taskService.js:98 启动清扫存在并接入 app.js；当前 DB 无 pending/processing 遗留、历史孤儿标记 0 条。受"禁止重启服务"约束未做重启实验。

## 5. 过程透明记录：测试副作用事故与修复

- 第一次 TASK 运行时故事生成全部 `connect ECONNREFUSED 127.0.0.1:18080` 失败。根因是**本 wave 测试脚本自身**：TC-AICONF-011 以 `is_default:true` 创建 Agnes 等价文本配置触发后端 clearOtherDefault 清掉 DeepSeek(id=4) 默认标志，清理删除该配置后文本类型无默认配置，任务按 `is_default DESC, priority DESC` 选中 priority=100 的离线 Local Shim Text(id=1)。
- 修复：PUT /ai-configs/4 `{is_default:true}` 恢复（已验证生效），并在 run-aiconf.js TC-011 清理段补默认标志恢复，防止复跑再破坏。
- 第一次运行产生的过程数据（任务 a2688586/dac33c57 等，error=ECONNREFUSED）保留于 DB 供复核；由此浪费的 DeepSeek 成本为 0（请求未到达 DeepSeek）。
- 环境最终态：DeepSeek 为唯一 text 默认配置；本 wave 创建的 AI 配置/场景映射/提示词覆盖均已经 API 删除或还原；QA-L3 项目 11/12、剧集 14、归档剧集 15 按约定保留供复核。

## 6. 完成标准核对

- [x] 套件回归统计（后端 1156 + 前端 366 全过）
- [x] 用例设计清单（40 条：AICONF 18 / TASK 13 / SHELL 6 / 不回归 3）
- [x] 执行统计（39 过 / 1 失败 / 0 blocked）
- [x] 失败与缺陷清单（BUG-L3-101、BUG-L3-102）
- [x] blocked 项及理由（无）
- [x] 逐条 execution-log.jsonl + 证据文件 wave1-logs/
