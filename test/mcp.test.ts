import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import type { ServerResponse } from 'node:http';
import type { Config } from '../src/contracts.ts';

const executable = fileURLToPath(new URL('../src/mcp.ts', import.meta.url));
const configuration = (stateDir: string): Config => ({
  version: 1, stateDir, sharedService: false,
  scopes: [{ id: 'fixture', origin: 'https://fixture.invalid', account: 'demo-user' }],
  recipes: [{ id: 'set-name', scopeId: 'fixture', description: 'Save the supplied profile name.', adapter: 'fixture', inputs: { name: 'string' } }],
  navigators: { deterministic: { provider: 'deterministic' } },
});

function fixtureConfig(directory: string, customize?: (config: Config) => void): string {
  const config = configuration(join(directory, 'state'));
  customize?.(config);
  const path = join(directory, 'config.json');
  writeFileSync(path, JSON.stringify(config));
  return path;
}

function start(config: string, environment: Record<string, string> = {}) {
  const child = spawn(process.execPath, [executable, '--config', config], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...environment } });
  let nextId = 1;
  let stdout = '';
  let stderr = '';
  let ended = false;
  const pending = new Map<string | number | null, { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  const unexpected: any[] = [];
  const exit = new Promise<void>(done => child.on('exit', () => { ended = true; done(); }));
  child.stderr.setEncoding('utf8').on('data', text => { stderr += text; });
  child.stdout.setEncoding('utf8').on('data', text => {
    stdout += text;
    while (stdout.includes('\n')) {
      const end = stdout.indexOf('\n');
      const line = stdout.slice(0, end); stdout = stdout.slice(end + 1);
      let message: any;
      try { message = JSON.parse(line); } catch { assert.fail('MCP stdout contained non-JSON output.'); }
      const waiting = pending.get(message.id);
      if (waiting) { clearTimeout(waiting.timer); pending.delete(message.id); waiting.resolve(message); }
      else unexpected.push(message);
    }
  });
  child.on('error', error => { for (const value of pending.values()) { clearTimeout(value.timer); value.reject(error); } pending.clear(); });
  child.on('exit', () => {
    for (const value of pending.values()) { clearTimeout(value.timer); value.reject(new Error('MCP child exited: ' + stderr)); }
    pending.clear();
  });
  const wait = (id: string | number | null) => new Promise<any>((resolve, reject) => {
    const found = unexpected.findIndex(message => message.id === id);
    if (found >= 0) { resolve(unexpected.splice(found, 1)[0]); return; }
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('MCP response timed out. ' + stderr)); }, 6000);
    pending.set(id, { resolve, reject, timer });
  });
  const begin = (method: string, params?: unknown) => {
    const id = nextId++;
    const response = wait(id);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) }) + '\n');
    return { id, response };
  };
  const call = (method: string, params?: unknown) => begin(method, params).response;
  const notify = (method: string, params?: unknown) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) }) + '\n');
  const initialize = async (protocolVersion = '2025-11-25') => {
    const response = await call('initialize', { protocolVersion, capabilities: {}, clientInfo: { name: 'fixture-test', version: '1' } });
    assert.ok(response.result);
    notify('notifications/initialized');
    return response.result;
  };
  const tool = async (name: string, args: unknown = {}) => (await call('tools/call', { name, arguments: args }));
  const stop = async () => {
    if (ended) return;
    child.stdin.end();
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([exit, new Promise<void>(done => { timer = setTimeout(() => { child.kill('SIGKILL'); done(); }, 2000); })]);
    if (timer) clearTimeout(timer);
    await exit;
  };
  return { child, begin, call, tool, notify, initialize, stop, wait, stderr: () => stderr };
}

function decoded(response: any): any {
  assert.ok(response.result, JSON.stringify(response));
  return response.result.structuredContent ?? JSON.parse(response.result.content[0].text);
}

