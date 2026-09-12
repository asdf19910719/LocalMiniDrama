# -*- coding: utf-8 -*-
"""E2E Stage D2: 稳定后端上的 H3 UI 编译 + 视频提交守卫取证（BUG-401）"""
import json, time, os
from playwright.sync_api import sync_playwright

ART = "qa/run/e2e-artifacts/stageD"
RESULTS = {"stage": "D2", "steps": [], "started_at": time.strftime("%Y-%m-%dT%H:%M:%S")}
N = [0]
PID, EID = 272, 189

def record(step, status, detail="", evidence=None):
    RESULTS["steps"].append({"step": step, "status": status, "detail": str(detail)[:400], "evidence": evidence})
    print(f"[{status}] {step} :: {str(detail)[:220]}", flush=True)

def shot(page, name):
    N[0] += 1
    path = f"{ART}/d2-{N[0]:02d}-{name}.png"
    page.screenshot(path=path)
    return path

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp("http://127.0.0.1:9223")
    page = browser.contexts[0].new_page()
    page.set_default_timeout(20000)
    page.goto(f"http://127.0.0.1:3013/projects/{PID}/episodes/{EID}/storyboard")
    page.wait_for_timeout(4000)

    # D2-1: UI 生成 H3 提示词
    btn = page.get_by_text("生成 H3 提示词", exact=False).first
    btn.click(force=True)
    status_seen = ""
    for i in range(30):
        page.wait_for_timeout(5000)
        body = page.inner_text("body")
        if "生成中" in body or "编译中" in body:
            status_seen = "generating"; continue
        for chip in ("有效", "valid", "无效", "invalid", "失败", "需要更新", "已生成"):
            if chip in body:
                status_seen = chip
                break
        if status_seen and status_seen != "generating":
            break
    record("h3-ui-generate", "PASS" if status_seen in ("有效", "valid", "已生成") else "WARN",
           f"状态={status_seen}", shot(page, "h3-ui"))

    # D2-2: 视频提交（守卫行为）
    vbtn = page.get_by_text("用 H3 生成视频", exact=False).first
    disabled = vbtn.is_disabled() if vbtn.count() else None
    record("video-button-state", "INFO", f"disabled={disabled}")
    vbtn.click(force=True)
    page.wait_for_timeout(3500)
    shot(page, "video-click-1")
    body = page.inner_text("body")
    snip = {}
    for key in ("联合检查", "守卫", "阻塞", "通道", "模型", "费用", "确认", "不支持", "H3"):
        if key in body:
            i = body.find(key)
            snip[key] = body[max(0, i-70):i+170].replace("\n", " ")
    record("video-modal-content", "PASS", json.dumps(snip, ensure_ascii=False)[:350])

    # 提交（抽屉/弹窗内确认按钮）
    scope_sel = None
    for sel in (".modal-wrap", "[role='dialog']", ".el-drawer", "aside.drawer"):
        if page.locator(sel).count():
            scope_sel = sel
            break
    scope = page.locator(scope_sel).last if scope_sel else page
    clicked = None
    for label in ("确认提交", "开始生成", "确认生成", "生成视频", "提交", "确认"):
        b = scope.get_by_role("button", name=label)
        if b.count():
            clicked = label
            b.last.click(force=True)
            break
    record("video-submit-click", "PASS" if clicked else "FAIL", f"clicked={clicked or 'none'}", shot(page, "video-submit"))
    page.wait_for_timeout(5000)
    body2 = page.inner_text("body")
    for key in ("失败", "错误", "排队", "处理中", "运行", "任务", "阻塞", "需要"):
        if key in body2:
            i = body2.find(key)
            RESULTS.setdefault("post_submit", {})[key] = body2[max(0, i-60):i+140].replace("\n", " ")
    record("video-post-submit", "PASS", json.dumps(RESULTS.get("post_submit", {}), ensure_ascii=False)[:350], shot(page, "video-after"))

    page.close()
    browser.close()

RESULTS["finished_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
RESULTS["summary"] = {"passed": sum(1 for s in RESULTS["steps"] if s["status"]=="PASS"),
                      "failed": sum(1 for s in RESULTS["steps"] if s["status"]=="FAIL"),
                      "warn": sum(1 for s in RESULTS["steps"] if s["status"]=="WARN")}
with open("qa/run/e2e-stageD2.json", "w", encoding="utf-8") as f:
    json.dump(RESULTS, f, ensure_ascii=False, indent=1)
print(json.dumps(RESULTS["summary"], ensure_ascii=False))
