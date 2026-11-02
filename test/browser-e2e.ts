import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@xmorse/playwright-core';
import { startPlayWriterCDPRelayServer, listBrowsers } from 'playwriter';
import { createFixtureServer } from '../fixtures/server.ts';
import { createEngine } from '../src/runtime.ts';
import { validateConfig } from '../src/config.ts';
import type { Engine } from '../src/engine.ts';

// Explicit release gate. Uses the installed Chrome binary and a new disposable test profile.
// Never touches the user's Chrome profile, installs a browser, or kills another relay.
const scratch = mkdtempSync(join(tmpdir(), 'web-operator-e2e-'));
const fixture = await createFixtureServer({ port: 0 });
const relay = await startPlayWriterCDPRelayServer({ port: 19988, host: '127.0.0.1', logger: { log() {}, error() {} } });
let context: any;
let engine: Engine | undefined;
const started = performance.now();
try {
  context = await chromium.launchPersistentContext(join(scratch, 'chrome'), {
    executablePath: process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true, ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'],
  });
  console.log('STEP: Chrome launched');
  context.setDefaultTimeout(10000);
  const cdp = await context.browser().newBrowserCDPSession();
  const extension = await cdp.send('Extensions.loadUnpacked', { path: resolve('dist/extension') });
  const overlay = await cdp.send('Extensions.loadUnpacked', { path: resolve('fixtures/overlay') });
  console.log('STEP: Extension loaded');
  const worker = context.serviceWorkers().find((worker: any) => worker.url().includes(extension.id))
    ?? await context.waitForEvent('serviceworker', { predicate: (worker: any) => worker.url().includes(extension.id), timeout: 10000 });
  console.log('STEP: Worker ready');
  const page = await context.newPage();
  await page.goto(fixture.origin + '/profile');
  await page.bringToFront();
  let attachTimer: ReturnType<typeof setTimeout>;
  try { await Promise.race([worker.evaluate(async () => (globalThis as any).toggleExtensionForActiveTab()), new Promise((_, reject) => { attachTimer = setTimeout(() => reject(new Error('Bridge attach deadline')), 8000); })]); } finally { clearTimeout(attachTimer!); }
  console.log('STEP: Tab attached');
  const browsers = await listBrowsers({ port: 19988, logger: { log() {} } });
  assert.equal(browsers.length, 1);
  const template = JSON.parse(readFileSync('examples/browser.config.json', 'utf8').replaceAll('http://127.0.0.1:8787', fixture.origin));
  template.stateDir = join(scratch, 'state');
  template.playwriter.preserveExtensionsVerified = true; // only this isolated fixture gate
  template.playwriter.browserId = browsers[0].id;
  template.recipes.push({ ...structuredClone(template.recipes[0]), id: 'save-browser-request', adapter: 'browser-request', http: {
    url: fixture.origin + '/api/session-profile', verifyUrl: fixture.origin + '/api/session-profile', method: 'POST', effect: 'write',
    inputKeys: ['name'], accountPath: 'account', goalPath: 'name', expectedInputKey: 'name', idempotencyHeader: 'Idempotency-Key',
  } });
  template.recipes[1].browser.csrf = { selector: 'meta[name="fixture-csrf"]', attribute: 'content', header: 'X-Fixture-CSRF' };
  assert.equal((await fetch(fixture.origin + '/api/session-profile')).status, 401);
  console.log('STEP: Browser identified');
  const config = validateConfig(template);
  engine = await createEngine(config);
  await page.evaluate(() => {
    (window as any).inputEvents = [];
    for (const type of ['pointerdown','keydown','input','click']) document.addEventListener(type, event => {
      if ((event.target as HTMLElement)?.id === 'name' || (event.target as HTMLElement)?.id === 'save')
        (window as any).inputEvents.push({ type, trusted: event.isTrusted, activation: navigator.userActivation.isActive });
    }, true);
  });
  console.log('STEP: Executing UI recipe');
  const first: any = await engine.act({ operationId: 'browser-first', recipe: 'save-profile', input: { name: 'Ada' } });
  assert.equal(first.operation.state, 'verified', JSON.stringify(first));
  assert.equal(first.operation.actions, 2);
  assert.equal((await (await fetch(fixture.origin + '/api/profile')).json()).saveCount, 1);
  await engine.act({ operationId: 'browser-first', recipe: 'save-profile', input: { name: 'Ada' } });
  assert.equal((await (await fetch(fixture.origin + '/api/profile')).json()).saveCount, 1);
  const events = await page.evaluate(() => (window as any).inputEvents);
  assert(events.some((event: any) => event.type === 'input'));
  assert(events.every((event: any) => event.trusted));
  assert(events.some((event: any) => event.type === 'click' && event.activation));

  console.log('STEP: Pausing');
  const paused: any = await engine.control('local-profile', 'pause');
  assert.equal(paused.control.owner, 'human', JSON.stringify(paused));
  assert.equal(paused.code, undefined, JSON.stringify(paused));
  assert.equal(paused.control.phase, 'handed_off');
  const detached = await worker.evaluate(async (origin: string) => {
    const [tab] = await chrome.tabs.query({ url: origin + '/*' });
    try { await chrome.debugger.sendCommand({ tabId: tab.id! }, 'Runtime.getIsolateId'); return false; }
    catch (error) { return /not attached/i.test(String(error)); }
  }, fixture.origin);
  assert(detached);
  // A second independently controlled page connection stands in for the human.
  await page.reload();
  await page.locator('#name').fill('Lin');
  await page.locator('#save').click();
  await page.locator('[data-saved-name]').filter({ hasText: 'Lin' }).waitFor();
  await engine.close();
  engine = await createEngine(config);
  const blocked: any = await engine.act({ operationId: 'browser-handback', recipe: 'save-profile', input: { name: 'Lin' } });
  assert.equal(blocked.code, 'PAUSED');
  // Real cross-extension iframe: the conflict must preserve it and keep ownership human.
  await page.evaluate((id: string) => {
    const frame = document.createElement('iframe'); frame.id = 'extension-overlay';
    frame.src = 'chrome-extension://' + id + '/overlay.html'; document.body.append(frame);
  }, overlay.id);
  await page.frameLocator('#extension-overlay').getByText('Nonsecret overlay test.', { exact: false }).waitFor();
  const conflicted: any = await engine.control('local-profile', 'resume');
  assert.equal(conflicted.code, 'BROWSER_CONTROL_REQUIRED');
  assert.equal(conflicted.control.owner, 'human');
  assert.equal(await page.locator('#extension-overlay').count(), 1);
  await page.locator('#extension-overlay').evaluate((frame: HTMLElement) => frame.remove());
  console.log('STEP: Resuming');
  const resumed: any = await engine.control('local-profile', 'resume');
  assert.equal(resumed.code, undefined, JSON.stringify(resumed));
  const handback: any = await engine.act({ operationId: 'browser-handback', recipe: 'save-profile', input: { name: 'Lin' } });
  assert.equal(handback.operation.state, 'verified', JSON.stringify(handback));
  assert.equal(handback.operation.actions, 0);
  console.log('STEP: Browser request');
  const request: any = await engine.act({ operationId: 'browser-request', recipe: 'save-browser-request', input: { name: 'Grace' } });
  assert.equal(request.operation.state, 'verified', JSON.stringify(request));
  assert.equal(request.operation.actions, 1);
  assert.equal((await (await fetch(fixture.origin + '/api/profile')).json()).saveCount, 3);
  // Closing the operator must leave the existing tab open.
  await engine.close(); engine = undefined;
  assert(!page.isClosed());
  const evidence = { date: new Date().toISOString(), browser: context.browser().version(),
    ui: 'verified', trustedInput: true, userActivation: true, duplicateSavePrevented: true,
    debuggerDetachVerified: true, humanOwnershipSurvivedRestart: true,
    handbackActions: 0, browserRequestActions: 1, existingTabPreserved: true,
    crossExtensionOverlayPreserved: true, sessionCookieAndCsrf: true,
    passwordManagerQualified: false, elapsedMs: Math.round(performance.now() - started) };
  mkdirSync('work', { recursive: true });
  writeFileSync('work/browser-evidence.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await engine?.close();
  await context?.close();
  relay.close();
  await fixture.close();
  rmSync(scratch, { recursive: true, force: true });
}
