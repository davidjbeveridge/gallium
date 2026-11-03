import test from 'node:test';
import assert from 'node:assert/strict';
import { createNavigator } from '../src/navigators.ts';
import type { Candidate, DecisionRequest } from '../src/contracts.ts';

const signal = () => new AbortController().signal;
const click: Candidate = { id: 'save', kind: 'click', label: 'Save changes', effect: 'write' };
const field: Candidate = { id: 'title', kind: 'type', label: 'Title', effect: 'ui', inputKey: 'title' };
const request = (candidates = [click, field]): DecisionRequest => ({
  operationId: 'op-1', goal: 'Set the title and save it', input: { title: 'Example' }, epoch: 4,
  observation: { id: 'obs-1', documentId: 'doc-1', scopeId: 'fixture', origin: 'http://localhost:3000',
    account: 'demo', summary: 'A title form', candidates, facts: {}, capturedAt: Date.now() },
});

const jsonResponse = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const chosen = (ids: string[], id: string) => ({ choice: id, confidence: 0.98,
  probabilities: Object.fromEntries(ids.map(candidate => [candidate, candidate === id ? 1 : 0])) });
const compatible = (output: unknown) => jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }] });
const config = { provider: 'openai-compatible' as const, endpoint: 'https://navigator.example/v1/chat/completions',
  model: 'fast-model', apiKeyEnv: 'WEB_OPERATOR_TEST_NAV_KEY' };
process.env.WEB_OPERATOR_TEST_NAV_KEY = 'test-provider-key';

test('deterministic recipes make no model call and use the observed order', async () => {
  const navigator = createNavigator({ provider: 'deterministic' }, async () => { throw new Error('unexpected network'); });
  assert.deepEqual(await navigator.choose(request(), signal()), { type: 'act', candidateId: 'save' });
  assert.deepEqual(await navigator.choose(request([]), signal()), { type: 'done' });
});

test('TypeSafe submits operation and target questions together, consuming only the selected head', async () => {
  let calls = 0;
  const navigator = createNavigator({ provider: 'typesafe', model: 'configured-jev', apiKeyEnv: 'WEB_OPERATOR_TEST_NAV_KEY' }, async (url, init) => {
    calls++;
    assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
    assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-provider-key');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'configured-jev');
    assert.deepEqual(Object.keys(body.questions), ['applicable', 'operation', 'click_target', 'type_text_target']);
    assert.equal(body.state.goal, request().goal);
    assert.deepEqual(body.state.input, request().input);
    assert.deepEqual(Object.keys(body.questions.type_text_target.criteria), ['2']);
    return jsonResponse({ answers: { applicable: {type: "noul", noul: 0.95},
      operation: chosen(Object.keys(body.questions.operation.criteria), 'TYPE_TEXT'),
      type_text_target: chosen(['2'], '2'), click_target: { deliberately: 'unused and malformed' },
    } });
  });
  assert.deepEqual(await navigator.choose(request(), signal()), { type: 'act', candidateId: 'title', score: 0.98 });
  assert.equal(calls, 1);
});

test('TypeSafe maps controls without allowing candidate IDs to become operation names', async () => {
  const navigator = createNavigator({ provider: 'typesafe', apiKeyEnv: 'WEB_OPERATOR_TEST_NAV_KEY' }, async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.ok(body.questions.operation.criteria.SCROLL_1);
    return jsonResponse({ answers: { applicable: {type: "noul", noul: 0.95}, operation: chosen(Object.keys(body.questions.operation.criteria), 'SCROLL_1') } });
  });
  assert.deepEqual(await navigator.choose(request([{ id: 'DONE', kind: 'scroll', label: 'Scroll down', effect: 'ui' }]), signal()),
    { type: 'act', candidateId: 'DONE', score: 0.98 });
});

test('TypeSafe DONE is a proposal for the verifier, not an execution or success receipt', async () => {
  const navigator = createNavigator({ provider: 'typesafe', apiKeyEnv: 'WEB_OPERATOR_TEST_NAV_KEY' }, async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    return jsonResponse({ answers: { applicable: {type: "noul", noul: 0.95}, operation: chosen(Object.keys(body.questions.operation.criteria), 'DONE') } });
  });
  assert.deepEqual(await navigator.choose(request(), signal()), { type: 'done' });
});

test('TypeSafe rejects unknown target IDs and invalid probability vectors', async () => {
  for (const corruption of ['target', 'probabilities', 'max', 'confidence']) {
    const navigator = createNavigator({ provider: 'typesafe', apiKeyEnv: 'WEB_OPERATOR_TEST_NAV_KEY' }, async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const operation = chosen(Object.keys(body.questions.operation.criteria), 'CLICK');
      const target = chosen(['1'], '1');
      if (corruption === 'target') target.choice = 'invented';
      if (corruption === 'probabilities') target.probabilities['extra'] = 0;
      if (corruption === 'max') { operation.probabilities.CLICK = 0.1; operation.probabilities.DONE = 0.9; }
      if (corruption === 'confidence') operation.confidence = Number.NaN;
      return jsonResponse({ answers: { applicable: {type: "noul", noul: 0.95}, operation, click_target: target } });
    });
    await assert.rejects(navigator.choose(request(), signal()), { code: 'NAVIGATOR_RESPONSE_INVALID' });
  }
});