test('real MCP child negotiates its protocol and exposes task routing and control tools', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'web-operator-mcp-'));
  const client = start(fixtureConfig(directory));
  t.after(async () => { await client.stop(); rmSync(directory, { recursive: true, force: true }); });
  const initial = await client.initialize();
  assert.equal(initial.protocolVersion, '2025-11-25');
  assert.deepEqual(initial.capabilities, { tools: {} });
  const listing = await client.call('tools/list');
  assert.deepEqual(listing.result.tools.map((tool: any) => tool.name), ['web_task', 'web_read', 'web_act', 'web_status', 'web_control']);
  assert.ok(listing.result.tools.every((tool: any) => tool.inputSchema.additionalProperties === false));
  assert.deepEqual((await client.call('ping')).result, {});
});

test('MCP fixture read/act verifies the business result and preserves operation identity', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'web-operator-mcp-'));
  const client = start(fixtureConfig(directory));
  t.after(async () => { await client.stop(); rmSync(directory, { recursive: true, force: true }); });
  await client.initialize();
  const before = decoded(await client.tool('web_read', { recipe: 'set-name', input: { name: 'Alice' } }));
  assert.equal(before.pageContentTrust, 'untrusted');
  assert.equal(before.observation.account, 'demo-user');
  assert.equal(before.observation.candidates[0].id, 'fixture.type');
  const operation = { operationId: 'mcp-save', recipe: 'set-name', input: { name: 'Alice' } };
  const acted = decoded(await client.tool('web_act', operation));
  assert.equal(acted.operation.state, 'verified');
  const repeated = decoded(await client.tool('web_act', operation));
  assert.equal(repeated.code, 'ALREADY_VERIFIED');
  const after = decoded(await client.tool('web_read', { recipe: 'set-name', input: { name: 'Alice' } }));
  assert.equal(after.observation.facts.saveCount, 1);
  const conflict = await client.tool('web_act', { ...operation, input: { name: 'Bob' } });
  assert.equal(conflict.result.isError, true);
  assert.ok(decoded(conflict).error.code);
});

test('human ownership survives MCP restart and requires explicit handback', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'web-operator-mcp-'));
  const path = fixtureConfig(directory);
  const first = start(path);
  let second: ReturnType<typeof start> | undefined;
  t.after(async () => { await first.stop(); await second?.stop(); rmSync(directory, { recursive: true, force: true }); });
  await first.initialize();
  const paused = decoded(await first.tool('web_control', { scopeId: 'fixture', action: 'pause' }));
  assert.equal(paused.control.owner, 'human');
  assert.equal(paused.control.phase, 'handed_off');
  await first.stop();
  second = start(path);
  await second.initialize();
  const status = decoded(await second.tool('web_status'));
  assert.equal(status.controls[0].owner, 'human');
  const operation = { operationId: 'after-handoff', recipe: 'set-name', input: { name: 'Alice' } };
  assert.equal(decoded(await second.tool('web_act', operation)).code, 'PAUSED');
  assert.equal((await second.tool('web_read', { recipe: 'set-name', input: { name: 'Alice' } })).result.isError, true);
  await second.tool('web_control', { scopeId: 'fixture', action: 'resume' });
  assert.equal(decoded(await second.tool('web_act', operation)).operation.state, 'verified');
});

test('MCP rejects unknown arguments and sanitizes operational failures', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'web-operator-mcp-'));
  const client = start(fixtureConfig(directory));
  t.after(async () => { await client.stop(); rmSync(directory, { recursive: true, force: true }); });
  assert.equal((await client.call('tools/list')).error.code, -32002);
  await client.initialize();
  for (const [name, args] of [
    ['web_status', { unknown: 'secret-marker' }], ['web_status', null],
    ['web_act', { operationId: 'x', recipe: 'set-name', input: { name: 'Alice' }, maxActions: 999 }],
    ['web_act', { operationId: 'x', recipe: 'set-name', input: { name: 'Alice' }, authorized: true }],
    ['web_control', { scopeId: 'fixture', action: 'infer_resume' }], ['unknown_tool', {}],
  ] as const) {
    const response = await client.tool(name, args);
    assert.equal(response.error.code, -32602);
    assert.ok(!JSON.stringify(response).includes('secret-marker'));
  }
  const failure = await client.tool('web_read', { recipe: 'not-configured', input: {} });
  assert.equal(failure.result.isError, true);
  assert.equal(decoded(failure).error.code, 'UNKNOWN_RECIPE');
  assert.ok(!JSON.stringify(failure).includes('stack'));
  assert.equal((await client.call('unsupported/method')).error.code, -32601);
});

