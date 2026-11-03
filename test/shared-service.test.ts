import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sharedEngine, restartSharedService } from '../src/shared-service.ts';
import type { Config } from '../src/contracts.ts';

test('MCP clients share one service and durable control', async t => {
  const dir=mkdtempSync(join(tmpdir(),'wo-service-'));
  const config: Config={version:1,stateDir:dir+'/state',sharedService:true,
    scopes:[{id:'demo',origin:'https://fixture.invalid',account:'demo-user'}],
    recipes:[{id:'save',scopeId:'demo',description:'Save profile name',adapter:'fixture',inputs:{name:'string'}}],
    navigators:{deterministic:{provider:'deterministic'}}};
  const path=dir+'/config.json';writeFileSync(path,JSON.stringify(config),{mode:0o600});
  const [first,second]=await Promise.all([sharedEngine(path,config),sharedEngine(path,config)]);
  const a=await first.status(),b=await second.status();
  let pid=(a.service as any).pid;
  t.after(()=>{process.kill(pid,'SIGTERM');setTimeout(()=>rmSync(dir,{recursive:true,force:true}),100).unref();});
  assert.equal(pid,(b.service as any).pid);
  const result=await first.act({operationId:'shared-1',recipe:'save',input:{name:'Ada'}});
  assert.equal((result.operation as any).state,'verified');
  await first.control('demo','pause');
  await assert.rejects(second.read('save',{name:'Ada'}),{code:'PAUSED'});
  await second.control('demo','resume');
  const repeated=await second.act({operationId:'shared-1',recipe:'save',input:{name:'Ada'}});
  assert.equal((repeated.operation as any).actions,(result.operation as any).actions);
  await first.control('demo','pause');
  await restartSharedService(path,config);
  const restarted=await sharedEngine(path,config);
  const status=await restarted.status();
  assert.notEqual((status.service as any).pid,pid);
  pid=(status.service as any).pid;
  await assert.rejects(restarted.read('save',{name:'Ada'}),{code:'PAUSED'});
});
