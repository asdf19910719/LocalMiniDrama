const port = Number(process.env.CHROME_CDP_PORT || 9223);
const action = process.argv[2] || 'inspect';
const fs = require('node:fs');
const path = require('node:path');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connect() {
  const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((response) => response.json());
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const callback = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) callback.reject(new Error(message.error.message));
    else callback.resolve(message.result || {});
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const commandId = ++id;
    pending.set(commandId, { resolve, reject });
    socket.send(JSON.stringify({ id: commandId, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  return { socket, send };
}

async function attachPage(cdp, matcher) {
  const { targetInfos = [] } = await cdp.send('Target.getTargets');
  const info = targetInfos.find((target) => target.type === 'page' && matcher(target));
  if (!info) throw new Error('Target page not found');
  const attached = await cdp.send('Target.attachToTarget', { targetId: info.targetId, flatten: true });
  return {
    info,
    send: (method, params = {}) => cdp.send(method, params, attached.sessionId),
  };
}

async function evaluate(page, expression) {
  const response = await page.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || 'Runtime evaluation failed');
  return response.result?.value;
}

async function reloadPages(cdp) {
  const { targetInfos = [] } = await cdp.send('Target.getTargets');
  const pages = targetInfos.filter((target) => target.type === 'page' && (
    target.url.includes('127.0.0.1:3013/film/5') || target.url.startsWith('https://chatgpt.com/')
  ));
  for (const info of pages) {
    const attached = await cdp.send('Target.attachToTarget', { targetId: info.targetId, flatten: true });
    await cdp.send('Page.reload', { ignoreCache: true }, attached.sessionId);
  }
  await sleep(10000);
  return pages.map(({ title, url }) => ({ title, url }));
}

async function inspect(page) {
  return evaluate(page, `(() => ({
    title: document.title,
    url: location.href,
    body: document.body.innerText.slice(0, 12000),
    actionable: [...document.querySelectorAll('button,[role="button"]')]
      .map((node, index) => ({
        index,
        tag: node.tagName,
        text: (node.innerText || node.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 180),
        title: node.getAttribute('title') || '',
        aria: node.getAttribute('aria-label') || '',
        disabled: Boolean(node.disabled || node.getAttribute('aria-disabled') === 'true'),
        className: String(node.className || '').slice(0, 180),
        context: (node.closest('.el-card,.character-card,.asset-card,.scene-card,.prop-card')?.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 260),
      }))
      .filter((item) => /生成|图片|状态|角色|道具|场景/.test(item.text + item.title + item.aria))
  }))()`);
}

async function diagnostics(page) {
  return evaluate(page, `(async () => {
    const requestId = crypto.randomUUID();
    return await new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ ok: false, error: 'timeout' }), 12000);
      const onMessage = (event) => {
        if (event.source !== window || event.data?.source !== 'aistory-external-generation-response' || event.data.requestId !== requestId) return;
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        resolve(event.data.response);
      };
      window.addEventListener('message', onMessage);
      window.postMessage({ source: 'aistory-external-generation', requestId, message: { action: 'diagnostics', dramaId: 5, site: 'chatgpt' } }, '*');
    });
  })()`);
}

async function assetButtons(page) {
  return evaluate(page, `(() => [...document.querySelectorAll('button')]
    .filter((button) => (button.innerText || button.textContent || '').trim() === 'ChatGPT 生成')
    .map((button, index) => {
      let node = button;
      const ancestors = [];
      for (let depth = 0; depth < 7 && node; depth += 1, node = node.parentElement) {
        ancestors.push({ tag: node.tagName, className: String(node.className || ''), text: (node.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 240) });
      }
      return { index, disabled: button.disabled, ancestors };
    }))()`);
}

async function summaryTotal() {
  const payload = await fetch('http://127.0.0.1:5679/api/v1/dramas/5/image-generation-summary').then((response) => response.json());
  return Number(payload?.data?.total || 0);
}

async function waitForNewTask(previousTotal, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const total = await summaryTotal();
    if (total > previousTotal) return total;
    await sleep(250);
  }
  throw new Error(`No task was created after UI click (total remained ${previousTotal})`);
}

async function closeDrawer(page) {
  await evaluate(page, `(() => { const close = document.querySelector('.el-drawer__close-btn'); if (!close) return false; close.click(); return true; })()`);
  await sleep(250);
}

