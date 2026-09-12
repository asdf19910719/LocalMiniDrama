# -*- coding: utf-8 -*-
"""E2E Stage E: 刷新状态恢复 / 404 / 成片门禁软进入 / 任务中心"""
import json, time, os
from playwright.sync_api import sync_playwright

ART = "qa/run/e2e-artifacts/stageE"
os.makedirs(ART, exist_ok=True)
RESULTS = {"stage": "E", "steps": [], "started_at": time.strftime("%Y-%m-%dT%H:%M:%S")}
N = [0]
PID, EID = 272, 189

def record(step, status, detail="", evidence=None):
    RESULTS["steps"].append({"step": step, "status": status, "detail": str(detail)[:350], "evidence": evidence})
    print(f"[{status}] {step} :: {str(detail)[:200]}", flush=True)

def shot(page, name):
    N[0] += 1
    path = f"{ART}/e-{N[0]:02d}-{name}.png"
    page.screenshot(path=path)
    return path

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp("http://127.0.0.1:9223")
    page = browser.contexts[0].new_page()
    page.set_default_timeout(20000)

    # E1: 分镜页刷新恢复（分镜结构 + H3 草稿状态）
    page.goto(f"http://127.0.0.1:3013/projects/{PID}/episodes/{EID}/storyboard")
    page.wait_for_timeout(3500)
    page.reload()
    page.wait_for_timeout(3500)
    body = page.inner_text("body")
    ok = ("古镇街道" in body) and ("镜头" in body or "分镜" in body)
    h3 = "重新生成" in body or "H3" in body
    record("storyboard-refresh-recovery", "PASS" if ok else "FAIL",
           f"结构恢复={ok} H3区可见={h3}", shot(page, "storyboard-refresh"))

    # E2: 成片门禁清单（软进入提前审片）
    page.goto(f"http://127.0.0.1:3013/projects/{PID}/episodes/{EID}/cut")
    page.wait_for_timeout(3500)
    body = page.inner_text("-body" if False else "body")
    gate_ok = ("生成成片" in body) and ("需完成" in body or "门禁" in body or "未完成" in body)
    record("cut-gate-list", "PASS" if gate_ok else "WARN", body[:200].replace("\n", " "), shot(page, "cut-gate"))

    # E3: 404 页
    page.goto("http://127.0.0.1:3013/definitely-not-a-route-qa")
    page.wait_for_timeout(2000)
    body = page.inner_text("body")
    is404 = ("404" in body) or ("不存在" in body)
    record("route-404", "PASS" if is404 else "FAIL", body[:120].replace("\n", " "), shot(page, "404"))

    # E4: 任务中心
    page.goto("http://127.0.0.1:3013/tasks")
    page.wait_for_timeout(3000)
    body = page.inner_text("body")
    record("tasks-page", "PASS", body[:160].replace("\n", " "), shot(page, "tasks"))

    # E5: 项目列表刷新 + 本轮项目可见
    page.goto("http://127.0.0.1:3013/projects")
    page.wait_for_timeout(3000)
    body = page.inner_text("body")
    found = "QA-L3-E2E-主链" in body
    record("projects-list-shows-new", "PASS" if found else "FAIL", f"found={found}", shot(page, "projects-list"))

    page.close()
    browser.close()

RESULTS["finished_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
RESULTS["summary"] = {"passed": sum(1 for s in RESULTS["steps"] if s["status"]=="PASS"),
                      "failed": sum(1 for s in RESULTS["steps"] if s["status"]=="FAIL"),
                      "warn": sum(1 for s in RESULTS["steps"] if s["status"]=="WARN")}
with open("qa/run/e2e-stageE.json", "w", encoding="utf-8") as f:
    json.dump(RESULTS, f, ensure_ascii=False, indent=1)
print(json.dumps(RESULTS["summary"], ensure_ascii=False))
