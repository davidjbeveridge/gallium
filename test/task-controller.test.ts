import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createEngine } from '../src/runtime.ts';
import type { Config } from '../src/contracts.ts';

test('internal routing persists selection, rejects changed intent, and respects durable pause', async t => {
  const directory = mkdtempSync(join(tmpdir(),'web-task-'));
  let calls = 0;
  const server = createServer((req,res) => {
    calls++;
    req.resume();
    req.on('end',()=>res.end(JSON.stringify({ answers:{fit_0:{type:'noul',noul:0.95}} })));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address() as any;
  process.env.WEB_TASK_TEST_KEY='synthetic';
  const config: Config = {
    version:1,stateDir:directory,sharedService:false,
    scopes:[{id:'demo',origin:'https://fixture.invalid',account:'demo-user'}],
    recipes:[{id:'set-name',scopeId:'demo',description:'Save profile name',adapter:'fixture',inputs:{name:'string'}}],
    navigators:{deterministic:{provider:'deterministic'}},
    taskRouter:{provider:'typesafe',endpoint:`http://127.0.0.1:${address.port}`,apiKeyEnv:'WEB_TASK_TEST_KEY'},
  };
  const engine=await createEngine(config);
  t.after(async()=>{await engine.close(); server.close(); delete process.env.WEB_TASK_TEST_KEY;rmSync(directory,{recursive:true,force:true});});
  const task={operationId:'task-1',scopeId:'demo',goal:'Save my profile name',input:{name:'Ada'}};
  const first=await engine.task(task);
  assert.equal((first.operation as any).state,'verified');
  assert.equal(first.route,'set-name');
  await engine.task(task);
  assert.equal(calls,1);
  await assert.rejects(engine.task({...task,goal:'Delete my account'}),{code:'OPERATION_CONFLICT'});
  await engine.control('demo','pause');
  assert.equal((await engine.task({...task,operationId:'task-2'})).code,'PAUSED');
  assert.equal(calls,1);
});