async function clickAssetButtons(page) {
  const names = await evaluate(page, `(() => [...document.querySelectorAll('button')]
    .filter((button) => (button.innerText || button.textContent || '').trim() === 'ChatGPT 生成')
    .map((button) => (button.closest('.asset-item')?.innerText || '').trim().split('\\n')[0]))()`);
  const created = [];
  let total = await summaryTotal();
  for (const name of names) {
    const clicked = await evaluate(page, `(() => {
      const name = ${JSON.stringify(name)};
      const item = [...document.querySelectorAll('.asset-item')].find((node) => (node.innerText || '').trim().split('\\n')[0] === name);
      const button = [...(item?.querySelectorAll('button') || [])].find((node) => (node.innerText || node.textContent || '').trim() === 'ChatGPT 生成');
      if (!button || button.disabled) return false;
      button.scrollIntoView({ block: 'center' });
      button.click();
      return true;
    })()`);
    if (!clicked) throw new Error(`Generation button unavailable for ${name}`);
    total = await waitForNewTask(total);
    created.push({ name, total });
    await closeDrawer(page);
  }
  return created;
}

async function clickVariantButtons(page) {
  const characterNames = ['周启', '苏妍', '西装男人'];
  const created = [];
  let total = await summaryTotal();
  for (const characterName of characterNames) {
    const opened = await evaluate(page, `(() => {
      const characterName = ${JSON.stringify(characterName)};
      const item = [...document.querySelectorAll('.asset-item')].find((node) => (node.innerText || '').trim().split('\\n')[0] === characterName);
      const toggle = item?.querySelector('.char-variants-toggle');
      if (!toggle) return false;
      toggle.scrollIntoView({ block: 'center' });
      toggle.click();
      return true;
    })()`);
    if (!opened) throw new Error(`Variant panel unavailable for ${characterName}`);
    await sleep(1000);
    const variantName = await evaluate(page, `(() => {
      const characterName = ${JSON.stringify(characterName)};
      const item = [...document.querySelectorAll('.asset-item')].find((node) => (node.innerText || '').trim().split('\\n')[0] === characterName);
      const variant = item?.querySelector('.char-variant-item');
      const button = [...(variant?.querySelectorAll('button') || [])].find((node) => (node.innerText || node.textContent || '').trim() === '生图');
      if (!button || button.disabled) return '';
      const name = (variant.querySelector('.char-variant-name span')?.textContent || '').trim();
      button.click();
      return name;
    })()`);
    if (!variantName) throw new Error(`Variant generation button unavailable for ${characterName}`);
    total = await waitForNewTask(total);
    created.push({ characterName, variantName, total });
    await closeDrawer(page);
  }
  return created;
}

async function verifyRenderedImages(page) {
  const expectedVariantResults = {
    '周启': 'fdb4f564-65f2-452b-8844-b8048b2e5e17',
    '苏妍': 'ed5e7de5-a8c9-4d3f-b98a-c038370fbc68',
    '西装男人': '8171e1c5-8ae4-4be6-876b-069e851925eb',
  };
  const variantCards = [];
  for (const characterName of Object.keys(expectedVariantResults)) {
    const card = await evaluate(page, `(async () => {
      const characterName = ${JSON.stringify(characterName)};
      const item = [...document.querySelectorAll('.asset-item')]
        .find((node) => (node.innerText || '').trim().split('\\n')[0] === characterName);
      if (!item) return { characterName, error: 'asset item not found' };
      if (!item.querySelector('.char-variants-panel')) item.querySelector('.char-variants-toggle')?.click();
      await new Promise((resolve) => setTimeout(resolve, 300));
      const variant = item.querySelector('.char-variant-item');
      const img = variant?.querySelector('.char-variant-thumb img');
      if (img) {
        img.scrollIntoView({ block: 'center' });
        if (!img.complete) await Promise.race([
          new Promise((resolve) => img.addEventListener('load', resolve, { once: true })),
          new Promise((resolve) => setTimeout(resolve, 5000)),
        ]);
      }
      const response = img?.src ? await fetch(img.src) : null;
      return {
        characterName,
        variantName: (variant?.querySelector('.char-variant-name span')?.textContent || '').trim(),
        isDefault: Boolean(variant?.querySelector('.el-tag')),
        src: img?.src || '',
        complete: Boolean(img?.complete),
        naturalWidth: Number(img?.naturalWidth || 0),
        naturalHeight: Number(img?.naturalHeight || 0),
        httpStatus: response?.status || 0,
        contentType: response?.headers.get('content-type') || '',
      };
    })()`);
    card.expectedResultId = expectedVariantResults[characterName];
    card.matchesExpectedResult = card.src.includes(expectedVariantResults[characterName]);
    variantCards.push(card);
  }

  const result = await evaluate(page, `(async () => {
    const assetItems = [...document.querySelectorAll('.asset-item')];
    const assets = [];
    for (const item of assetItems) {
      const name = (item.innerText || '').trim().split('\\n')[0];
      const img = item.querySelector(':scope > .asset-preview img, :scope .asset-image img, :scope > img')
        || [...item.querySelectorAll('img')].find((node) => !node.closest('.char-variant-item'));
      if (img) {
        img.scrollIntoView({ block: 'center' });
        if (!img.complete) await Promise.race([
          new Promise((resolve) => img.addEventListener('load', resolve, { once: true })),
          new Promise((resolve) => setTimeout(resolve, 5000)),
        ]);
      }
      const response = img?.src ? await fetch(img.src) : null;
      assets.push({
        name,
        src: img?.src || '',
        complete: Boolean(img?.complete),
        naturalWidth: Number(img?.naturalWidth || 0),
        naturalHeight: Number(img?.naturalHeight || 0),
        httpStatus: response?.status || 0,
        contentType: response?.headers.get('content-type') || '',
      });
    }

    const storyboardRefs = [...document.querySelectorAll('.sb-thumb-avatar[title*=" · "]')]
      .map((node) => {
        const img = node.querySelector('img');
        return {
          title: node.title,
          src: img?.src || '',
          complete: Boolean(img?.complete),
          naturalWidth: Number(img?.naturalWidth || 0),
          naturalHeight: Number(img?.naturalHeight || 0),
        };
      });
    const uniqueSources = [...new Set(storyboardRefs.map((item) => item.src).filter(Boolean))];
    const sourceChecks = [];
    for (const src of uniqueSources) {
      const response = await fetch(src);
      const blob = await response.blob();
      sourceChecks.push({ src, status: response.status, type: blob.type, bytes: blob.size });
    }
    return { assets, storyboardRefs, sourceChecks };
  })()`);
  result.variantCards = variantCards;
  result.summary = {
    assets: result.assets.length,
    assetsRendered: result.assets.filter((item) => item.complete && item.naturalWidth > 0 && item.httpStatus === 200 && item.contentType.startsWith('image/')).length,
    variantCards: variantCards.length,
    variantsRenderedAndCurrent: variantCards.filter((item) => item.complete && item.naturalWidth > 0 && item.httpStatus === 200 && item.contentType.startsWith('image/') && item.matchesExpectedResult).length,
    storyboardRefs: result.storyboardRefs.length,
    storyboardRefTitles: Object.fromEntries([...new Set(result.storyboardRefs.map((item) => item.title))].map((title) => [title, result.storyboardRefs.filter((item) => item.title === title).length])),
    storyboardSourcesReachable: result.sourceChecks.filter((item) => item.status === 200 && item.type.startsWith('image/') && item.bytes > 0).length,
    storyboardUniqueSources: result.sourceChecks.length,
  };
  return result;
}

