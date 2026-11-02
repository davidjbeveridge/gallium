import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpAdapter, HttpRateLimitError } from '../src/adapters/http.ts';
import { OperatorError } from '../src/contracts.ts';
import type { Guard, Operation, ScopeConfig } from '../src/contracts.ts';

const scopes: ScopeConfig[] = [{ id: 'api', origin: 'https://example.invalid', account: 'user-123' }];
function operation(): Operation {
  return {
    id: 'op-123', input: { name: 'Grace' },
    recipe: {
      id: 'set-name-http', scopeId: 'api', description: 'Set profile name', adapter: 'http', inputs: { name: 'string' },
      http: {
        url: 'https://example.invalid/profile', verifyUrl: 'https://example.invalid/profile', method: 'PUT', effect: 'write',
        inputKeys: ['name'], accountPath: 'account.id', goalPath: 'profile.name', expectedInputKey: 'name',
        idempotencyHeader: 'Idempotency-Key', headersFromEnv: { Authorization: 'TEST_API_TOKEN' },
      },
    },
  };
}
function guard(): Guard {
  return { signal: new AbortController().signal, epoch: 1, assertCurrent() {} };
}
function fakeService() {
  const state = { account: 'user-123', name: 'Ada', writes: 0 };
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: string | URL | Request, init: RequestInit) => {
    calls.push({ url: String(url), init });
    if (init.method !== 'GET') {
      state.writes++;
      state.name = JSON.parse(init.body as string).name;
      return new Response('', { status: 200 });
    }
    return Response.json({ account: { id: state.account }, profile: { name: state.name }, secret: 'response-secret' });
  }) as typeof fetch;
  const adapter = new HttpAdapter(scopes, { fetch: fetcher, env: { TEST_API_TOKEN: 'Bearer fake-secret' } });
  return { adapter, state, calls };
}

test('portable API rechecks account, writes once with stable key, and verifies business result', async () => {
  const { adapter, state, calls } = fakeService();
  const op = operation();
  const g = guard();
  assert.equal((await adapter.verify(op, g)).state, 'not_satisfied');
  const observation = await adapter.observe(op, g);
  assert.equal(observation.candidates.length, 1);
  assert.equal(observation.facts.goalSatisfied, false);
  await adapter.execute(op, observation.candidates[0], { ...g, observation });
  assert.equal((await adapter.verify(op, g)).state, 'satisfied');
  assert.equal(state.writes, 1);
  const write = calls.find(call => call.init.method === 'PUT')!;
  assert.equal(new Headers(write.init.headers).get('Idempotency-Key'), op.id);
  assert.equal(new Headers(write.init.headers).get('Authorization'), 'Bearer fake-secret');
  assert.equal(write.init.credentials, 'omit');
  assert.equal(write.init.redirect, 'error');
  assert.equal(write.init.body, JSON.stringify({ name: 'Grace' }));
  assert(!JSON.stringify(observation).includes('fake-secret'));
  assert(!JSON.stringify(observation).includes('response-secret'));
  assert.equal((await adapter.observe(op, g)).candidates.length, 0);
});

test('wrong account blocks both observation and dispatch before any write', async () => {
  const { adapter, state } = fakeService();
  const op = operation();
  const g = guard();
  const observation = await adapter.observe(op, g);
  state.account = 'another-user';
  await assert.rejects(adapter.execute(op, observation.candidates[0], { ...g, observation }), { code: 'ACCOUNT_MISMATCH', beforeEffect: true });
  await assert.rejects(adapter.observe(op, g), { code: 'ACCOUNT_MISMATCH' });
  assert.equal(state.writes, 0);
});

test('unapproved URL fails before a network call', async () => {
  const { adapter, calls } = fakeService();
  const op = operation();
  op.recipe.http!.url = 'https://other.invalid/profile';
  await assert.rejects(adapter.observe(op, guard()), { code: 'ORIGIN_MISMATCH' });
  assert.equal(calls.length, 0);
});

test('changed business state and forged candidate are rejected', async () => {
  const { adapter, state } = fakeService();
  const op = operation();
  const g = guard();
  const observation = await adapter.observe(op, g);
  await assert.rejects(adapter.execute(op, { ...observation.candidates[0], effect: 'read' }, { ...g, observation }), { code: 'STALE_OBSERVATION' });
  state.name = 'A human changed this';
  await assert.rejects(adapter.execute(op, observation.candidates[0], { ...g, observation }), { code: 'STALE_OBSERVATION' });
  assert.equal(state.writes, 0);
});

test('a mutation transport error is uncertain, sanitized, and never retried', async () => {
  let writes = 0;
  const adapter = new HttpAdapter(scopes, {
    env: { TEST_API_TOKEN: 'Bearer test-secret' },
    fetch: (async (_url, init) => {
      if (init?.method !== 'GET') {
        writes++;
        throw new Error('raw transport error containing test-secret');
      }
      return Response.json({ account: { id: 'user-123' }, profile: { name: 'Ada' } });
    }) as typeof fetch,
  });
  const op = operation();
  const g = guard();
  const observation = await adapter.observe(op, g);
  await assert.rejects(adapter.execute(op, observation.candidates[0], { ...g, observation }), error => {
    assert(error instanceof OperatorError);
    assert.equal(error.code, 'HTTP_TRANSPORT_UNKNOWN');
    assert.equal(error.beforeEffect, false);
    assert(!String(error).includes('test-secret'));
    return true;
  });
  assert.equal(writes, 1);
});

