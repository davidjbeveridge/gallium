import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {join} from 'node:path';
import {Engine} from '../src/engine.ts';
import type {Adapter,Config} from '../src/contracts.ts';

test('independent HTTP reads overlap while browser reads share one queue', async t => {
 const dir=mkdtempSync(join(tmpdir(),'wo-queues-'));
 const config:Config={version:1,stateDir:dir,navigators:{},scopes:[
  {id:'a',origin:'https://a.invalid',account:'a'},{id:'b',origin:'https://b.invalid',account:'b'}],
  recipes:['a','b'].flatMap(scopeId=>['http','playwriter'].map(adapter=>({
    id:scopeId+'-'+adapter,scopeId,description:'Read',adapter:adapter as 'http'|'playwriter',inputs:{}
  })))};
 let active=0,maximum=0;
 const releases:Array<()=>void>=[];
 const entered:Array<()=>void>=[];
 const adapter:Adapter={name:'test',
  async observe(op){
    active++;maximum=Math.max(maximum,active);entered.shift()?.();
    await new Promise<void>(resolve=>releases.push(resolve));active--;
    const scope=config.scopes.find(s=>s.id===op.recipe.scopeId)!;
    return {id:'obs',documentId:'doc',scopeId:scope.id,origin:scope.origin,account:scope.account,
      capturedAt:Date.now(),summary:'Read',candidates:[],facts:{}};
  },async execute(){},async verify(){return {state:'satisfied',code:'ok'};}};
 const engine=new Engine(config,{http:adapter,playwriter:adapter},{});
 t.after(async()=>{for(const release of releases)release();await engine.close();rmSync(dir,{recursive:true,force:true});});
 const firstEntered=Promise.withResolvers<void>(),secondEntered=Promise.withResolvers<void>();
 entered.push(firstEntered.resolve,secondEntered.resolve);
 const first=engine.read('a-http',{}),second=engine.read('b-http',{});
 await Promise.all([firstEntered.promise,secondEntered.promise]);
 assert.equal(maximum,2);releases.splice(0).forEach(fn=>fn());await Promise.all([first,second]);
 maximum=0;
 const browserEntered=Promise.withResolvers<void>();entered.push(browserEntered.resolve);
 const one=engine.read('a-playwriter',{}),two=engine.read('b-playwriter',{});
 await browserEntered.promise;
 assert.equal(active,1);
 releases.shift()!();await one;
 await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(maximum,1);releases.shift()!();await two;
});

test('dynamic exploration shares the browser queue and respects human ownership',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'wo-explore-queue-'));
 const config:Config={version:1,stateDir:dir,navigators:{},scopes:[{id:'public',origin:'https://example.org',account:'public'}],recipes:[]};
 let opened=0,active=0,maximum=0;
 const adapter={name:'playwriter',async explore(){opened++;active++;maximum=Math.max(maximum,active);return {
  async observe(){await new Promise(r=>setTimeout(r,5));return {url:'https://example.org/',passages:['The museum opens at nine.'],controls:[]}},
  async act(){throw Error('not expected')},async close(){active--}
 }}};
 const engine=new Engine(config,{playwriter:adapter as any},{});
 t.after(async()=>{await engine.close();rmSync(dir,{recursive:true,force:true})});
 const ask=async()=>({supported:{type:'noul',noul:1},passage:{type:'choice',choice:'p0'}});
 const signal=new AbortController().signal;
 await Promise.all([engine.explore('https://example.org/','hours',ask,signal),engine.explore('https://example.org/','hours',ask,signal)]);
 assert.equal(opened,2);assert.equal(maximum,1);
 engine.journal.changeControl('public','pause');
 assert.equal((await engine.explore('https://example.org/','hours',ask,signal)).code,'PAUSED');assert.equal(opened,2);
});
