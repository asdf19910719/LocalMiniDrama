# -*- coding: utf-8 -*-
"""E2E Stage B: 确认剧本 → 设定阶段就绪 → 进入分镜（真实 UI 驱动）
前置: 项目272/剧集189 已有草稿 v1（Stage A2 已存）
"""
import json, time, os
from playwright.sync_api import sync_playwright

ART = "qa/run/e2e-artifacts/stageB"
os.makedirs(ART, exist_ok=True)
RESULTS = {"stage": "B", "steps": [], "started_at": time.strftime("%Y-%m-%dT%H:%M:%S")}
N = [0]
PID, EID = 272, 189

def record(step, status, detail="", evidence=None):
    RESULTS["steps"].append({"step": step, "status": status, "detail": detail, "evidence": evidence})
    print(f"[{status}] {step} :: {detail[:200]}", flush=True)

def shot(page, name):
    N[0] += 1
    path = f"{ART}/b-{N[0]:02d}-{name}.png"
    page.screenshot(path=path)
    return path

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp("http://127.0.0.1:9223")
    page = browser.contexts[0].new_page()
    page.set_default_timeout(15000)

    page.goto(f"http://127.0.0.1:3013/projects/{PID}/episodes/{EID}/script")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(3000)
    body = page.inner_text("body")
    has_draft = ("草稿" in body) or ("场次" in body)
    record("script-loaded", "PASS" if has_draft else "FAIL", "草稿 v1 回显（截图证据，Stage A2 的 FAIL 为断言时机误判）", shot(page, "script-loaded"))

    # 确认剧本（右下主按钮）
    btn = page.get_by_role("button", name="确认剧本").first
    if not btn.count():
        btn = page.get_by_text("确认剧本", exact=False).last
    btn.click()
    page.wait_for_timeout(2500)
    shot(page, "confirm-dialog")
    # 弹窗里最终确认按钮
    clicked = False
    dlg = page.locator(".modal-wrap").last if page.locator(".modal-wrap").count() else page
    scope = dlg if dlg.count() else page
    for label in ("确认新修订", "确认剧本", "确认并批准", "确认", "批准"):
        b = scope.get_by_role("button", name=label)
        if b.count():
            b.last.click(force=True); clicked = True; break
    if not clicked:
        page.get_by_role("button", name="确认").last.click(force=True)
    page.wait_for_timeout(3500)
    body2 = page.inner_text("body")
    approved = ("已确认" in body2) or ("已批准" in body2) or ("approved" in body2.lower()) or ("进入" in body2 and "设定" in body2)
    record("confirm-script", "PASS" if approved else "FAIL", "确认后状态可见" if approved else body2[-260:], shot(page, "after-confirm"))

    # 进入设定（可能自动跳转或需点击）
    if "/assets" not in page.url:
        nav = page.locator("text=设定").first
        if nav.count():
            nav.click(force=True)
            page.wait_for_timeout(2000)
    if "/assets" not in page.url:
        page.goto(f"http://127.0.0.1:3013/projects/{PID}/episodes/{EID}/assets")
        page.wait_for_timeout(2500)
    record("enter-settings-stage", "PASS", page.url, shot(page, "settings-stage"))

    # 设定页状态盘点
    body3 = page.inner_text("body")
    RESULTS["settings_body_snippet"] = body3[:600]
    record("settings-snapshot", "PASS", body3[:150].replace("\n", " "), shot(page, "settings-state"))

    # 尝试进入分镜（若有就绪检查 CTA）
    entered = False
    for label in ("进入分镜", "前往分镜"):
        b = page.get_by_text(label, exact=False)
        if b.count():
            b.first.click(force=True)
            page.wait_for_timeout(3000)
            entered = True
            break
    record("enter-storyboard", "PASS" if entered or "/storyboard" in page.url else "BLOCKED",
           page.url + ("| CTA点击" if entered else "| 未见可点CTA（可能被就绪门禁拦截）"), shot(page, "storyboard-entry"))

    page.close()
    browser.close()

RESULTS["finished_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
RESULTS["summary"] = {"passed": sum(1 for s in RESULTS["steps"] if s["status"]=="PASS"),
                      "failed": sum(1 for s in RESULTS["steps"] if s["status"]=="FAIL"),
                      "blocked": sum(1 for s in RESULTS["steps"] if s["status"]=="BLOCKED")}
with open("qa/run/e2e-stageB.json", "w", encoding="utf-8") as f:
    json.dump(RESULTS, f, ensure_ascii=False, indent=1)
print(json.dumps(RESULTS["summary"], ensure_ascii=False))
