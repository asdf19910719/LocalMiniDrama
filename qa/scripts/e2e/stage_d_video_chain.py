# -*- coding: utf-8 -*-
"""E2E Stage D: H3 提示词编译（真实 DeepSeek）→ 视频提交守卫行为（BUG-401 取证）→ 成片门禁"""
import json, time, os, urllib.request
from playwright.sync_api import sync_playwright

ART = "qa/run/e2e-artifacts/stageD"
os.makedirs(ART, exist_ok=True)
RESULTS = {"stage": "D", "steps": [], "started_at": time.strftime("%Y-%m-%dT%H:%M:%S")}
N = [0]
PID, EID = 272, 189

def record(step, status, detail="", evidence=None):
    RESULTS["steps"].append({"step": step, "status": status, "detail": str(detail)[:300], "evidence": evidence})
    print(f"[{status}] {step} :: {str(detail)[:220]}", flush=True)

def shot(page, name):
    N[0] += 1
    path = f"{ART}/d-{N[0]:02d}-{name}.png"
    page.screenshot(path=path)
    return path

def api(path, method="GET", body=None):
    req = urllib.request.Request(f"http://127.0.0.1:5679{path}", method=method,
                                 data=json.dumps(body).encode() if body else None,
                                 headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req))

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp("http://127.0.0.1:9223")
    page = browser.contexts[0].new_page()
    page.set_default_timeout(20000)
    page.goto(f"http://127.0.0.1:3013/projects/{PID}/episodes/{EID}/storyboard")
    page.wait_for_timeout(3500)

    # D1: 生成 H3 提示词（真实 DeepSeek 编译）
    btn = page.get_by_text("生成 H3 提示词", exact=False).first
    if btn.count():
        btn.click(force=True)
        record("h3-generate-click", "PASS", "已点击生成 H3 提示词")
        # 轮询状态芯片（编译走真实 LLM，最长 120s）
        status_seen = ""
        for i in range(24):
            page.wait_for_timeout(5000)
            body = page.inner_text("body")
            for chip in ("生成中", "valid", "有效", "invalid", "无效", "需要更新", "已保存", "失败"):
                if chip in body:
                    status_seen = chip
            if any(c in status_seen for c in ("valid", "有效", "invalid", "无效", "失败")) and "生成中" not in status_seen:
                break
        record("h3-generate-result", "PASS" if status_seen in ("valid", "有效", "已保存") else "WARN",
               f"状态={status_seen}", shot(page, "h3-result"))
    else:
        record("h3-generate-click", "FAIL", "未找到生成 H3 提示词按钮", shot(page, "no-h3-btn"))

    # D2: 视频提交守卫行为（BUG-401 取证）
    vbtn = page.get_by_text("用 H3 生成视频", exact=False).first
    guard_text = ""
    if vbtn.count():
        shot(page, "before-video-submit")
        vbtn.click(force=True)
        page.wait_for_timeout(4000)
        shot(page, "video-after-click")
        body = page.inner_text("body")
        for key in ("联合检查", "守卫", "阻塞", "H3", "确认", "费用", "通道", "禁用", "不支持"):
            if key in body:
                i = body.find(key)
                RESULTS.setdefault("guard_snippets", {})[key] = body[max(0, i-60):i+160].replace("\n", " ")
        guard_text = json.dumps(RESULTS.get("guard_snippets", {}), ensure_ascii=False)
        record("video-submit-attempt", "PASS", guard_text[:280])
        # 若有确认抽屉则继续点确认（真实提交）
        scope = page.locator(".modal-wrap").last if page.locator(".modal-wrap").count() else page
        for label in ("确认提交", "提交", "开始生成", "确认生成", "确认"):
            b = scope.get_by_role("button", name=label)
            if b.count():
                b.last.click(force=True)
                record("video-submit-confirm", "PASS", f"button={label}", shot(page, "video-submitted"))
                break
        else:
            record("video-submit-confirm", "WARN", "无确认按钮（可能被守卫拦截）", shot(page, "video-guard-block"))
    else:
        record("video-submit-attempt", "FAIL", "未找到用 H3 生成视频按钮", shot(page, "no-video-btn"))

    # D3: 后端真相——视频任务与守卫状态
    try:
        guard = api(f"/api/v1/episodes/{EID}/storyboards/156/video/guard")
        RESULTS["api_video_guard"] = guard.get("data") or guard
        record("api-video-guard", "PASS", json.dumps(RESULTS["api_video_guard"], ensure_ascii=False)[:280])
    except Exception as e:
        record("api-video-guard", "FAIL", str(e)[:150])
    try:
        st = api(f"/api/v1/video-tasks/status?drama_id={PID}")
        RESULTS["video_tasks"] = (st.get("data") or st)
        record("api-video-tasks", "PASS", json.dumps(RESULTS["video_tasks"], ensure_ascii=False)[:280])
    except Exception as e:
        record("api-video-tasks", "WARN", str(e)[:150])

    # D4: 成片门禁（0/2 采用态）
    page.goto(f"http://127.0.0.1:3013/projects/{PID}/episodes/{EID}/cut")
    page.wait_for_timeout(3500)
    shot(page, "cut-stage")
    body = page.inner_text("body")
    RESULTS["cut_body"] = body[:500]
    record("cut-gate-state", "PASS", body[:180].replace("\n", " "))

    page.close()
    browser.close()

RESULTS["finished_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
RESULTS["summary"] = {"passed": sum(1 for s in RESULTS["steps"] if s["status"]=="PASS"),
                      "failed": sum(1 for s in RESULTS["steps"] if s["status"]=="FAIL"),
                      "warn": sum(1 for s in RESULTS["steps"] if s["status"]=="WARN")}
with open("qa/run/e2e-stageD.json", "w", encoding="utf-8") as f:
    json.dump(RESULTS, f, ensure_ascii=False, indent=1)
print(json.dumps(RESULTS["summary"], ensure_ascii=False))
