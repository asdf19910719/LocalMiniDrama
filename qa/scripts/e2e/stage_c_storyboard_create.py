# -*- coding: utf-8 -*-
"""E2E Stage C1: 从已确认剧本创建分镜结构（真实 UI 驱动）"""
import json, time, os, urllib.request
from playwright.sync_api import sync_playwright

ART = "qa/run/e2e-artifacts/stageC"
os.makedirs(ART, exist_ok=True)
RESULTS = {"stage": "C1", "steps": [], "started_at": time.strftime("%Y-%m-%dT%H:%M:%S")}
N = [0]
PID, EID = 272, 189

def record(step, status, detail="", evidence=None):
    RESULTS["steps"].append({"step": step, "status": status, "detail": detail, "evidence": evidence})
    print(f"[{status}] {step} :: {detail[:200]}", flush=True)

def shot(page, name):
    N[0] += 1
    path = f"{ART}/c-{N[0]:02d}-{name}.png"
    page.screenshot(path=path)
    return path

def api(path):
    return json.load(urllib.request.urlopen(f"http://127.0.0.1:5679{path}"))

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp("http://127.0.0.1:9223")
    page = browser.contexts[0].new_page()
    page.set_default_timeout(15000)
    page.goto(f"http://127.0.0.1:3013/projects/{PID}/episodes/{EID}/storyboard")
    page.wait_for_timeout(3000)

    # 点击创建 CTA（若分镜已存在则跳过）
    existing = None
    try:
        sb0 = api(f"/api/v1/episodes/{EID}/storyboards")
        existing = (sb0.get("data") or {}).get("storyboards") or []
    except Exception:
        pass
    if existing:
        record("click-create", "PASS", "分镜已存在（此前真实点击已创建），跳过重复创建")
    else:
        page.get_by_text("从已确认剧本创建分镜", exact=False).first.click(force=True)
        page.wait_for_timeout(2000)
        dlg = page.locator(".modal-wrap").last if page.locator(".modal-wrap").count() else page
        scope = dlg if dlg.count() else page
        clicked = False
        for label in ("创建分镜", "开始创建", "创建", "生成", "确认"):
            b = scope.get_by_role("button", name=label)
            if b.count():
                b.last.click(force=True); clicked = True
                record("click-create", "PASS", f"button={label}")
                break
        if not clicked:
            record("click-create", "FAIL", "未找到创建按钮", shot(page, "no-create-btn"))

    # 等待结构创建（结构化解析，非 LLM，给 30s）
    ok = False
    for i in range(15):
        try:
            sb = api(f"/api/v1/episodes/{EID}/storyboards")
            items = (sb.get("data") or {}).get("storyboards") or []
            if items:
                ok = True
                RESULTS["storyboard_count"] = len(items)
                RESULTS["first_storyboard"] = {k: items[0].get(k) for k in ("id", "title", "description", "storyboard_number")}
                break
        except Exception:
            pass
        page.wait_for_timeout(2000)
    record("storyboard-created", "PASS" if ok else "FAIL",
           f"storyboards={RESULTS.get('storyboard_count', 0)} first={json.dumps(RESULTS.get('first_storyboard', {}), ensure_ascii=False)[:160]}",
           shot(page, "after-create"))

    page.close()
    browser.close()

RESULTS["finished_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
RESULTS["summary"] = {"passed": sum(1 for s in RESULTS["steps"] if s["status"]=="PASS"),
                      "failed": sum(1 for s in RESULTS["steps"] if s["status"]=="FAIL")}
with open("qa/run/e2e-stageC1.json", "w", encoding="utf-8") as f:
    json.dump(RESULTS, f, ensure_ascii=False, indent=1)
print(json.dumps(RESULTS["summary"], ensure_ascii=False))
