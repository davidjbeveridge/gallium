import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEngine } from '../src/runtime.ts';
import { validateConfig } from '../src/config.ts';
import { createControlServer } from '../src/control-server.ts';
import { get } from 'node:http';

test('local panel rejects cross-origin writes and can pause, resume, run and verify', async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'operator-panel-'));
  const engine = await createEngine(validateConfig({ version: 1, stateDir,
    scopes: [{ id: 'demo', origin: 'https://fixture.invalid', account: 'demo-user' }],
    recipes: [{ id: 'save', scopeId: 'demo', description: 'Save name', adapter: 'fixture', inputs: { name: 'string' } }], navigators: {} }));
  const server = await createControlServer(engine, 0);
  try {
    assert.equal((await fetch(server.origin)).status, 200);
    const act = { operationId: 'panel-save', recipe: 'save', input: { name: 'Ada' } };
    assert.equal((await fetch(server.origin + '/api/act', { method: 'POST', body: JSON.stringify(act) })).status, 403);
    const headers = { Origin: server.origin, 'Content-Type': 'application/json', 'X-Web-Operator': 'control' };
    const post = async (path: string, body: unknown) => (await fetch(server.origin + path, { method: 'POST', headers, body: JSON.stringify(body) })).json();
    const paused: any = await post('/api/control', { scopeId: 'demo', action: 'pause' });
    assert.equal(paused.control.owner, 'human');
    assert.equal((await post('/api/act', act)).code, 'PAUSED');
    await post('/api/control', { scopeId: 'demo', action: 'resume' });
    assert.equal((await post('/api/act', act)).operation.state, 'verified');
    const repeated: any = await post('/api/act', act);
    assert.equal(repeated.operation.actions, 2);
    const crossOrigin = await fetch(server.origin + '/api/control', { method: 'POST', headers: { ...headers, Origin: 'https://evil.invalid' }, body: JSON.stringify({ scopeId: 'demo', action: 'pause' }) });
    assert.equal(crossOrigin.status, 403);
    const hostStatus = await new Promise<number | undefined>((resolve, reject) => {
      get(server.origin + '/api/status', { headers: { Host: 'evil.invalid' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
    });
    assert.equal(hostStatus, 403);
  } finally { await server.close(); await engine.close(); rmSync(stateDir, { recursive: true, force: true }); }
});
