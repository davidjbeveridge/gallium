import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Engine } from '../src/engine.ts';
import { FixtureAdapter } from '../src/adapters/fixture.ts';
import { OperatorError } from '../src/contracts.ts';
import type { Adapter, Candidate, Config, Decision, Navigator, Observation, Operation, Verification } from '../src/contracts.ts';

const request = { operationId: 'op-one', recipe: 'set-name', input: { name: 'Grace' } };
const deterministic: Navigator = {
  name: 'deterministic',
  async choose({ observation }) { return observation.candidates.length ? { type: 'act', candidateId: observation.candidates[0].id } : { type: 'done' }; },
};

function setup(t: any) {
  const stateDir = mkdtempSync(join(tmpdir(), 'web-operator-engine-'));
  const config: Config = {
    version: 1, stateDir,
    scopes: [{ id: 'fixture', origin: 'https://fixture.invalid', account: 'fixture-user' }],
    recipes: [{ id: 'set-name', scopeId: 'fixture', description: 'Set a fake profile name', adapter: 'fixture', inputs: { name: 'string' }, maxActions: 6 }],
    navigators: { deterministic: { provider: 'deterministic' } },
  };
  const fixtures = new FixtureAdapter(stateDir, config.scopes);
  const engines = new Set<Engine>();
  function build(adapter: Adapter = fixtures, navigator: Navigator = deterministic): Engine {
    const engine = new Engine(config, { fixture: adapter }, { deterministic: navigator });
    engines.add(engine);
    return engine;
  }
  async function close(engine: Engine) { await engine.close(); engines.delete(engine); }
  t.after(async () => {
    for (const engine of engines) await engine.close();
    rmSync(stateDir, { recursive: true, force: true });
  });
  return { config, fixtures, build, close, stateDir };
}

function pausedNavigator() {
  const entered = Promise.withResolvers<void>();
  const result = Promise.withResolvers<Decision>();
  const navigator: Navigator = {
    name: 'slow-test-navigator',
    async choose() { entered.resolve(); return result.promise; },
  };
  return { entered: entered.promise, release: result.resolve, navigator };
}

function snapshot(): Observation {
  return {
    id: randomUUID(), documentId: 'document-1', scopeId: 'fixture', origin: 'https://fixture.invalid', account: 'fixture-user',
    summary: 'A fake application', facts: {}, capturedAt: Date.now(),
    candidates: [{ id: 'save', kind: 'click', label: 'Save', effect: 'write' }],
  };
}

function simpleAdapter(options: {
  observe?: () => Promise<Observation>;
  execute?: () => Promise<void>;
  verify?: () => Promise<Verification>;
} = {}): Adapter {
  return {
    name: 'fixture',
    observe: options.observe ?? (async () => snapshot()),
    execute: options.execute ?? (async () => {}),
    verify: options.verify ?? (async () => ({ state: 'not_satisfied', code: 'TEST_UNMET' })),
  };
}

test('the working slice verifies two actions, reports released control, and does not repeat completed work', async t => {
  const { fixtures, build } = setup(t);
  const engine = build();
  const first: any = await engine.act(request);
  assert.equal(first.operation.state, 'verified');
  assert.equal(first.operation.actions, 2);
  assert.equal(fixtures.inspect('fixture').saveCount, 1);
  assert.equal(first.control.phase, 'ready');
  const replay: any = await engine.act(request);
  assert.equal(replay.code, 'ALREADY_VERIFIED');
  assert.equal(fixtures.inspect('fixture').saveCount, 1);
});

test('a decision arriving after user takeover cannot type or save', async t => {
  const { fixtures, build } = setup(t);
  const slow = pausedNavigator();
  t.after(() => slow.release({ type: 'done' }));
  const engine = build(fixtures, slow.navigator);
  const active = engine.act(request);
  await slow.entered;
  const pausing = engine.control('fixture', 'pause');
  slow.release({ type: 'act', candidateId: 'fixture.type' });
  const [result, handoff]: any[] = await Promise.all([active, pausing]);
  assert.equal(fixtures.inspect('fixture').draft, '');
  assert.equal(fixtures.inspect('fixture').saveCount, 0);
  assert.equal(result.operation.state, 'paused');
  assert.equal(result.operation.actions, 0);
  assert.equal(result.control.phase, 'handed_off');
  assert.equal(handoff.control.phase, 'handed_off');
});

test('human ownership survives restart and never expires into agent control', async t => {
  const { fixtures, build, close } = setup(t);
  const first = build();
  await first.control('fixture', 'pause');
  await close(first);
  const restarted = build();
  const result: any = await restarted.act(request);
  assert.equal(result.code, 'PAUSED');
  assert.equal(result.control.owner, 'human');
  assert.equal(result.control.phase, 'handed_off');
  await assert.rejects(restarted.read('set-name', request.input), { code: 'PAUSED' });
  assert.equal(fixtures.inspect('fixture').saveCount, 0);
});

