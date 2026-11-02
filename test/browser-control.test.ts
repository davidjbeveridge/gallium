import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Engine } from '../src/engine.ts';
import type { Adapter, Config } from '../src/contracts.ts';

test('unverified browser detach stays visible across restart and failed resume retains human ownership', async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'operator-browser-control-'));
  const config: Config = { version: 1, stateDir, scopes: [{ id: 'browser', origin: 'https://fixture.invalid', account: 'demo' }],
    recipes: [{ id: 'save', scopeId: 'browser', adapter: 'playwriter', description: 'Save', inputs: {} }], navigators: {} };
  const adapter: Adapter = { name: 'playwriter', async observe() { throw new Error('Must not observe'); }, async execute() {},
    async verify() { return { state: 'not_satisfied', code: 'UNMET' }; }, async control() { throw new Error('Bridge unavailable'); } };
  let engine = new Engine(config, { playwriter: adapter }, {});
  try {
    const result: any = await engine.control('browser', 'pause');
    assert.equal(result.code, 'BROWSER_CONTROL_REQUIRED');
    assert.equal(result.control.phase, 'detach_required');
    await engine.close(); engine = new Engine(config, { playwriter: adapter }, {});
    assert.equal((engine.status().controls as any[])[0].phase, 'detach_required');
    const resumed: any = await engine.control('browser', 'resume');
    assert.equal(resumed.control.owner, 'human');
    assert.equal((await engine.act({ operationId: 'one', recipe: 'save', input: {} })).code, 'PAUSED');
  } finally { await engine.close(); rmSync(stateDir, { recursive: true, force: true }); }
});

test('resume does not grant execution while browser reattachment is pending', async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'operator-resume-'));
  const config: Config = { version: 1, stateDir, scopes: [{ id: 'browser', origin: 'https://fixture.invalid', account: 'demo' }],
    recipes: [{ id: 'save', scopeId: 'browser', adapter: 'playwriter', description: 'Save', inputs: {} }], navigators: {} };
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const adapter: Adapter = { name: 'playwriter', async observe() { throw new Error('Must not observe'); }, async execute() {},
    async verify() { return { state: 'not_satisfied', code: 'UNMET' }; }, async control(_scope, action) { if (action === 'resume') { entered(); await pending; } } };
  const engine = new Engine(config, { playwriter: adapter }, {});
  try {
    await engine.control('browser', 'pause');
    const resuming = engine.control('browser', 'resume');
    await started;
    assert.equal((await engine.act({ operationId: 'one', recipe: 'save', input: {} })).code, 'PAUSED');
    release();
    assert.equal(((await resuming).control as any).owner, 'agent');
  } finally { release(); await engine.close(); rmSync(stateDir, { recursive: true, force: true }); }
});
