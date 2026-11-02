import test from 'node:test';
import assert from 'node:assert/strict';
import { typeWithPolicy } from '../src/input-policy.ts';

test('takeover during typing stops before the next character', async () => {
  const controller = new AbortController(); const typed: string[] = [];
  const handle = { async type(character: string) { typed.push(character); if (typed.length === 2) controller.abort(); } };
  await assert.rejects(typeWithPolicy(handle, 'Long pending submission', { signal: controller.signal, epoch: 0, assertCurrent() {} }));
  assert.deepEqual(typed, ['L', 'o']);
});

test('natural typing preserves text and respects a zero overhead budget', async () => {
  const typed: string[] = [];
  await typeWithPolicy({ async type(character: string) { typed.push(character); } }, 'Ada Lovelace',
    { signal: new AbortController().signal, epoch: 0, assertCurrent() {} }, { mode: 'natural', maxOverheadMs: 0 });
  assert.equal(typed.join(''), 'Ada Lovelace');
});