test('handback verifies a goal already completed by the user before deciding or writing', async t => {
  const { config, fixtures, build } = setup(t);
  let decisions = 0;
  const engine = build(fixtures, { name: 'should-not-run', async choose() { decisions++; return { type: 'done' }; } });
  await engine.control('fixture', 'pause');
  await engine.act(request);
  fixtures.humanSet({ id: request.operationId, recipe: config.recipes[0], input: request.input });
  await engine.control('fixture', 'resume');
  const result: any = await engine.act(request);
  assert.equal(result.operation.state, 'verified');
  assert.equal(result.operation.actions, 0);
  assert.equal(decisions, 0);
  assert.equal(fixtures.inspect('fixture').saveCount, 1);
});

test('a timed-out write remains uncertain across restart and does not dispatch again', async t => {
  const { build, close } = setup(t);
  let writes = 0;
  let completed = false;
  const adapter = simpleAdapter({
    async execute() { writes++; throw new OperatorError('REQUEST_TIMEOUT', 'No response arrived.', false); },
    async verify() { return { state: completed ? 'satisfied' : 'not_satisfied', code: 'TEST_VERIFIER' }; },
  });
  const first = build(adapter);
  const uncertain: any = await first.act(request);
  assert.equal(uncertain.operation.state, 'unknown');
  assert.equal(uncertain.operation.effect, 'unknown');
  assert.equal(writes, 1);
  await close(first);
  const restarted = build(adapter);
  const retry: any = await restarted.act(request);
  assert.equal(retry.operation.state, 'unknown');
  assert.equal(retry.operation.last_code, 'RECONCILIATION_REQUIRED');
  assert.equal(writes, 1);
  completed = true;
  const reconciled: any = await restarted.act(request);
  assert.equal(reconciled.operation.state, 'verified');
  assert.equal(writes, 1);
});

test('a different operation cannot evade an unresolved write in the same authentication context', async t => {
  const { build } = setup(t);
  let writes = 0;
  const engine = build(simpleAdapter({ async execute() { writes++; throw new OperatorError('TIMEOUT', 'Uncertain write', false); } }));
  await engine.act(request);
  const result: any = await engine.act({ ...request, operationId: 'op-two' });
  assert.equal(result.operation.last_code, 'SCOPE_RECONCILIATION_REQUIRED');
  assert.equal(result.unresolvedOperationId, 'op-one');
  assert.equal(writes, 1);
});

test('one operation ID cannot be reused for different inputs, even before a business write', async t => {
  const { build, fixtures } = setup(t);
  const engine = build();
  await engine.act({ ...request, maxActions: 1 });
  assert.equal(fixtures.inspect('fixture').saveCount, 0);
  await assert.rejects(engine.act({ ...request, input: { name: 'Ada' } }), { code: 'OPERATION_CONFLICT' });
});

test('an unobserved candidate cannot be executed', async t => {
  const { build, fixtures } = setup(t);
  const engine = build(fixtures, { name: 'invalid', async choose() { return { type: 'act', candidateId: 'fabricated-target' }; } });
  const result: any = await engine.act(request);
  assert.equal(result.operation.state, 'needs_supervisor');
  assert.equal(result.operation.last_code, 'INVALID_CANDIDATE');
  assert.equal(result.operation.actions, 0);
  assert.equal(fixtures.inspect('fixture').draft, '');
});

test('navigator DONE does not establish business completion', async t => {
  const { build, fixtures } = setup(t);
  const engine = build(fixtures, { name: 'optimistic', async choose() { return { type: 'done' }; } });
  const result: any = await engine.act(request);
  assert.equal(result.operation.state, 'needs_supervisor');
  assert.equal(result.operation.last_code, 'UNVERIFIED_DONE');
  assert.equal(fixtures.inspect('fixture').saveCount, 0);
});

test('an observed account mismatch hands control to the user without acting', async t => {
  const { build } = setup(t);
  let writes = 0;
  const engine = build(simpleAdapter({
    async observe() { return { ...snapshot(), account: 'different-account' }; },
    async execute() { writes++; },
  }));
  const result: any = await engine.act(request);
  assert.equal(result.operation.last_code, 'USER_CONTROL');
  assert.equal(result.control.owner, 'human');
  assert.equal(writes, 0);
});

test('separate workers serialize one context while independent configured contexts can proceed', async t => {
  const { config, build, stateDir } = setup(t);
  config.scopes.push({ id: 'second', origin: 'https://second.invalid', account: 'second-user' });
  config.recipes.push({ ...config.recipes[0], id: 'set-second', scopeId: 'second' });
  const fixtures = new FixtureAdapter(stateDir, config.scopes);
  const slow = pausedNavigator();
  t.after(() => slow.release({ type: 'done' }));
  const first = build(fixtures, slow.navigator);
  const second = build(fixtures);
  const active = first.act(request);
  await slow.entered;
  await assert.rejects(second.act({ ...request, operationId: 'competing' }), { code: 'BUSY' });
  const independent: any = await second.act({ ...request, operationId: 'independent', recipe: 'set-second' });
  assert.equal(independent.operation.state, 'verified');
  assert.equal(fixtures.inspect('second').saveCount, 1);
  slow.release({ type: 'done' });
  await active;
});

