import test from 'node:test';
import assert from 'node:assert/strict';
import { explorePage } from '../src/exploration.ts';
const signal = new AbortController().signal;
const answer = (supported, useful, extra={}) => ({supported:{type:'noul',noul:supported},useful:{type:'noul',noul:useful},safe_c0:{type:'noul',noul:1},...extra});
function fixture() {
 let state=0,closed=false;
 return { get state(){return state},get closed(){return closed},
  async observe(){return {url:'https://example.org/',passages:state?['The telescope opens at 9 AM.']:['Welcome to the observatory.'],controls:state?[]:[{id:'c0',kind:'reveal',label:'Opening hours'}]};},
  async act(id){assert.equal(id,'c0');state++},async close(){closed=true},
 };
}
test('unfamiliar dynamic disclosure reaches verified literal evidence without a recipe', async()=>{
 const page=fixture();let calls=0;
 const result=await explorePage(page,'When does the telescope open?',async()=>++calls===1?answer(0,1,{control:{type:'choice',choice:'c0'}}):answer(1,0,{passage:{type:'choice',choice:'p0'}}),signal);
 assert.equal(result.state,'evidence_found');assert.equal(result.evidence,'The telescope opens at 9 AM.');assert.equal(page.state,1);assert.equal(page.closed,true);
});
test('fabricated control cannot execute and task-owned page is closed',async()=>{
 const page=fixture();await assert.rejects(explorePage(page,'hours',async()=>answer(0,1,{control:{type:'choice',choice:'invented'}}),signal),{code:'NAVIGATOR_RESPONSE_INVALID'});
 assert.equal(page.state,0);assert.equal(page.closed,true);
});
test('challenge stops before inference or interaction',async()=>{
 const page=fixture();page.observe=async()=>({url:'https://example.org/',passages:[],controls:[],blocked:'AUTH_OR_CHALLENGE_REQUIRED'});
 const result=await explorePage(page,'hours',async()=>{throw Error('must not call')},signal);
 assert.equal(result.code,'AUTH_OR_CHALLENGE_REQUIRED');assert.equal(page.closed,true);
});
test('repeated state terminates instead of repeating a click',async()=>{
 const page=fixture();page.act=async()=>{};
 const result=await explorePage(page,'hours',async()=>answer(0,1,{control:{type:'choice',choice:'c0'}}),signal);
 assert.equal(result.code,'EXPLORATION_STALLED');
});
test('changed evidence cannot be reported as success',async()=>{
 const page=fixture();let observations=0;
 page.observe=async()=>({url:'https://example.org/',passages:[++observations===1?'The telescope opens at 9 AM.':'The telescope is closed.'],controls:[]});
 const result=await explorePage(page,'hours',async()=>answer(1,0,{passage:{type:'choice',choice:'p0'}}),signal);
 assert.equal(result.code,'EVIDENCE_CHANGED');
});
test('unknown control effects cannot execute',async()=>{
 const page=fixture();
 const result=await explorePage(page,'hours',async()=>answer(0,1,{control:{type:'choice',choice:'c0'},safe_c0:{type:'noul',noul:0.5}}),signal);
 assert.equal(result.code,'UNSUPPORTED_CONTROL_EFFECT');assert.equal(page.state,0);
});
test('explicit loading state waits then verifies revealed evidence',async()=>{
 const page=fixture();let loaded=false;
 page.wait=async()=>{loaded=true};
 page.observe=async()=>({url:'https://example.org/',passages:[loaded?'The telescope opens at 9 AM.':'Loading opening hours...'],controls:[]});
 const result=await explorePage(page,'hours',async()=>loaded?answer(1,0,{passage:{type:'choice',choice:'p0'}}):answer(0,0,{loading:{type:'noul',noul:1}}),signal);
 assert.equal(result.state,'evidence_found');assert.equal(result.steps,1);
});
