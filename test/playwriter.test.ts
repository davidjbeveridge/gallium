import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaywriterAdapter } from '../src/adapters/playwriter.ts';
import { OperatorError } from '../src/contracts.ts';
import type { Guard, Operation, ScopeConfig } from '../src/contracts.ts';

class FakeNode {
  tagName = 'BUTTON'; textContent = 'Save'; isConnected = true; isContentEditable = false;
  readOnly = false; disabled = false; multiple = false; visible = true;
  attributes: Record<string, string> = {}; options: any[] = []; onClick?: () => void;
  actions: string[] = [];
  constructor(properties: Partial<FakeNode> = {}) { Object.assign(this, properties); }
  getAttribute(key: string) { return this.attributes[key] ?? null; }
  closest() { return null; }
}
class FakeHandle {
  node: FakeNode; disposed = false;
  constructor(node: FakeNode) { this.node = node; }
  async evaluate(fn: Function, argument?: unknown) {
    return fn(this.node, argument instanceof FakeHandle ? argument.node : argument);
  }
  async isVisible() { return this.node.visible; }
  async isEnabled() { return !this.node.disabled; }
  async dispose() { this.disposed = true; }
  async click() { this.node.actions.push('click'); this.node.onClick?.(); }
  async press(key: string) { this.node.actions.push('press:' + key); }
  async type(value: string) { this.node.actions.push('type:' + value); }
  async boundingBox() { return { x: 0, y: 0, width: 10, height: 10 }; }
}
class FakePage {
  currentUrl = 'https://example.test/tasks'; closed = false; document = {};
  nodes = new Map<string, FakeNode[]>(); calls: string[] = [];
  mouse = {
    move: async () => { this.calls.push('move'); },
    wheel: async () => { this.calls.push('wheel'); },
  };
  url() { return this.currentUrl; }
  isClosed() { return this.closed; }
  locator(selector: string) {
    return {
      count: async () => this.nodes.get(selector)?.length ?? 0,
      elementHandle: async () => this.nodes.get(selector)?.[0] ? new FakeHandle(this.nodes.get(selector)![0]) : null,
    };
  }
  async evaluateHandle(fn: Function) {
    assert.equal(fn.name, 'documentReference');
    return { document: this.document, dispose: async () => {} };
  }
  async evaluate(fn: Function, argument: any) {
    assert.equal(fn.name, 'documentIsCurrent');
    return argument.document === this.document;
  }
}
const scopes: ScopeConfig[] = [{ id: 'work', origin: 'https://example.test', account: 'alice' }];
function operation(): Operation {
  return {
    id: 'save-1', input: { title: 'New title' },
    recipe: {
      id: 'save', scopeId: 'work', adapter: 'playwriter', description: 'Save one task', inputs: { title: 'string' },
      browser: {
        urlPrefix: 'https://example.test/tasks', account: { selector: '#account', text: 'alice' },
        goal: { selector: '#result', text: 'saved' },
        candidates: [{ id: 'save', kind: 'click', label: 'Save', effect: 'write', selector: '#save' }],
      },
    },
  };
}
function setup() {
  const page = new FakePage();
  const save = new FakeNode();
  page.nodes.set('#account', [new FakeNode({ tagName: 'SPAN', textContent: 'alice' })]);
  page.nodes.set('#save', [save]);
  save.onClick = () => page.nodes.set('#result', [new FakeNode({ tagName: 'DIV', textContent: 'saved' })]);
  const state = { connections: 0, closes: 0, options: undefined as any, pages: [page], epoch: 1 };
  const adapter = new PlaywriterAdapter({ preserveExtensionsVerified: true, browserId: 'profile-1' }, scopes, {
    connect: async (options) => {
      state.connections++;
      state.options = options;
      return { browser: { contexts: () => [{ pages: () => state.pages }] }, close: async () => { state.closes++; } };
    },
  });
  const controller = new AbortController();
  const guard: Guard = {
    epoch: 1, signal: controller.signal,
    assertCurrent: () => { if (state.epoch !== 1) throw new OperatorError('CONTROL_REVOKED', 'Control changed.'); },
  };
  return { adapter, page, save, state, controller, guard, op: operation() };
}

test('live attachment is gated before loading the SDK or touching a browser', async () => {
  let loaded = 0;
  const adapter = new PlaywriterAdapter({ preserveExtensionsVerified: false }, scopes, {
    loadModule: async () => { loaded++; throw new Error('Should not import'); },
  });
  const { guard } = setup();
  await assert.rejects(adapter.observe(operation(), guard), { code: 'EXTENSION_COMPATIBILITY_REQUIRED' });
  assert.equal(loaded, 0);
});

test('allowed click uses the existing tab and independent goal verification', async () => {
  const { adapter, state, save, op, guard } = setup();
  assert.equal((await adapter.verify(op, guard)).state, 'not_satisfied');
  const observation = await adapter.observe(op, guard);
  assert.deepEqual(observation.candidates, [{ id: 'save', kind: 'click', label: 'Save', effect: 'write' }]);
  await adapter.execute(op, observation.candidates[0], { ...guard, observation });
  assert.deepEqual(save.actions, ['click']);
  assert.equal((await adapter.verify(op, guard)).state, 'satisfied');
  assert.equal(state.options.closeTabsOnEnd, false);
  assert.equal(state.options.selectBrowser([{ id: 'other' }, { id: 'profile-1' }]).id, 'profile-1');
  await adapter.close();
  assert.equal(state.closes, 1);
  assert.equal(state.pages[0].closed, false);
});