test('journal does not persist supplied business values or complete page content', async t => {
  const { build, stateDir } = setup(t);
  const engine = build();
  const name = 'UNIQUE_PRIVATE_VALUE_9fd073f5';
  await engine.act({ ...request, input: { name } });
  const files = readdirSync(stateDir).filter(file => file.startsWith('journal.'));
  for (const file of files) assert(!readFileSync(join(stateDir, file)).includes(Buffer.from(name)));
});

test('cancel preserves a possible write, and explicit resume still requires reconciliation', async t => {
  const { build } = setup(t);
  let writes = 0;
  const engine = build(simpleAdapter({ async execute() { writes++; throw new OperatorError('TIMEOUT', 'Uncertain write', false); } }));
  await engine.act(request);
  await engine.control('fixture', 'cancel');
  await engine.control('fixture', 'resume');
  const result: any = await engine.act(request);
  assert.equal(result.operation.state, 'unknown');
  assert.equal(result.operation.cancel_requested, 1);
  assert.equal(writes, 1);
});

test('handoff stays quiescing until the adapter releases input ownership', async t => {
  const { build, fixtures } = setup(t);
  const releaseStarted = Promise.withResolvers<void>();
  const releaseAllowed = Promise.withResolvers<void>();
  t.after(() => releaseAllowed.resolve());
  const adapter: Adapter = {
    name: 'fixture', observe: fixtures.observe.bind(fixtures), execute: fixtures.execute.bind(fixtures), verify: fixtures.verify.bind(fixtures),
    async release() { releaseStarted.resolve(); await releaseAllowed.promise; },
  };
  const engine = build(adapter);
  const active = engine.act(request);
  await releaseStarted.promise;
  const handoff = engine.control('fixture', 'pause');
  const during: any = engine.status('fixture');
  assert.equal(during.controls[0].phase, 'quiescing');
  assert.equal(during.controls[0].owner, 'human');
  await assert.rejects(engine.read('set-name', request.input), { code: 'PAUSED' });
  releaseAllowed.resolve();
  const [completed, paused]: any[] = await Promise.all([active, handoff]);
  assert.equal(completed.control.phase, 'handed_off');
  assert.equal(paused.control.phase, 'handed_off');
});

test('takeover through a different worker fences a late model response', async t => {
  const { build, fixtures } = setup(t);
  const slow = pausedNavigator();
  t.after(() => slow.release({ type: 'done' }));
  const browserWorker = build(fixtures, slow.navigator);
  const controlWorker = build();
  const active = browserWorker.act(request);
  await slow.entered;
  const takeover = controlWorker.control('fixture', 'pause');
  slow.release({ type: 'act', candidateId: 'fixture.type' });
  await Promise.all([active, takeover]);
  assert.equal(fixtures.inspect('fixture').draft, '');
  assert.equal(fixtures.inspect('fixture').saveCount, 0);
  assert.equal(browserWorker.journal.control('fixture').owner, 'human');
});

test('an expired orphan lease still needs explicit handback before work can resume', async t => {
  const { build } = setup(t);
  const engine = build();
  engine.journal.acquire('fixture', 'orphan-worker', 1);
  await delay(10);
  await assert.rejects(engine.read('set-name', request.input), { code: 'STALE_LEASE' });
  await engine.control('fixture', 'resume');
  const result: any = await engine.read('set-name', request.input);
  assert.equal(result.observation.account, 'fixture-user');
});

test('rate limit state fences other operations in the same context', async t => {
  const { build } = setup(t);
  let verifications = 0;
  const error = new OperatorError('RATE_LIMITED', 'Service requested cooldown.');
  error.retryAfterMs = 60_000;
  const engine = build(simpleAdapter({ async verify() { verifications++; throw error; } }));
  const first: any = await engine.act(request);
  assert.equal(first.operation.last_code, 'RATE_LIMITED');
  await assert.rejects(engine.act({ ...request, operationId: 'other-during-cooldown' }), { code: 'RATE_LIMITED' });
  assert.equal(verifications, 1);
});

test('a definite rejection before an effect may be retried without becoming an unknown write', async t => {
  const { build } = setup(t);
  let attempts = 0;
  let complete = false;
  const engine = build(simpleAdapter({
    async execute() {
      attempts++;
      if (attempts === 1) throw new OperatorError('STALE_OBSERVATION', 'A local precondition failed before dispatch.');
      complete = true;
    },
    async verify() { return { state: complete ? 'satisfied' : 'not_satisfied', code: 'TEST_VERIFIER' }; },
  }));
  const rejected: any = await engine.act(request);
  assert.equal(rejected.operation.effect, 'none');
  assert.equal(rejected.operation.state, 'needs_supervisor');
  const retry: any = await engine.act(request);
  assert.equal(retry.operation.state, 'verified');
  assert.equal(attempts, 2);
});
