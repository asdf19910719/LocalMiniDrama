# -*- coding: utf-8 -*-
"""E2E Stage A2: 剧本编辑→自动保存→刷新持久化→确认剧本（基于已存在的 QA-L3-E2E 项目）"""
import json, time, os, urllib.request
from playwright.sync_api import sync_playwright

ART = "qa/run/e2e-artifacts/stageA"
os.makedirs(ART, exist_ok=True)
RESULTS = {"stage": "A2", "steps": [], "started_at": time.strftime("%Y-%m-%dT%H:%M:%S")}
N = [0]

def record(step, status, detail="", evidence=None):
    RESULTS["steps"].append({"step": step, "status": status, "detail": detail, "evidence": evidence})
    print(f"[{status}] {step} :: {detail[:160]}")

def shot(page, name):
    N[0] += 1
    path = f"{ART}/a2-{N[0]:02d}-{name}.png"
    page.screenshot(path=path)
    return path

# 定位 QA-L3 项目与第 1 集
dramas = json.load(urllib.request.urlopen("http://127.0.0.1:5679/api/v1/dramas"))
items = (dramas.get("data") or {}).get("items") or []
pid = eid = None
for d in items:
    if str(d.get("title", "")).startswith("QA-L3-E2E-主链"):
        pid = d.get("id")
        eitems = d.get("episodes") or []
        if eitems:
            eid = eitems[0].get("id")
        break
assert pid, "QA-L3-E2E 项目不存在"
if not eid:
    eps = json.load(urllib.request.urlopen(f"http://127.0.0.1:5679/api/v1/dramas/{pid}/episodes"))
    eitems = (eps.get("data") or {}).get("items") or eps.get("data") or []
    if eitems:
        eid = eitems[0].get("id")
print(f"project={pid} episode={eid} ep_count={len(eitems)}")
RESULTS["project_id"] = pid
RESULTS["episode_id"] = eid

SCRIPT_TEXT = (
    "第一场 夜 古镇街道\n"
    "雨夜，青石板路反着冷光。林晚撑伞快步走过，伞沿滴水发亮。\n"
    "林晚（低声）：还有三条街。\n"
    "\n"
    "第二场 夜 旧书店\n"
    "灯泡在头顶轻晃。林晚推门，风铃骤响。柜台后老人抬眼。\n"
    "老人：你终于来了。\n"
    "林晚：书还在吗？\n"
    "老人（从抽屉取出一册蓝布书）：三百年了，它一直在等。\n"
)

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp("http://127.0.0.1:9223")
    ctx = browser.contexts[0]
    page = ctx.new_page()
    page.set_default_timeout(15000)

    url = f"http://127.0.0.1:3013/projects/{pid}/episodes/{eid}/script" if eid else f"http://127.0.0.1:3013/projects/{pid}"
    page.goto(url)
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(1500)
    record("open-script-stage", "PASS", page.url, shot(page, "open"))

    # 起点卡：直接开始写（若编辑器已存在则跳过）
    if not page.locator("textarea").count():
        card = page.locator(".start-card", has_text="直接开始写").first
        if not card.count():
            card = page.get_by_text("直接开始写", exact=False).first
        card.click(force=True)
        page.wait_for_timeout(1500)
    record("open-blank-editor", "PASS" if page.locator("textarea").count() else "FAIL",
           f"textarea={page.locator('textarea').count()}", shot(page, "editor"))

    # 填写正文
    editor = page.locator("textarea").first
    editor.fill(SCRIPT_TEXT)
    record("fill-script", "PASS", f"len={len(SCRIPT_TEXT)}", shot(page, "filled"))

    # 自动保存指示（页头有"更改会自动保存"）
    page.wait_for_timeout(3500)
    body = page.inner_text("body")
    record("autosave-wait", "PASS", "已等待自动保存窗口", shot(page, "autosave"))

    # 刷新持久化
    page.reload()
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(2500)
    body2 = page.inner_text("body")
    kept = ("雨夜" in body2) or ("青石板" in body2)
    record("refresh-persistence", "PASS" if kept else "FAIL",
           "刷新后正文保留" if kept else "刷新后正文丢失", shot(page, "refreshed"))

    # 确认剧本
    clicked = False
    for label in ("检查并确认", "确认剧本"):
        b = page.get_by_text(label, exact=False)
        if b.count():
            b.first.click(); clicked = True; break
    page.wait_for_timeout(2000)
    shot(page, "confirm-dialog")
    if clicked:
        dlg_sel = "[role='dialog'], .el-dialog, .el-drawer"
        scope = page.locator(dlg_sel).last if page.locator(dlg_sel).count() else page
        for label in ("确认剧本", "确认", "批准", "确定"):
            b = scope.get_by_role("button", name=label)
            if b.count():
                b.last.click(); break
        page.wait_for_timeout(3500)
    body3 = page.inner_text("body")
    approved = ("已确认" in body3) or ("已批准" in body3) or ("进入设定" in body3) or ("approved" in body3.lower())
    record("confirm-script", "PASS" if approved else "FAIL", "确认态可见" if approved else "未见确认态:"+body3[-260:], shot(page, "confirmed"))

    page.close()
    browser.close()

RESULTS["finished_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
RESULTS["summary"] = {"passed": sum(1 for s in RESULTS["steps"] if s["status"]=="PASS"),
                      "failed": sum(1 for s in RESULTS["steps"] if s["status"]=="FAIL")}
with open("qa/run/e2e-stageA2.json", "w", encoding="utf-8") as f:
    json.dump(RESULTS, f, ensure_ascii=False, indent=1)
print(json.dumps(RESULTS["summary"], ensure_ascii=False))
