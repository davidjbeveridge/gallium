#!/usr/bin/env node
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const node = process.execPath;
const trials = 9;
const warmup = 2;
const chrome = process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const catalog = { sku: 'Ga-65W', name: 'Gallium USB-C Charger 65W', price: 29.99, currency: 'USD', stock: 'in stock' };
const pickup = { store: 'Denver Central', window: 'Today, 4:00–6:00 PM', available: true };

function json(res, value) {
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}

function html(res, value) {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(value);
}

function page() {
  return `<!doctype html><meta charset="utf-8"><title>Local shop fixture</title>
  <main><h1>Local shop</h1>
  <section><h2>USB-C charger</h2><button id="charger">Check price and stock</button><output id="charger-result" aria-live="polite"></output></section>
  <section><h2>Pickup</h2><button id="pickup">Show pickup window</button><output id="pickup-result" aria-live="polite"></output></section>
  <script>
  const render = (id, value) => document.querySelector(id).textContent = value;
  document.querySelector('#charger').onclick = async () => { const r = await fetch('/public/catalog/usb-c-charger.json'); const x = await r.json(); render('#charger-result', x.name + ' — $' + x.price.toFixed(2) + ' ' + x.currency + ' — ' + x.stock); };
  document.querySelector('#pickup').onclick = async () => { const r = await fetch('/public/pickup-window.json'); const x = await r.json(); render('#pickup-result', x.store + ': ' + x.window + (x.available ? ' — available' : ' — unavailable')); };
  </script></main>`;
}

async function fixture() {
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
    if (path === '/') return html(res, page());
    if (path === '/public/catalog/usb-c-charger.json') return json(res, catalog);
    if (path === '/public/pickup-window.json') return json(res, pickup);
    if (path === '/pickup.html') return html(res, page());
    res.writeHead(404); res.end();
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  return { origin, close: () => new Promise((resolve, reject) => server.close(e => e ? reject(e) : resolve())) };
}

