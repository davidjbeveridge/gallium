import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createFixtureServer } from '../fixtures/server.ts';
import { HttpAdapter } from '../src/adapters/http.ts';
import { Engine } from '../src/engine.ts';
import { createNavigator } from '../src/navigators.ts';
import { validateConfig } from '../src/config.ts';

test('real loopback API runs the configured engine recipe once, verifies it, and honors idempotency', async t => {
  const fixture = await createFixtureServer({ port: 0 });
  const directory = mkdtempSync(join(tmpdir(), 'web-operator-http-integration-'));
  let engine: Engine | undefined;
  t.after(async () => {
    await engine?.close();
    await fixture.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const example = JSON.parse(readFileSync(new URL('../examples/http.config.json', import.meta.url), 'utf8'));
  example.stateDir = directory;
  example.scopes[0].origin = fixture.origin;
  example.recipes[0].http.url = fixture.origin + '/api/profile';
  example.recipes[0].http.verifyUrl = fixture.origin + '/api/profile';
  const config = validateConfig(example);
  engine = new Engine(config, { http: new HttpAdapter(config.scopes) }, { deterministic: createNavigator({ provider: 'deterministic' }) });
  const request = { operationId: 'real-loopback-operation', recipe: 'save-profile-api', input: { name: 'Grace Hopper' } };
  const initial = await fetch(fixture.origin + '/api/profile').then(response => response.json());
  assert.equal(initial.postCount, 0);
  const result: any = await engine.act(request);
  assert.equal(result.operation.state, 'verified');
  assert.equal(result.operation.actions, 1);
  const written = await fetch(fixture.origin + '/api/profile').then(response => response.json());
  assert.deepEqual(written, { account: 'demo-user', name: 'Grace Hopper', saveCount: 1, postCount: 1 });
  const replay: any = await engine.act(request);
  assert.equal(replay.code, 'ALREADY_VERIFIED');
  const afterReplay = await fetch(fixture.origin + '/api/profile').then(response => response.json());
  assert.equal(afterReplay.postCount, 1);
  const readback: any = await engine.read('save-profile-api', request.input);
  assert.equal(readback.observation.facts.goalSatisfied, true);
  assert.deepEqual(readback.observation.candidates, []);
  const html = await fetch(fixture.origin + '/profile').then(response => response.text());
  for (const selector of ['data-account', 'id="name"', 'id="save"', 'data-saved-name', 'data-stage="empty"']) assert(html.includes(selector));
  const duplicate = await fetch(fixture.origin + '/api/profile', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': request.operationId }, body: JSON.stringify(request.input),
  });
  assert.equal(duplicate.status, 200);
  await duplicate.body?.cancel();
  const conflict = await fetch(fixture.origin + '/api/profile', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': request.operationId }, body: JSON.stringify({ name: 'Conflicting name' }),
  });
  assert.equal(conflict.status, 409);
  await conflict.body?.cancel();
  const crossOrigin = await fetch(fixture.origin + '/api/profile', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://unrelated.invalid' }, body: JSON.stringify({ name: 'Rejected' }),
  });
  assert.equal(crossOrigin.status, 403);
  await crossOrigin.body?.cancel();
  const final = await fetch(fixture.origin + '/api/profile').then(response => response.json());
  assert.equal(final.name, 'Grace Hopper');
  assert.equal(final.saveCount, 1);
});
