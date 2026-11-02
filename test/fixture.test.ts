import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FixtureAdapter } from '../src/adapters/fixture.ts';
import type { Guard, Operation, ScopeConfig } from '../src/contracts.ts';

const scopes: ScopeConfig[] = [{ id: 'fixture', origin: 'https://fixture.invalid', account: 'fixture-user' }];
function operation(): Operation {
  return {
    id: 'op-fixture-1', input: { name: 'Grace' },
    recipe: { id: 'set-name', scopeId: 'fixture', adapter: 'fixture', description: 'Change fixture name', inputs: { name: 'string' } },
  };
}
function guard(): Guard { return { signal: new AbortController().signal, epoch: 1, assertCurrent() {} }; }
function setup(t: any) {
  const directory = mkdtempSync(join(tmpdir(), 'web-operator-fixture-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { directory, adapter: new FixtureAdapter(directory, scopes) };
}

test('fixture completes a typed form followed by one save and survives a new adapter', async t => {
  const { directory, adapter } = setup(t);
  const op = operation();
  const g = guard();
  assert.equal((await adapter.verify(op, g)).state, 'not_satisfied');
  const first = await adapter.observe(op, g);
  assert.equal(first.candidates[0].id, 'fixture.type');
  await adapter.execute(op, first.candidates[0], { ...g, observation: first });
  assert.equal((await adapter.verify(op, g)).state, 'not_satisfied');
  const second = await adapter.observe(op, g);
  assert.equal(second.candidates[0].id, 'fixture.save');
  await adapter.execute(op, second.candidates[0], { ...g, observation: second });
  const reopened = new FixtureAdapter(directory, scopes);
  assert.equal((await reopened.verify(op, g)).state, 'satisfied');
  const complete = await reopened.observe(op, g);
  assert.deepEqual(complete.candidates, []);
  assert.equal(complete.facts.saveCount, 1);
  const file = join(directory, 'fixture', readdirSync(join(directory, 'fixture'))[0]);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).saved, 'Grace');
});

test('fixture rejects stale revisions and consumed observations', async t => {
  const { adapter } = setup(t);
  const op = operation();
  const g = guard();
  const observation = await adapter.observe(op, g);
  const stale = await adapter.observe(op, g);
  await adapter.execute(op, observation.candidates[0], { ...g, observation });
  await assert.rejects(adapter.execute(op, observation.candidates[0], { ...g, observation }), { code: 'STALE_OBSERVATION' });
  await assert.rejects(adapter.execute(op, stale.candidates[0], { ...g, observation: stale }), { code: 'STALE_OBSERVATION' });
});

test('fixture binds action to operation inputs, account, and observed scope', async t => {
  const { adapter, directory } = setup(t);
  const op = operation();
  const g = guard();
  const observation = await adapter.observe(op, g);
  await assert.rejects(adapter.execute({ ...op, input: { name: 'Different' } }, observation.candidates[0], { ...g, observation }), { code: 'STALE_OBSERVATION' });
  await assert.rejects(adapter.execute(op, observation.candidates[0], { ...g, observation: { ...observation, account: 'another' } }), { code: 'STALE_OBSERVATION' });
  await adapter.execute(op, observation.candidates[0], { ...g, observation });
  const otherAccount = new FixtureAdapter(directory, [{ ...scopes[0], account: 'another' }]);
  await assert.rejects(otherAccount.observe(op, g), { code: 'ACCOUNT_MISMATCH' });
});

test('fixture checks revoked control before mutating', async t => {
  const { adapter } = setup(t);
  const op = operation();
  const g = guard();
  const observation = await adapter.observe(op, g);
  await assert.rejects(adapter.execute(op, observation.candidates[0], {
    ...g, observation, assertCurrent() { throw new Error('revoked'); },
  }), /revoked/);
  const next = await adapter.observe(op, g);
  assert.equal(next.candidates[0].id, 'fixture.type');
  assert.equal(next.facts.saveCount, 0);
});

test('fixture uses private effect classification even if an observation object is edited', async t => {
  const { adapter } = setup(t);
  const op = operation();
  const g = guard();
  const first = await adapter.observe(op, g);
  await adapter.execute(op, first.candidates[0], { ...g, observation: first });
  const observation = await adapter.observe(op, g);
  observation.candidates[0].effect = 'read';
  await assert.rejects(adapter.execute(op, observation.candidates[0], { ...g, observation }), { code: 'INVALID_CANDIDATE' });
  assert.equal(adapter.inspect('fixture').saveCount, 0);
});

test('fixture human handoff completion is visible to verification without a second save', async t => {
  const { adapter } = setup(t);
  const op = operation();
  const g = guard();
  const observation = await adapter.observe(op, g);
  adapter.humanSet(op);
  assert.equal((await adapter.verify(op, g)).state, 'satisfied');
  assert.equal(adapter.inspect('fixture').saveCount, 1);
  await assert.rejects(adapter.execute(op, observation.candidates[0], { ...g, observation }), { code: 'STALE_OBSERVATION' });
  assert.equal(adapter.inspect('fixture').saveCount, 1);
});