async function capturePage(page, sectionName = '') {
  await evaluate(page, `(() => {
    const sectionName = ${JSON.stringify(sectionName)};
    const firstAsset = sectionName
      ? [...document.querySelectorAll('.asset-item')].find((node) => (node.innerText || '').trim().split('\\n')[0] === sectionName)
      : document.querySelector('.asset-item');
    if (firstAsset) firstAsset.scrollIntoView({ block: 'start', behavior: 'instant' });
    else window.scrollTo({ top: 0, behavior: 'instant' });
    return { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight };
  })()`);
  await sleep(1000);
  const { data } = await page.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    fromSurface: true,
  });
  const outputPath = path.resolve(__dirname, sectionName
    ? 'canonical-reference-live-acceptance-scenes.png'
    : 'canonical-reference-live-acceptance.png');
  fs.writeFileSync(outputPath, Buffer.from(data, 'base64'));
  return outputPath;
}

async function main() {
  const cdp = await connect();
  try {
    if (action === 'reload') {
      console.log(JSON.stringify({ reloaded: await reloadPages(cdp) }, null, 2));
      return;
    }
    const page = await attachPage(cdp, (target) => target.url.includes('127.0.0.1:3013/film/5'));
    if (action === 'diagnostics') {
      console.log(JSON.stringify(await diagnostics(page), null, 2));
      return;
    }
    if (action === 'assets') {
      console.log(JSON.stringify(await assetButtons(page), null, 2));
      return;
    }
    if (action === 'click-assets') {
      console.log(JSON.stringify(await clickAssetButtons(page), null, 2));
      return;
    }
    if (action === 'click-variants') {
      console.log(JSON.stringify(await clickVariantButtons(page), null, 2));
      return;
    }
    if (action === 'verify-rendered') {
      console.log(JSON.stringify(await verifyRenderedImages(page), null, 2));
      return;
    }
    if (action === 'screenshot') {
      console.log(JSON.stringify({ screenshot: await capturePage(page) }, null, 2));
      return;
    }
    if (action === 'screenshot-scenes') {
      console.log(JSON.stringify({ screenshot: await capturePage(page, '酒店走廊') }, null, 2));
      return;
    }
    console.log(JSON.stringify(await inspect(page), null, 2));
  } finally {
    cdp.socket.close();
  }
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