test('OpenAI-compatible provider supplies a bounded schema and accepts only an observed ID', async () => {
  const navigator = createNavigator(config, async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'fast-model');
    assert.equal(body.response_format.type, 'json_schema');
    assert.deepEqual(body.response_format.json_schema.schema.properties.candidateId.enum, ['save', 'title', null]);
    return compatible({ type: 'act', candidateId: 'title' });
  });
  assert.deepEqual(await navigator.choose(request(), signal()), { type: 'act', candidateId: 'title' });
});

test('provider output cannot inject selectors, code, extra fields, or arbitrary action IDs', async () => {
  for (const output of [
    { type: 'act', candidateId: 'not-observed' },
    { type: 'act', candidateId: 'save', selector: '#other' },
    { type: 'act', candidateId: 'save', code: 'fetch(secret)' },
    { type: 'done', candidateId: 'save' },
    { type: 'arbitrary', candidateId: null },
    { type: 'blocked', candidateId: null, reason: 'could contain private data' },
    null,
  ]) {
    await assert.rejects(createNavigator(config, async () => compatible(output)).choose(request(), signal()), { code: 'NAVIGATOR_RESPONSE_INVALID' });
  }
});

test('blocked and escalation results use local fixed reasons', async () => {
  for (const type of ['blocked', 'escalate'] as const) {
    const result = await createNavigator(config, async () => compatible({ type, candidateId: null })).choose(request(), signal());
    assert.deepEqual(result, { type, reason: type === 'blocked' ? 'provider_blocked' : 'provider_escalated' });
  }
});

test('abort and timeout finish promptly even when a transport ignores its abort signal', async () => {
  const never: typeof fetch = () => new Promise(() => {});
  const aborted = new AbortController();
  const pending = createNavigator(config, never).choose(request(), aborted.signal);
  aborted.abort('private cancellation detail');
  await assert.rejects(pending, error => (error as { code: string }).code === 'NAVIGATOR_ABORTED'
    && !String(error).includes('private cancellation detail'));
  await assert.rejects(createNavigator({ ...config, timeoutMs: 5 }, never).choose(request(), signal()), { code: 'NAVIGATOR_TIMEOUT' });
});

test('cancelled decisions are discarded even if a provider later returns a valid action', async () => {
  let resolve!: (response: Response) => void;
  const controller = new AbortController();
  const pending = createNavigator(config, () => new Promise(done => { resolve = done; })).choose(request(), controller.signal);
  controller.abort();
  resolve(compatible({ type: 'act', candidateId: 'save' }));
  await assert.rejects(pending, { code: 'NAVIGATOR_ABORTED' });
});

test('provider failures do not echo response bodies, transport errors, or credentials; no retries', async () => {
  let calls = 0;
  const secret = 'test-provider-key';
  const providerError = createNavigator(config, async () => { calls++; return new Response(`echo ${secret}`, { status: 429 }); });
  await assert.rejects(providerError.choose(request(), signal()), error => {
    assert.equal((error as { code: string }).code, 'NAVIGATOR_HTTP_ERROR');
    assert.match(String(error), /429/);
    assert.ok(!String(error).includes(secret));
    return true;
  });
  assert.equal(calls, 1);
  await assert.rejects(createNavigator(config, async () => { throw new Error(secret); }).choose(request(), signal()), error => {
    assert.equal((error as { code: string }).code, 'NAVIGATOR_CONNECTION_FAILED');
    return !String(error).includes(secret);
  });
});

test('credential-shaped inputs and missing explicit bindings are stopped before model calls', async () => {
  let calls = 0;
  const navigator = createNavigator(config, async () => { calls++; return compatible({ type: 'done', candidateId: null }); });
  const credentials = request(); credentials.input.otp = '123456';
  await assert.rejects(navigator.choose(credentials, signal()), { code: 'SECRET_INPUT_BLOCKED' });
  const missing = request(); delete missing.input.title;
  await assert.rejects(navigator.choose(missing, signal()), { code: 'NAVIGATOR_INPUT_INVALID' });
  assert.equal(calls, 0);
});

test('oversized and malformed provider responses are bounded and rejected', async () => {
  for (const response of [new Response('not JSON'), new Response('x'.repeat(256 * 1024 + 1))]) {
    await assert.rejects(createNavigator(config, async () => response).choose(request(), signal()), { code: 'NAVIGATOR_RESPONSE_INVALID' });
  }
});

test('configuration refuses credential URLs and unencrypted remote providers', () => {
  for (const endpoint of ['http://remote.example/v1', 'https://name:key@example.com/v1', 'https://example.com/v1?key=secret']) {
    assert.throws(() => createNavigator({ ...config, endpoint }), { code: 'NAVIGATOR_CONFIG_INVALID' });
  }
  assert.doesNotThrow(() => createNavigator({ ...config, endpoint: 'http://127.0.0.1:8000/v1/chat/completions' }));
});
