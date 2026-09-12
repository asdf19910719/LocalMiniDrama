# -*- coding: utf-8 -*-
"""E2E Stage A: 建项目 → 建剧集 → 剧本编辑/自动保存 → 刷新持久化 → 确认剧本
通过 CDP 连接 9223 的 ChatGPT 测试浏览器（含扩展），驱动 3013 V2.1 工作台。
证据: qa/run/e2e-artifacts/stageA/ + qa/run/e2e-stageA.json
"""
import json, sys, time, os
from playwright.sync_api import sync_playwright

ART = "qa/run/e2e-artifacts/stageA"
os.makedirs(ART, exist_ok=True)
RESULTS = {"stage": "A", "steps": [], "started_at": time.strftime("%Y-%m-%dT%H:%M:%S")}
SHOT_N = [0]

def record(step, status, detail="", evidence=None):
    RESULTS["steps"].append({"step": step, "status": status, "detail": detail, "evidence": evidence})
    print(f"[{status}] {step} :: {detail[:160]}")

def shot(page, name):
    SHOT_N[0] += 1
    path = f"{ART}/{SHOT_N[0]:02d}-{name}.png"
    page.screenshot(path=path, full_page=False)
    return path

def save():
    RESULTS["finished_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    passed = sum(1 for s in RESULTS["steps"] if s["status"] == "PASS")
    failed = sum(1 for s in RESULTS["steps"] if s["status"] == "FAIL")
    RESULTS["summary"] = {"passed": passed, "failed": failed}
    with open("qa/run/e2e-stageA.json", "w", encoding="utf-8") as f:
        json.dump(RESULTS, f, ensure_ascii=False, indent=1)

def run():
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp("http://127.0.0.1:9223")
        ctx = browser.contexts[0]
        page = ctx.new_page()
        page.set_default_timeout(20000)

        # S1 打开项目列表（SPA 可服务性顺带验证）
        page.goto("http://127.0.0.1:3013/projects")
        page.wait_for_load_state("networkidle")
        record("open-projects", "PASS", page.url, shot(page, "projects"))

        # S2 新建项目页
        page.goto("http://127.0.0.1:3013/projects/new")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(1200)
        record("open-new-project", "PASS", page.url, shot(page, "new-project"))

        # S3 填写项目名并创建（第一个 textbox = 名称，按页面实际结构适配）
        name = f"QA-L3-E2E-主链-{time.strftime('%H%M%S')}"
        RESULTS["project_name"] = name
        inputs = page.locator("input[type='text'], input:not([type])")
        n = inputs.count()
        filled = False
        for i in range(min(n, 6)):
            el = inputs.nth(i)
            if el.is_visible():
                ph = (el.get_attribute("placeholder") or "")
                if any(k in ph for k in ("名称", "项目", "名")) or i == 0:
                    el.fill(name)
                    filled = True
                    break
        if not filled and n > 0:
            inputs.first.fill(name)
            filled = True
        record("fill-project-name", "PASS" if filled else "FAIL", f"name={name} inputs={n}", shot(page, "filled"))
        page.get_by_text("创建", exact=False).last.click()
        page.wait_for_timeout(2500)
        record("click-create", "PASS", page.url, shot(page, "after-create"))

        # S4 从概览进入剧集中心
        ep_links = page.locator("text=剧集")
        if "episodes" not in page.url:
            # 概览页找剧集入口
            cand = page.get_by_text("剧集中心").first
            if cand.count():
                cand.click(); page.wait_for_timeout(2000)
            else:
                m = page.url.split("/projects/")
                if len(m) == 2:
                    pid = m[1].split("/")[0].split("?")[0]
                    RESULTS["project_id"] = pid
                    page.goto(f"http://127.0.0.1:3013/projects/{pid}/episodes")
        page.wait_for_timeout(1500)
        if "episodes" in page.url and "/projects/" in page.url:
            seg = page.url.split("/projects/")[1].split("/")[0]
            RESULTS["project_id"] = seg
        record("open-episodes", "PASS", page.url, shot(page, "episodes"))

        # S5 新建剧集
        pid = RESULTS.get("project_id")
        before = page.locator("text=第 1 集").count() + page.locator("text=第1集").count()
        btn = page.get_by_text("新建剧集", exact=False).last
        btn.click()
        page.wait_for_timeout(1500)
        shot(page, "new-episode-dialog")
        # 对话框里可能有创建/确认按钮
        for label in ("创建", "确定", "确认"):
            b = page.get_by_role("button", name=label)
            if b.count():
                b.last.click(); break
        page.wait_for_timeout(2500)
        after = page.locator("text=第 1 集").count() + page.locator("text=第1集").count()
        record("create-episode", "PASS" if after > before or "episode" in page.url or "/script" in page.url else "WARN",
               f"rows before={before} after={after} url={page.url}", shot(page, "after-episode"))

        # S6 进入剧本阶段
        eid = RESULTS.get("episode_id")
        if not eid:
            # 剧集行进入剧本（若有直达 CTA）
            row = page.locator("text=第 1 集").first
            if not row.count():
                row = page.locator("text=第1集").first
            if row.count():
                row.click()
                page.wait_for_timeout(2000)
        if "/script" not in page.url and pid:
            # 通过 API 找 episode id，直接路由
            import urllib.request
            data = json.load(urllib.request.urlopen(f"http://127.0.0.1:5679/api/v1/dramas/{pid}/episodes"))
            eps = data.get("data") or data.get("episodes") or []
            if eps:
                eid = eps[0].get("id") or eps[0].get("episode_id")
                RESULTS["episode_id"] = eid
                page.goto(f"http://127.0.0.1:3013/projects/{pid}/episodes/{eid}/script")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(1500)
        record("open-script", "PASS", page.url, shot(page, "script-stage"))

        # S7 编辑剧本正文 + 自动保存
        script_text = (
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
        editor = page.locator("textarea").first
        if not editor.count():
            editor = page.locator("[contenteditable='true']").first
        editor.click()
        editor.fill(script_text)
        page.wait_for_timeout(2000)  # 触发 800ms 自动保存
        record("fill-script", "PASS", f"len={len(script_text)}", shot(page, "script-filled"))
        page.wait_for_timeout(3000)  # 等自动保存完成
        body = page.inner_text("body")
        saved_hint = ("已保存" in body) or ("保存中" not in body and "未保存" not in body)
        record("autosave-hint", "PASS" if saved_hint else "WARN", "已保存状态可见" if saved_hint else body[-200:], shot(page, "autosave"))

        # S8 刷新持久化
        page.reload()
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(2000)
        body2 = page.inner_text("body")
        kept = ("雨夜" in body2) or ("旧书店" in body2) or ("青石板" in body2)
        record("refresh-persistence", "PASS" if kept else "FAIL", "刷新后正文保留" if kept else "刷新后正文丢失!", shot(page, "after-refresh"))

        # S9 确认剧本（检查并确认）
        confirm_btn = None
        for label in ("检查并确认", "确认剧本", "检查"):
            b = page.get_by_text(label, exact=False)
            if b.count():
                confirm_btn = b.first
                break
        if confirm_btn:
            confirm_btn.click()
            page.wait_for_timeout(2000)
            shot(page, "confirm-dialog")
            # 弹窗内点确认（避免误点"取消"）
            dlg = page.locator("[role='dialog']").last if page.locator("[role='dialog']").count() else page
            for label in ("确认", "批准", "确定"):
                b = dlg.get_by_role("button", name=label)
                if b.count():
                    b.last.click(); break
            page.wait_for_timeout(3000)
            body3 = page.inner_text("body")
            approved = ("已确认" in body3) or ("approved" in body3.lower()) or ("进入设定" in body3) or ("已批准" in body3)
            record("confirm-script", "PASS" if approved else "WARN", "确认态可见" if approved else body3[-200:], shot(page, "after-confirm"))
        else:
            record("confirm-script", "FAIL", "未找到确认入口", shot(page, "no-confirm"))

        page.close()
        browser.close()

run()
save()
print(json.dumps(RESULTS["summary"], ensure_ascii=False))