test('a replacement node with identical attributes is rejected before effect', async () => {
  const { adapter, page, save, op, guard } = setup();
  const observation = await adapter.observe(op, guard);
  const replacement = new FakeNode();
  page.nodes.set('#save', [replacement]);
  await assert.rejects(adapter.execute(op, observation.candidates[0], { ...guard, observation }), { code: 'STALE_TARGET', beforeEffect: true });
  assert.deepEqual(save.actions, []);
  assert.deepEqual(replacement.actions, []);
  await adapter.close();
});

test('in-place changes to a target and document navigation invalidate the observation', async () => {
  const { adapter, page, save, op, guard } = setup();
  let observation = await adapter.observe(op, guard);
  save.textContent = 'Delete';
  await assert.rejects(adapter.execute(op, observation.candidates[0], { ...guard, observation }), { code: 'STALE_TARGET' });
  observation = await adapter.observe(op, guard);
  page.document = {};
  await assert.rejects(adapter.execute(op, observation.candidates[0], { ...guard, observation }), { code: 'STALE_TARGET' });
  assert.deepEqual(save.actions, []);
  await adapter.close();
});

test('wrong account blocks both execution and goal verification', async () => {
  const { adapter, page, save, op, guard } = setup();
  const observation = await adapter.observe(op, guard);
  page.nodes.get('#account')![0].textContent = 'bob';
  await assert.rejects(adapter.execute(op, observation.candidates[0], { ...guard, observation }), { code: 'ACCOUNT_MISMATCH' });
  await assert.rejects(adapter.verify(op, guard), { code: 'ACCOUNT_MISMATCH' });
  assert.deepEqual(save.actions, []);
  await adapter.close();
});

test('secret controls are excluded without reading any input value', async () => {
  const { adapter, page, op, guard } = setup();
  const privateNode = new FakeNode({ tagName: 'INPUT', attributes: { type: 'password' } });
  Object.defineProperty(privateNode, 'value', { get() { throw new Error('Secret read'); } });
  page.nodes.set('#password', [privateNode]);
  const otpNode = new FakeNode({ tagName: 'INPUT', attributes: { autocomplete: 'one-time-code' } });
  page.nodes.set('#otp', [otpNode]);
  const cardNode = new FakeNode({ tagName: 'INPUT', attributes: { autocomplete: 'cc-number' } });
  page.nodes.set('#card', [cardNode]);
  op.recipe.browser!.candidates = ['password', 'otp', 'card'].map((id) => ({
    id, kind: 'type', label: 'Private field', effect: 'ui', selector: '#' + id, inputKey: 'title',
  }));
  assert.deepEqual((await adapter.observe(op, guard)).candidates, []);
  assert.deepEqual(privateNode.actions, []);
  await adapter.close();
});

test('explicit text uses keyboard input, and empty text clears the field', async () => {
  const { adapter, page, op, guard } = setup();
  const input = new FakeNode({ tagName: 'INPUT', attributes: { type: 'text', name: 'title' } });
  Object.defineProperty(input, 'value', { get() { throw new Error('Input value read'); } });
  page.nodes.set('#title', [input]);
  op.recipe.browser!.candidates = [{ id: 'title', kind: 'type', label: 'Title', effect: 'ui', selector: '#title', inputKey: 'title' }];
  let observation = await adapter.observe(op, guard);
  await adapter.execute(op, observation.candidates[0], { ...guard, observation });
  assert.deepEqual(input.actions, ['click', 'press:ControlOrMeta+A', ...[...'New title'].map(character => 'type:' + character)]);
  op.input.title = '';
  observation = await adapter.observe(op, guard);
  await adapter.execute(op, observation.candidates[0], { ...guard, observation });
  assert.equal(input.actions.at(-1), 'press:Backspace');
  await adapter.close();
});

test('takeover discards an outstanding observed action', async () => {
  const { adapter, save, op, guard, state } = setup();
  const observation = await adapter.observe(op, guard);
  state.epoch++;
  await adapter.execute(op, observation.candidates[0], { ...guard, observation }).then(
    () => assert.fail('Expected revoked control'),
    (error) => assert.equal(error.code, 'CONTROL_REVOKED'),
  );
  assert.deepEqual(save.actions, []);
  await adapter.release('work');
  await adapter.close();
});

test('an action timeout is uncertain and raw errors are not exposed', async () => {
  const { adapter, save, op, guard } = setup();
  save.onClick = () => { throw new Error('Sensitive raw page diagnostics'); };
  const observation = await adapter.observe(op, guard);
  await assert.rejects(adapter.execute(op, observation.candidates[0], { ...guard, observation }), (error: any) => {
    assert.equal(error.beforeEffect, false);
    assert.equal(error.code, 'BROWSER_ACTION_UNCERTAIN');
    assert.equal(error.message.includes('Sensitive'), false);
    return true;
  });
  await adapter.close();
});

test('ambiguous tabs and lookalike path or origin are never chosen', async () => {
  const { adapter, page, state, op, guard } = setup();
  const duplicate = new FakePage();
  state.pages.push(duplicate);
  await assert.rejects(adapter.observe(op, guard), { code: 'BROWSER_TAB_AMBIGUOUS' });
  state.pages.pop();
  page.currentUrl = 'https://example.test/taskshop';
  await assert.rejects(adapter.observe(op, guard), { code: 'BROWSER_TAB_REQUIRED' });
  page.currentUrl = 'https://example.test.attacker.invalid/tasks';
  await assert.rejects(adapter.observe(op, guard), { code: 'BROWSER_TAB_REQUIRED' });
  await adapter.close();
});