test('HTTP success without the expected business value is not verified', async () => {
  const adapter = new HttpAdapter(scopes, {
    env: { TEST_API_TOKEN: 'placeholder' },
    fetch: (async (_url, init) => init?.method === 'GET'
      ? Response.json({ account: { id: 'user-123' }, profile: { name: 'Ada' } })
      : new Response('', { status: 200 })) as typeof fetch,
  });
  const op = operation();
  const g = guard();
  const observation = await adapter.observe(op, g);
  await adapter.execute(op, observation.candidates[0], { ...g, observation });
  assert.equal((await adapter.verify(op, g)).state, 'not_satisfied');
});

test('rate limit carries bounded cooldown without retries or response-body leakage', async () => {
  let calls = 0;
  const adapter = new HttpAdapter(scopes, {
    env: { TEST_API_TOKEN: 'placeholder' },
    fetch: (async () => {
      calls++;
      return new Response('private response', { status: 429, headers: { 'Retry-After': '120' } });
    }) as typeof fetch,
  });
  await assert.rejects(adapter.observe(operation(), guard()), error => {
    assert(error instanceof HttpRateLimitError);
    assert.equal(error.retryAfterMs, 120_000);
    assert.equal(error.beforeEffect, true);
    assert(!String(error).includes('private response'));
    return true;
  });
  assert.equal(calls, 1);
});

test('redirects and oversized verification responses are rejected', async () => {
  const redirect = new HttpAdapter(scopes, {
    env: { TEST_API_TOKEN: 'placeholder' },
    fetch: (async () => new Response('', { status: 302, headers: { Location: 'https://other.invalid' } })) as typeof fetch,
  });
  await assert.rejects(redirect.observe(operation(), guard()), { code: 'HTTP_STATUS_302' });
  const oversized = new HttpAdapter(scopes, {
    maxResponseBytes: 10,
    env: { TEST_API_TOKEN: 'placeholder' },
    fetch: (async () => Response.json({ account: { id: 'user-123' }, profile: { name: 'Ada' } })) as typeof fetch,
  });
  await assert.rejects(oversized.observe(operation(), guard()), { code: 'HTTP_RESPONSE_TOO_LARGE' });
});

test('aborted control does not dispatch a write', async () => {
  const { adapter, state } = fakeService();
  const op = operation();
  const controller = new AbortController();
  const g = { ...guard(), signal: controller.signal };
  const observation = await adapter.observe(op, g);
  controller.abort();
  await assert.rejects(adapter.execute(op, observation.candidates[0], { ...g, observation }));
  assert.equal(state.writes, 0);
});

test('missing business state never becomes a false success', async () => {
  const adapter = new HttpAdapter(scopes, {
    env: { TEST_API_TOKEN: 'placeholder' },
    fetch: (async () => Response.json({ account: { id: 'user-123' }, profile: {} })) as typeof fetch,
  });
  await assert.rejects(adapter.verify(operation(), guard()), { code: 'HTTP_VERIFICATION_INCOMPLETE' });
});

test('a dispatched write receiving 429 remains uncertain and carries cooldown', async () => {
  let writes = 0;
  const adapter = new HttpAdapter(scopes, {
    env: { TEST_API_TOKEN: 'placeholder' },
    fetch: (async (_url, init) => {
      if (init?.method === 'GET') return Response.json({ account: { id: 'user-123' }, profile: { name: 'Ada' } });
      writes++;
      return new Response('private service detail', { status: 429, headers: { 'Retry-After': '999999' } });
    }) as typeof fetch,
  });
  const op = operation();
  const g = guard();
  const observation = await adapter.observe(op, g);
  await assert.rejects(adapter.execute(op, observation.candidates[0], { ...g, observation }), error => {
    assert(error instanceof HttpRateLimitError);
    assert.equal(error.beforeEffect, false);
    assert.equal(error.retryAfterMs, 3_600_000);
    return true;
  });
  assert.equal(writes, 1);
});

test('credentials cannot be forwarded over non-loopback plaintext HTTP', async () => {
  const op = operation();
  op.recipe.http!.url = 'http://example.invalid/profile';
  op.recipe.http!.verifyUrl = 'http://example.invalid/profile';
  let calls = 0;
  const adapter = new HttpAdapter([{ ...scopes[0], origin: 'http://example.invalid' }], {
    env: { TEST_API_TOKEN: 'private-token' },
    fetch: (async () => { calls++; return Response.json({ account: { id: 'user-123' }, profile: { name: 'Ada' } }); }) as typeof fetch,
  });
  await assert.rejects(adapter.observe(op, guard()), { code: 'HTTPS_REQUIRED' });
  assert.equal(calls, 0);
  delete op.recipe.http!.headersFromEnv;
  const observation = await adapter.observe(op, guard());
  assert.equal(observation.account, 'user-123');
  assert.equal(calls, 1);
});
