// Opt-in live gate: uses configured Jev credentials and the existing shared Chrome session.
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import assert from 'node:assert/strict';
const child=spawn(process.execPath,['bin/mcp.mjs'],{stdio:['pipe','pipe','inherit']});
let id=0;const pending=new Map();
createInterface({input:child.stdout}).on('line',line=>{const r=JSON.parse(line);pending.get(r.id)?.(r);pending.delete(r.id)});
const call=(method,params)=>new Promise(resolve=>{const requestId=++id;pending.set(requestId,resolve);child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:requestId,method,params})+'\n')});
async function tool(name,args){const r=await call('tools/call',{name,arguments:args});assert(!r.error,JSON.stringify(r.error));return JSON.parse(r.result.content[0].text)}
const timer=setTimeout(()=>{child.kill();process.exitCode=1},110000);
try{
 await call('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'exploration-gate',version:'1'}});
 child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
 const before=await tool('web_status',{});
 const results=[];
 for(const [name,target,goal,expected] of [
  ['marley','https://quotes.toscrape.com/js/','Find the quote by Bob Marley about who is worth suffering for.',/Bob Marley/],
  ['loading','https://the-internet.herokuapp.com/dynamic_loading/1','Start the dynamic loading example and report the greeting revealed when it finishes.',/Hello World/],
 ]){
  const result=await tool('web_task',{operationId:'mcp-explore-'+name+'-'+Date.now(),target,goal});
  console.log(name, result.state, result.route, result.steps);assert.equal(result.state,'evidence_found');assert.equal(result.route,'shared-chrome-exploration');assert.match(result.evidence,expected);results.push(result);
 }
 const after=await tool('web_status',{});assert.equal(before.service.pid,after.service.pid);
 console.log('Shared service verified:', after.service.pid);
}finally{clearTimeout(timer);child.stdin.end()}
