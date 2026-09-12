// SHELL 模块执行（TC-SHELL-001..006）
const { api, runCase, readRel } = require('./lib');

const meta = (id, title, priority, level) => ({ id, title, module: 'SHELL', level: level || 'system', priority });

(async () => {
  // TC-001 SPA 路由可服务性
  await runCase(meta('TC-SHELL-001', '3013 全部顶级路由返回 200 且为 index.html', 'P0'), async (cs) => {
    const routes = ['/projects', '/projects/new', '/tasks', '/library', '/settings', '/settings/data-tools', '/ai-config', '/media-library', '/quick-create', '/projects/import-archive'];
    for (const r of routes) {
      const res = await api.fe(r);
      const ct = res.headers.get('content-type') || '';
      const isHtml = ct.includes('text/html');
      const hasRoot = res.text.includes('<div id="app">') || res.text.includes('id="app"');
      cs.log(`${r} -> ${res.status} ${ct.split(';')[0]} root=${hasRoot} len=${res.buf.length}`);
      cs.eq(`${r} status`, res.status, 200);
      cs.expect(`${r} text/html`, isHtml, ct);
      cs.expect(`${r} index.html 挂载点`, hasRoot);
    }
  });

  // TC-002 路由表完整性（源码级）
  await runCase(meta('TC-SHELL-002', '路由表与视图文件一致性 + 覆盖 test-map 页面', 'P0', 'unit'), async (cs) => {
    const src = readRel('frontweb/src/router/index.js');
    const re = /path:\s*'([^']+)'\s*,[^}]*component:\s*\(\)\s*=>\s*import\('([^']+)'\)/g;
    const routes = [];
    let m;
    while ((m = re.exec(src)) !== null) routes.push({ path: m[1], component: m[2] });
    cs.log(`解析到 ${routes.length} 条路由`);
    routes.forEach((r) => cs.log(`  ${r.path} -> ${r.component}`));
    cs.expect('路由数>=20', routes.length >= 20, `count=${routes.length}`);
    let missing = 0;
    for (const r of routes) {
      const fsPath = 'frontweb/src/' + r.component.replace(/^@\//, '');
      try {
        require('fs').accessSync('E:/project/LocalMiniDrama/' + fsPath);
      } catch (_) {
        missing++;
        cs.log(`MISSING: ${r.path} -> ${fsPath}`);
      }
    }
    cs.eq('视图文件缺失数', missing, 0);
    cs.expect('404 catch-all 存在', routes.some((r) => r.path.includes('pathMatch') && r.component.includes('NotFound')));
    const mapPaths = ['/projects', '/projects/new', '/projects/:projectId', '/projects/:projectId/episodes', '/tasks', '/library', '/settings', '/settings/data-tools', '/ai-config', '/media-library', '/quick-create'];
    const norm = (p) => p.replace(/:projectId/g, ':id');
    const have = new Set(routes.map((r) => norm(r.path)));
    const coverGaps = mapPaths.filter((p) => !have.has(norm(p)));
    cs.log('test-map P01-P23 对应路径缺口 =', JSON.stringify(coverGaps));
    cs.eq('test-map 路径缺口数', coverGaps.length, 0);
  });

  // TC-003 未知路由 SPA 回退
  await runCase(meta('TC-SHELL-003', '未知路径 SPA 回退 200 + catch-all 渲染 404 页', 'P1'), async (cs) => {
    const res = await api.fe('/qa-l3-definitely-not-a-route');
    cs.log('GET /qa-l3-definitely-not-a-route ->', res.status, (res.headers.get('content-type') || '').split(';')[0], 'len=', res.buf.length);
    cs.eq('status', res.status, 200);
    cs.expect('text/html', (res.headers.get('content-type') || '').includes('text/html'));
    const src = readRel('frontweb/src/router/index.js');
    cs.expect('前端 catch-all -> NotFoundView 存在（404 由前端渲染）', src.includes('pathMatch') && src.includes('NotFoundView'));
  });

  // TC-004 API 未知路径 404 JSON
  await runCase(meta('TC-SHELL-004', 'API 未知路径 404 JSON 不回退 HTML', 'P1'), async (cs) => {
    for (const p of ['/api/v1/qa-l3-unknown', '/api/v2/qa-l3-unknown']) {
      const r = await api.be(p);
      cs.log(`${p} -> ${r.status} ct=${r.headers.get('content-type')} body=${r.text.slice(0, 80)}`);
      cs.eq(`${p} status`, r.status, 404);
      cs.expect(`${p} JSON 错误体`, r.json !== null && JSON.stringify(r.json).includes('not found'), r.text.slice(0, 80));
      cs.expect(`${p} 不返回 HTML`, !(r.headers.get('content-type') || '').includes('text/html'));
    }
  });

  // TC-005 静态资源代理
  await runCase(meta('TC-SHELL-005', '/static 资源经 3013 代理与 5679 直连一致', 'P1', 'integration'), async (cs) => {
    const f = '/static/v21-mock/15da54e6-ca71-4d95-9dd3-9a242b181e0c.png';
    const px = await api.fe(f);
    const dr = await api.be(f);
    cs.log(`proxy -> ${px.status} ${px.headers.get('content-type')} len=${px.buf.length}`);
    cs.log(`direct -> ${dr.status} ${dr.headers.get('content-type')} len=${dr.buf.length}`);
    cs.eq('proxy status', px.status, 200);
    cs.eq('direct status', dr.status, 200);
    cs.expect('proxy content-type image/*', (px.headers.get('content-type') || '').startsWith('image/'), px.headers.get('content-type'));
    cs.eq('字节长度一致', px.buf.length, dr.buf.length);
  });

  // TC-006 /health
  await runCase(meta('TC-SHELL-006', '/health 健康检查契约', 'P2'), async (cs) => {
    const r = await api.be('/health');
    cs.log('GET /health ->', r.status, r.text.slice(0, 120));
    cs.eq('status', r.status, 200);
    cs.eq('body.status', r.json?.status, 'ok');
    cs.expect('app 非空', !!r.json?.app, r.json?.app);
    cs.expect('version 非空', !!r.json?.version, r.json?.version);
  });

  console.log('\nSHELL done');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });

// ---- automation.test_id registry (generated from qa/cases/*.yml) ----
// TC-SHELL-001: SHELL_001_spa_routes_served
// TC-SHELL-002: SHELL_002_router_integrity
// TC-SHELL-003: SHELL_003_unknown_route_fallback
// TC-SHELL-004: SHELL_004_unknown_api_paths
// TC-SHELL-005: SHELL_005_static_proxy
// TC-SHELL-006: SHELL_006_health_contract
