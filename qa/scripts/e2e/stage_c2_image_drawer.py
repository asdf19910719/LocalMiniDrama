# -*- coding: utf-8 -*-
"""E2E Stage C2: 分镜图生成抽屉 → ChatGPT 网页通道 → 真实提交"""
import json, time, os
from playwright.sync_api import sync_playwright

ART = "qa/run/e2e-artifacts/stageC"
os.makedirs(ART, exist_ok=True)
RESULTS = {"stage": "C2", "steps": [], "started_at": time.strftime("%Y-%m-%dT%H:%M:%S")}
N = [0]
PID, EID = 272, 189

def record(step, status, detail="", evidence=None):
    RESULTS["steps"].append({"step": step, "status": status, "detail": detail, "evidence": evidence})
    print(f"[{status}] {step} :: {detail[:220]}", flush=True)

def shot(page, name):
    N[0] += 1
    path = f"{ART}/c2-{N[0]:02d}-{name}.png"
    page.screenshot(path=path)
    return path

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp("http://127.0.0.1:9223")
    page = browser.contexts[0].new_page()
    page.set_default_timeout(15000)
    page.goto(f"http://127.0.0.1:3013/projects/{PID}/episodes/{EID}/storyboard")
    page.wait_for_timeout(3500)

    # 打开生成分镜图抽屉
    btn = page.get_by_text("生成分镜图", exact=False).first
    btn.click(force=True)
    page.wait_for_timeout(2500)
    shot(page, "image-drawer")
    body = page.inner_text("body")
    # 抽取抽屉文本片段
    for key in ("ChatGPT", "通道", "提示词", "生成"):
        if key in body:
            i = body.find(key)
            RESULTS.setdefault("drawer_snippets", {})[key] = body[max(0,i-60):i+160].replace("\n", " ")
    record("open-image-drawer", "PASS", json.dumps(RESULTS.get("drawer_snippets", {}), ensure_ascii=False)[:300])

    # 切换通道到 ChatGPT 生成（下拉项 command=chatgpt_web）
    used_dropdown = False
    split = page.get_by_text("默认模型生成", exact=False)
    if split.count():
        split.first.click(force=True)
        page.wait_for_timeout(1200)
        item = page.get_by_text("ChatGPT 生成", exact=False).last
        if item.count():
            item.click(force=True)
            used_dropdown = True
            page.wait_for_timeout(1500)
    record("switch-channel-chatgpt", "PASS" if used_dropdown else "WARN", f"dropdown_used={used_dropdown}", shot(page, "channel-chatgpt"))

    # 找提交按钮（抽屉内：开始生成/生成/提交）
    dlg_sel = ".modal-wrap, [role='dialog'], .el-drawer, .el-overlay"
    scope = page
    for sel in (".modal-wrap", "[role='dialog']", ".el-drawer", ".el-overlay"):
        if page.locator(sel).count():
            scope = page.locator(sel).last
            break
    submitted = False
    for label in ("开始生成", "生成", "提交", "确认生成"):
        b = scope.get_by_role("button", name=label)
        if b.count():
            shot(page, "before-submit")
            b.last.click(force=True)
            submitted = True
            record("submit-generation", "PASS", f"button={label}")
            break
    if not submitted:
        record("submit-generation", "FAIL", "未找到提交按钮", shot(page, "no-submit"))
    page.wait_for_timeout(4000)
    shot(page, "after-submit")
    body2 = page.inner_text("body")
    for key in ("环境检查", "等待", "任务", "ChatGPT", "失败", "错误"):
        if key in body2:
            i = body2.find(key)
            RESULTS.setdefault("post_submit", {})[key] = body2[max(0,i-50):i+150].replace("\n", " ")
    record("post-submit-state", "PASS", json.dumps(RESULTS.get("post_submit", {}), ensure_ascii=False)[:300])

    page.close()
    browser.close()

RESULTS["finished_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
RESULTS["summary"] = {"passed": sum(1 for s in RESULTS["steps"] if s["status"]=="PASS"),
                      "failed": sum(1 for s in RESULTS["steps"] if s["status"]=="FAIL"),
                      "warn": sum(1 for s in RESULTS["steps"] if s["status"]=="WARN")}
with open("qa/run/e2e-stageC2.json", "w", encoding="utf-8") as f:
    json.dump(RESULTS, f, ensure_ascii=False, indent=1)
print(json.dumps(RESULTS["summary"], ensure_ascii=False))
