import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@xmorse/playwright-core';
import { createFixtureServer } from '../fixtures/server.ts';
import { validateConfig } from '../src/config.ts';
import { OperatorError } from '../src/contracts.ts';
import { createEngine } from '../src/runtime.ts';

const trials = 7;
const scratch = mkdtempSync(join(tmpdir(), 'gallium-bench-profile-'));
const profile = await createFixtureServer({ port: 0 });
const unconfigured = await createFixtureServer({ port: 0 });
const socket = createServer();
await new Promise<void>((ok, reject) => socket.once('error', reject).listen(0, '127.0.0.1', ok));
const address = socket.address();
assert.ok(address && typeof address !== 'string');
const relayPort = address.port;
await new Promise<void>((ok, reject) => socket.close(error => error ? reject(error) : ok()));

// The disposable bridge and relay use the same private port. The normal
// build and any existing Chrome profile keep their original relay.
process.env.PLAYWRITER_PORT = String(relayPort);
const { startPlayWriterCDPRelayServer, listBrowsers } = await import('playwriter');
let relay: Awaited<ReturnType<typeof startPlayWriterCDPRelayServer>> | undefined;
let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
let engine: Awaited<ReturnType<typeof createEngine>> | undefined;

try {
  const extensionPath = join(scratch, 'extension');
  cpSync(resolve('dist/extension'), extensionPath, { recursive: true });
  const backgroundPath = join(extensionPath, 'background.js');
  const background = readFileSync(backgroundPath, 'utf8');
  const relaySetting = 'const RELAY_PORT = Number("19988") || 19988;';
  assert.equal(background.split(relaySetting).length, 2, 'Build the Gallium bridge with npm run build:extension.');
  writeFileSync(backgroundPath, background.replace(relaySetting, 'const RELAY_PORT = ' + relayPort + ';'));
  relay = await startPlayWriterCDPRelayServer({ port: relayPort, host: '127.0.0.1', logger: { log() {}, error() {} } });
  context = await chromium.launchPersistentContext(join(scratch, 'chrome'), {
    executablePath: process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true, ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'],
  });
  context.setDefaultTimeout(10000);
  const browser = context.browser()!;
  const cdp = await browser.newBrowserCDPSession();
  const extension = await cdp.send('Extensions.loadUnpacked', { path: extensionPath });
  const worker = context.serviceWorkers().find(worker => worker.url().includes(extension.id))
    ?? await context.waitForEvent('serviceworker', { predicate: worker => worker.url().includes(extension.id) });
  const page = await context.newPage();
  const fallbackPage = await context.newPage();
  await page.goto(profile.origin + '/profile');
  await fallbackPage.goto(unconfigured.origin + '/profile');
  await page.bringToFront();
  await worker.evaluate(async () => (globalThis as any).toggleExtensionForActiveTab());
  const browsers = await listBrowsers({ port: relayPort, logger: { log() {} } });
  assert.equal(browsers.length, 1, 'Expected one disposable Chrome bridge.');

  const template = JSON.parse(readFileSync('examples/browser.config.json', 'utf8').replaceAll('http://127.0.0.1:8787', profile.origin));
  template.stateDir = join(scratch, 'state');
  template.playwriter.preserveExtensionsVerified = true; // isolated benchmark bridge
  template.playwriter.browserId = browsers[0].id;
  template.scopes.push({ id: 'unconfigured-profile', origin: unconfigured.origin, account: 'demo-user' });
  template.recipes.push({
    ...structuredClone(template.recipes[0]),
    id: 'save-browser-request',
    description: 'Save the supplied profile name using the configured signed-in session API.',
    adapter: 'browser-request',
    http: {
      url: profile.origin + '/api/session-profile', verifyUrl: profile.origin + '/api/session-profile',
      method: 'POST', effect: 'write', inputKeys: ['name'], accountPath: 'account',
      goalPath: 'name', expectedInputKey: 'name', idempotencyHeader: 'Idempotency-Key',
    },
  });
  template.recipes[1].browser.csrf = { selector: 'meta[name="fixture-csrf"]', attribute: 'content', header: 'X-Fixture-CSRF' };
  assert.equal((await fetch(profile.origin + '/api/session-profile')).status, 401);
  if (process.argv.includes('--jev')) {
    const legacy = join(homedir(), '.config/web-operator/config.json');
    const path = process.env.GALLIUM_CONFIG || process.env.WEB_OPERATOR_CONFIG ||
      (existsSync(legacy) ? legacy : join(homedir(), '.config/gallium/config.json'));
    const router = JSON.parse(readFileSync(path, 'utf8')).taskRouter;
    assert.ok(router?.provider === 'typesafe' && router.endpoint === 'https://openrouter.ai/api/v1/systemone',
      'The configured OpenRouter Jev router is required for --jev.');
    template.taskRouter = router;
  }
  const config = validateConfig(template);
  const operator = engine = await createEngine(config);

  async function saveWithChrome(target: typeof page, name: string) {
    await target.locator('#name').fill(name);
    await target.locator('#save').click();
    await target.locator('[data-saved-name]').filter({ hasText: name }).waitFor();
  }

  async function saveWithRecipe(recipe: string, name: string, operationId: string, actions: number) {
    const result = await operator.act({ operationId, recipe, input: { name } });
    const operation = result.operation as { state: string; actions: number };
    assert.equal(operation.state, 'verified');
    assert.equal(operation.actions, actions);
  }

  const paths: { id: string; fallback?: boolean; run(name: string, operationId: string): Promise<void> }[] = [
    { id: 'chrome', run: name => saveWithChrome(page, name) },
    { id: 'playwriter', run: (name, id) => saveWithRecipe('save-profile', name, id, 2) },
    { id: 'browser-request', run: (name, id) => saveWithRecipe('save-browser-request', name, id, 1) },
    { id: 'chrome-unconfigured', fallback: true, run: name => saveWithChrome(fallbackPage, name) },
    { id: 'host-fallback', fallback: true, run: async (name, id) => {
      const result = await operator.task({ operationId: id, goal: 'Save the supplied profile name.', scopeId: 'unconfigured-profile', input: { name } });
      assert.equal(result.code, 'CAPABILITY_REQUIRED');
      await saveWithChrome(fallbackPage, name);
    } },
  ];
  const jevRoutes = new Set<unknown>();
  if (config.taskRouter) paths.push({ id: 'jev', run: async (name, id) => {
    const result = await operator.task({ operationId: id, goal: 'Save the supplied display name for this profile.', scopeId: 'local-profile', input: { name } });
    const operation = result.operation as { state: string } | undefined;
    if (operation?.state !== 'verified') throw new OperatorError(String(result.code ?? 'UNVERIFIED'), 'Jev did not return a verified save.');
    jevRoutes.add(result.route);
  } });

  const samples = Object.fromEntries(paths.map(path => [path.id, { milliseconds: [] as number[], errors: [] as string[] }]));
  for (let round = -1; round < trials; round++) {
    const offset = (round + 1) % paths.length;
    for (const path of [...paths.slice(offset), ...paths.slice(0, offset)]) {
      const origin = path.fallback ? unconfigured.origin : profile.origin;
      const tab = path.fallback ? fallbackPage : page;
      const id = 'bench-' + path.id + '-' + (round + 1);
      const name = 'Fixture ' + id;
      await tab.reload();
      await tab.locator('#name').waitFor();
      const before = await fetch(origin + '/api/profile').then(response => response.json());
      const started = performance.now();
      try {
        await path.run(name, id);
        const after = await fetch(origin + '/api/profile').then(response => response.json());
        assert.equal(after.name, name, 'saved name');
        assert.equal(after.saveCount, before.saveCount + 1, 'one save');
        assert.equal(after.postCount, before.postCount + 1, 'one write');
        if (round >= 0) samples[path.id].milliseconds.push(performance.now() - started);
      } catch (error) {
        if (path.id !== 'jev') throw error;
        samples.jev.errors.push(error instanceof OperatorError ? error.code : 'BENCHMARK_FAILED');
      }
    }
  }
  const result = {
    date: new Date().toISOString().slice(0, 10),
    browser: browser.version(), node: process.version, trials,
    paths: Object.fromEntries(Object.entries(samples).map(([id, sample]) => {
      const sorted = sample.milliseconds.toSorted((a, b) => a - b);
      const middle = Math.floor(sorted.length / 2);
      const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
      return [id, {
        verified: sorted.length, medianMs: Number.isFinite(median) ? Math.round(median * 10) / 10 : null,
        errors: sample.errors,
      }];
    })),
    jevRoutes: [...jevRoutes],
    modelUsage: operator.journal.db.prepare('SELECT count(*) AS calls, sum(cost) AS reportedCost FROM model_usage').get(),
  };
  mkdirSync('work/task-bench', { recursive: true });
  writeFileSync('work/task-bench/profile.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally {
  await engine?.close();
  await context?.close();
  relay?.close();
  await profile.close();
  await unconfigured.close();
  rmSync(scratch, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
}