function curl(url) {
  return new Promise((resolve, reject) => {
    const child = spawn('curl', ['-q', '--noproxy', '*', '--silent', '--show-error', '--fail', '--max-time', '5', url]);
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve(stdout) : reject(new Error(`curl failed: ${stderr}`)));
  });
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function cdpConnect(port) {
  const version = await fetch(`http://127.0.0.1:${port}/json/version`).then(r => r.json());
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve); socket.addEventListener('error', reject); });
  let next = 0;
  const pending = new Map();
  const eventHandlers = new Set();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) pending.get(message.id)(message);
    if (!message.id) for (const handler of eventHandlers) handler(message);
  });
  const command = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++next;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(method + ' timed out.'));
    }, 5000);
    pending.set(id, message => {
      clearTimeout(timeout);
      pending.delete(id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  return {
    socket, command,
    onEvent(handler) {
      eventHandlers.add(handler);
      return () => eventHandlers.delete(handler);
    },
  };
}

async function launchBrowser() {
  if (spawnSync('test', ['-x', chrome]).status !== 0) throw new Error('Set CHROME_EXECUTABLE to an installed Chrome binary.');
  const profile = mkdtempSync(join(tmpdir(), 'gallium-read-bench-'));
  const child = spawn(chrome, [
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const exited = new Promise(resolve => child.once('exit', resolve));
  async function close() {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 1500))]);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await exited;
      }
    }
    rmSync(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  }
  let port;
  const started = new Promise((resolve, reject) => {
    let text = '';
    const timer = setTimeout(() => reject(new Error('Timed out waiting for browser CDP.')), 10000);
    child.stderr.on('data', chunk => {
      text += chunk;
      const match = text.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (match) {
        clearTimeout(timer);
        port = Number(match[1]);
        resolve();
      }
    });
    child.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`Browser exited before CDP startup (${code}).`));
    });
    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
  });
  try {
    await started;
    const cdp = await cdpConnect(port);
    return {
      ...cdp,
      async close() {
        cdp.socket.close();
        await close();
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}

async function browserPage(browser, url) {
  const target = await browser.command('Target.createTarget', { url: 'about:blank' });
  const attached = await browser.command('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  const session = attached.sessionId;
  await browser.command('Page.enable', {}, session);
  await browser.command('Network.enable', {}, session);
  await browser.command('Runtime.enable', {}, session);
  await browser.command('Page.navigate', { url }, session);
  const observedUrl = new URL(url).origin + '/public/pickup-window.json';
  const network = new Map();
  const unsubscribe = browser.onEvent(message => {
    if (message.sessionId !== session) return;
    if (message.method === 'Network.requestWillBeSent' && message.params.request.method === 'GET' && message.params.request.url === observedUrl) {
      network.set(message.params.requestId, { method: 'GET', url: message.params.request.url, status: null });
    } else if (message.method === 'Network.responseReceived' && network.has(message.params.requestId)) {
      network.get(message.params.requestId).status = message.params.response.status;
    }
  });
  const deadline = waitLimit();
  for (;;) {
    const state = await browser.command('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true }, session);
    if (state.result.value === 'complete') break;
    if (performance.now() > deadline) throw new Error('Timed out waiting for initial page.');
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  return {
    session,
    async close() {
      unsubscribe();
      await browser.command('Target.closeTarget', { targetId: target.targetId });
    },
    clearNetwork: () => network.clear(),
    observedNetwork: () => [...network.values()].filter(value => value.status !== null)
      .map(value => ({ method: value.method, path: new URL(value.url).pathname, status: value.status })),
  };
}

function waitLimit() { return performance.now() + 5000; }

async function browserAction(browser, page, kind) {
  const selector = kind === 'catalog' ? '#charger' : '#pickup';
  const output = kind === 'catalog' ? '#charger-result' : '#pickup-result';
  const result = await browser.command('Runtime.evaluate', { expression: `(() => { document.querySelector(${JSON.stringify(output)}).textContent=''; document.querySelector(${JSON.stringify(selector)}).click(); return true; })()`, returnByValue: true, awaitPromise: true }, page.session);
  if (!result.result.value) throw new Error('control click failed');
  const deadline = waitLimit();
  for (;;) {
    const state = await browser.command('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(output)}).textContent`, returnByValue: true }, page.session);
    if (state.result.value) return state.result.value;
    if (performance.now() > deadline) throw new Error('Timed out waiting for rendered answer.');
    await new Promise(resolve => setTimeout(resolve, 1));
  }
}

async function navigate(browser, page, url) {
  await browser.command('Page.navigate', { url }, page.session);
  const deadline = waitLimit();
  for (;;) {
    const state = await browser.command('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true }, page.session);
    if (state.result.value === 'complete') return;
    if (performance.now() > deadline) throw new Error('Timed out waiting for page navigation.');
    await new Promise(resolve => setTimeout(resolve, 2));
  }
}

function assertCatalog(answer) {
  if (answer !== `${catalog.name} — $${catalog.price.toFixed(2)} USD — ${catalog.stock}`) throw new Error('catalog answer mismatch');
}
function assertCatalogValue(value) {
  if (!value || value.sku !== catalog.sku || value.name !== catalog.name || value.price !== catalog.price ||
      value.currency !== catalog.currency || value.stock !== catalog.stock) throw new Error('catalog JSON mismatch');
}
function assertPickup(answer) {
  if (answer !== `${pickup.store}: ${pickup.window} — available`) throw new Error('pickup answer mismatch');
}
function assertPickupValue(value) {
  if (!value || value.store !== pickup.store || value.window !== pickup.window || value.available !== true) throw new Error('pickup JSON mismatch');
}

async function main() {
  const fixtureServer = await fixture();
  const base = fixtureServer.origin;
  let browser;
  let page;
  const samples = { curlCatalog: [], browserCatalog: [], curlPickup: [], browserPickup: [], browserPickupOnly: [] };
  const harObservation = [];
  try {
    browser = await launchBrowser();
    page = await browserPage(browser, `${base}/`);
    for (let i = 0; i < warmup; i++) {
      assertCatalogValue(JSON.parse(await curl(`${base}/public/catalog/usb-c-charger.json`)));
      await navigate(browser, page, `${base}/`);
      assertCatalog(await browserAction(browser, page, 'catalog'));
    }
    for (let i = 0; i < trials; i++) {
      let start = performance.now();
      assertCatalogValue(JSON.parse(await curl(`${base}/public/catalog/usb-c-charger.json`)));
      samples.curlCatalog.push(performance.now() - start);
      start = performance.now();
      await navigate(browser, page, `${base}/`);
      assertCatalog(await browserAction(browser, page, 'catalog'));
      samples.browserCatalog.push(performance.now() - start);
    }
    const htmlCheck = await curl(`${base}/pickup.html`);
    if (!htmlCheck.includes('Show pickup window') || !htmlCheck.includes('/public/pickup-window.json')) throw new Error('pickup HTML check failed');
    for (let i = 0; i < warmup; i++) {
      assertPickupValue(JSON.parse(await curl(`${base}/public/pickup-window.json`)));
      await navigate(browser, page, `${base}/pickup.html`);
      assertPickup(await browserAction(browser, page, 'pickup'));
    }
    for (let i = 0; i < trials; i++) {
      const start = performance.now();
      const chainHtml = await curl(`${base}/pickup.html`);
      if (!chainHtml.includes('Show pickup window') || !chainHtml.includes('/public/pickup-window.json')) throw new Error('pickup HTML check failed');
      page.clearNetwork();
      const browserOnlyStart = performance.now();
      await navigate(browser, page, `${base}/pickup.html`);
      assertPickup(await browserAction(browser, page, 'pickup'));
      samples.browserPickupOnly.push(performance.now() - browserOnlyStart);
      const observedDeadline = waitLimit();
      let observed = page.observedNetwork();
      while (!observed.length && performance.now() < observedDeadline) {
        await new Promise(resolve => setTimeout(resolve, 1));
        observed = page.observedNetwork();
      }
      if (observed.length !== 1 || observed[0].method !== 'GET' ||
          observed[0].path !== '/public/pickup-window.json' || observed[0].status !== 200) throw new Error('pickup network observation mismatch');
      harObservation.push(observed[0]);
      const retryStart = performance.now();
      assertPickupValue(JSON.parse(await curl(`${base}/public/pickup-window.json`)));
      samples.curlPickup.push(performance.now() - retryStart);
      samples.browserPickup.push(performance.now() - start);
    }
  } finally {
    try {
      await page?.close();
    } finally {
      await browser?.close();
      await fixtureServer.close();
    }
  }
  const series = samplesMs => ({ medianMs: median(samplesMs), samplesMs });
  const result = {
    generatedAt: new Date().toISOString(),
    node,
    cases: {
      catalog: {
        answer: `${catalog.name} — $${catalog.price.toFixed(2)} USD — ${catalog.stock}`,
        directCurl: series(samples.curlCatalog),
        renderedChrome: series(samples.browserCatalog),
      },
      pickup: {
        answer: `${pickup.store}: ${pickup.window} — available`,
        browserOnly: series(samples.browserPickupOnly),
        fullChain: series(samples.browserPickup),
        curlRetry: series(samples.curlPickup),
        sanitizedNetworkObservation: harObservation,
      },
    },
    methodology: {
      warmupTrials: warmup,
      measuredTrials: trials,
      timing: 'Verified loopback results. Includes browser navigation and excludes fixture startup, browser launch, and teardown.',
      browser: 'Disposable headless Chrome with scripted DOM controls.',
    },
  };
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

await main();