test('MCP parser recovers from malformed JSON and bounds an unterminated line', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'web-operator-mcp-'));
  const client = start(fixtureConfig(directory));
  t.after(async () => { await client.stop(); rmSync(directory, { recursive: true, force: true }); });
  await client.initialize();
  const badJson = client.wait(null);
  client.child.stdin.write('{not-json}\n');
  assert.equal((await badJson).error.code, -32700);
  assert.deepEqual((await client.call('ping')).result, {});
  const tooLarge = client.wait(null);
  client.child.stdin.write('x'.repeat(128 * 1024 + 1));
  assert.equal((await tooLarge).error.code, -32600);
});

test('MCP supports legacy protocol output and falls back from an unknown version', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'web-operator-mcp-'));
  const path = fixtureConfig(directory);
  const legacy = start(path); const unknown = start(path);
  t.after(async () => { await legacy.stop(); await unknown.stop(); rmSync(directory, { recursive: true, force: true }); });
  assert.equal((await legacy.initialize('2024-11-05')).protocolVersion, '2024-11-05');
  const response = await legacy.tool('web_status');
  assert.ok(response.result.content);
  assert.equal(response.result.structuredContent, undefined);
  assert.equal((await unknown.initialize('future-version')).protocolVersion, '2025-11-25');
});

test('request cancellation and user pause both interrupt a pending navigator without dispatch', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'web-operator-mcp-'));
  const responses = new Set<ServerResponse>();
  let received = 0;
  const watchers: (() => void)[] = [];
  const provider = createServer((request, response) => {
    responses.add(response); response.on('close', () => responses.delete(response));
    request.resume();
    request.on('end', () => { received++; watchers.shift()?.(); });
  });
  await new Promise<void>(done => provider.listen(0, '127.0.0.1', done));
  const address = provider.address(); assert.ok(address && typeof address !== 'string');
  const path = fixtureConfig(directory, config => {
    config.navigators.slow = { provider: 'openai-compatible', model: 'fake', endpoint: `http://127.0.0.1:${address.port}/chat/completions`, apiKeyEnv: 'WEB_OPERATOR_MCP_TEST_KEY', timeoutMs: 5000 };
    config.recipes[0].navigator = 'slow';
  });
  const client = start(path, { WEB_OPERATOR_MCP_TEST_KEY: 'local-fixture-only' });
  t.after(async () => {
    await client.stop();
    for (const response of responses) response.destroy();
    provider.closeAllConnections();
    await new Promise<void>(done => provider.close(() => done()));
    rmSync(directory, { recursive: true, force: true });
  });
  const nextProviderRequest = (expected: number) => new Promise<void>((resolve, reject) => {
    if (received >= expected) { resolve(); return; }
    const timer = setTimeout(() => reject(new Error('The fake navigator did not receive a request.')), 3000);
    watchers.push(() => { clearTimeout(timer); resolve(); });
  });
  await client.initialize();
  const cancelled = client.begin('tools/call', { name: 'web_act', arguments: { operationId: 'cancelled', recipe: 'set-name', input: { name: 'Alice' } } });
  await nextProviderRequest(1);
  client.notify('notifications/cancelled', { requestId: cancelled.id });
  const cancelledResult = decoded(await cancelled.response);
  assert.equal(cancelledResult.operation.actions, 0);
  assert.notEqual(cancelledResult.operation.state, 'verified');
  assert.equal(decoded(await client.tool('web_status')).controls[0].owner, 'agent');
  const paused = client.begin('tools/call', { name: 'web_act', arguments: { operationId: 'paused', recipe: 'set-name', input: { name: 'Alice' } } });
  await nextProviderRequest(2);
  const control = decoded(await client.tool('web_control', { scopeId: 'fixture', action: 'pause' }));
  assert.equal(control.control.phase, 'handed_off');
  const pausedResult = decoded(await paused.response);
  assert.equal(pausedResult.operation.actions, 0);
  assert.equal(pausedResult.operation.state, 'paused');
});
