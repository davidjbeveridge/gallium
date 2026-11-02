import { setTimeout as delay } from 'node:timers/promises';
import { assertActive } from './contracts.ts';
import type { Guard } from './contracts.ts';

export interface InputPolicy { mode: 'efficient' | 'natural'; maxOverheadMs?: number }

/** Navigation is independent of pacing. Every character checks ownership; no queued string survives takeover. */
export async function typeWithPolicy(handle: any, text: string, guard: Guard, policy: InputPolicy = { mode: 'efficient' }, timeout = 5000) {
  const budget = Math.min(1000, Math.max(0, policy.maxOverheadMs ?? 400));
  let spent = 0, count = 0;
  for (const character of text) {
    assertActive(guard);
    await handle.type(character, { delay: 0, timeout });
    count++;
    if (policy.mode === 'natural' && count % 6 === 0 && spent < budget) {
      const pause = Math.min(45, budget - spent);
      await delay(pause, undefined, { signal: guard.signal }); spent += pause;
    }
  }
  assertActive(guard);
}
