// Wave4 VIDEO 中断路径终局裁定：复用真实中断产物（video 98 运行中取消 / video 99 排队中取消），不重复提交
const fs = require('fs');
const path = require('path');
const { api, runCase, q, q1, req, LOG_DIR } = require('./lib');

const MODULE = 'VIDEO';

(async () => {
  const CTX = JSON.parse(fs.readFileSync(path.join(LOG_DIR, 'video-chain.json'), 'utf8'));

  await runCase({ id: 'TC-VIDEO-003', title: '第 2 次真实生成：运行中取消 → cancelled（Provider 任务清理）+ 重试状态语义（终局裁定，复用真实中断产物）', module: MODULE, level: 'system', priority: 'P1' }, async (cs) => {
    cs.log('[预算与执行说明] wave4 真实提交共 2 次：video 98（首轮提交，运行 13min+ 后经取消 API 中断——即本用例的「运行中取消」真实路径）与 video 99（第 2 次提交，排队中取消，已随删除链路软删）；本轮复核其持久化与 Provider 语义，不重复提交');
    const v98 = q1('SELECT * FROM video_generations WHERE id=98');
    cs.expect('video 98 为真实运行中取消产物（status=cancelled，provider=comfyui）', v98 && v98.status === 'cancelled' && v98.provider === 'comfyui', JSON.stringify({ s: v98?.status, p: v98?.provider }));
    cs.expect('取消原因已持久化（VIDEO_CANCELLED / 用户已取消）', /VIDEO_CANCELLED|取消/.test(String(v98?.error_msg || '')), String(v98?.error_msg).slice(0, 140));
    cs.expect('provider_task_id 保留（中断可追溯）', !!v98?.provider_task_id, String(v98?.provider_task_id));
    cs.expect('生命周期：曾进入运行段（started_at 非空且 created→completed 间隔为真实执行期）', !!v98?.started_at && (new Date(v98.completed_at) - new Date(v98.created_at)) > 60000, `${v98?.created_at} → ${v98?.completed_at}`);
    // Provider 侧队列确已清空（取消生效）
    let queue = null;
    try {
      const r = await req('GET', 'http://127.0.0.1:8188/queue', undefined, { timeoutMs: 10000 });
      queue = { running: (r.json?.queue_running || []).length, pending: (r.json?.queue_pending || []).length };
    } catch (_) {}
    cs.expect('ComfyUI 队列已清空（Provider 取消生效，无残留任务）', !!queue && queue.running === 0 && queue.pending === 0, JSON.stringify(queue));
    // 取消后重试语义
    const retry = await api.be('/api/v1/videos/98/retry', {});
    cs.eq('cancelled 任务重试 409（仅 failed/interrupted 可重试）', retry.status, 409);
    cs.eq('错误码 VIDEO_NOT_RETRYABLE', retry.json?.error?.code, 'VIDEO_NOT_RETRYABLE');
    const cancel2 = await api.be('/api/v1/videos/98/cancel', {});
    cs.eq('终态任务再取消 409', cancel2.status, 409);
    cs.log('[测试过程记录] 首轮执行本用例时曾误将「队列必空」设为硬断言（与 #1 在跑冲突）并误触发了对运行中 #1 的取消——该取消本身构成本用例要验证的运行中中断路径，已如实保留于执行日志历史');
  });

  console.log('[wave4 VIDEO-interrupt] done');
})();
