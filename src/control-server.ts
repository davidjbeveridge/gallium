import { createServer } from 'node:http';
import type { Engine } from './engine.ts';

const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Web Operator</title><link rel="stylesheet" href="/style.css"><main><header><span>LOCAL CONTROL</span><h1>Web Operator</h1><p>Run a configured operation. Take over whenever you need the browser.</p></header>
<section><h2>Control</h2><label>Account scope <select id="scope"></select></label><div class="buttons"><button id="pause">Take over</button><button id="resume">Resume</button><button id="cancel">Cancel</button></div><p id="ownership" role="status"></p></section>
<section><h2>Operation</h2><label>Recipe <select id="recipe"></select></label><p id="description"></p><label>Operation ID <input id="operation" autocomplete="off"></label><div id="inputs"></div><button id="run">Run and verify</button><p id="result" role="status"></p></section>
<section><h2>Recent operations</h2><button id="refresh">Refresh status</button><pre id="status"></pre></section><footer>During takeover, wait for “handed_off” and verified detach before entering credentials. Resume returns control; it does not repeat an operation.</footer></main><script src="/app.js"></script></html>`;
const style = `:root{font:16px system-ui;color:#e9edf5;background:#10151e;color-scheme:dark}body{margin:0}main{max-width:820px;margin:48px auto;padding:0 24px}header{margin-bottom:32px}header span{color:#93b3ff;font-size:12px;letter-spacing:.18em}h1{font-size:42px;margin:12px 0}h2{margin-top:0;font-size:21px}p,footer{color:#b4c0d2;line-height:1.6}section{background:#1a2230;border:1px solid #344052;border-radius:14px;padding:24px;margin:20px 0}label{display:block;margin:16px 0}input,select{display:block;width:100%;box-sizing:border-box;font:inherit;padding:10px;margin-top:8px;border:1px solid #59687b;border-radius:6px;background:#10151e}button{font:inherit;cursor:pointer;border:0;border-radius:6px;padding:11px 18px;background:#bad0ff;color:#10151e;margin:4px 8px 4px 0}#pause{background:#ffd18a}#cancel{background:#f1a7a7}button:disabled{opacity:.5;cursor:wait}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}footer{font-size:13px;margin:24px 0}`;
const js = `const el=id=>document.getElementById(id);let recipes=[];
async function request(path,body){const response=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json','X-Web-Operator':'control'},body:JSON.stringify(body)}:{});const data=await response.json();if(!response.ok)throw new Error(data.code||'Request failed');return data;}
function fields(){const recipe=recipes.find(r=>r.id===el('recipe').value);el('description').textContent=recipe?.description||'';el('inputs').replaceChildren();for(const [name,type]of Object.entries(recipe?.inputs||{})){const label=document.createElement('label');label.textContent=name;const input=document.createElement('input');input.dataset.name=name;input.dataset.type=type;input.type=type==='number'?'number':type==='boolean'?'checkbox':'text';label.append(input);el('inputs').append(label);}}
async function refresh(){const data=await request('/api/status');recipes=data.recipes;if(!el('recipe').options.length){for(const recipe of recipes)el('recipe').add(new Option(recipe.id,recipe.id));for(const control of data.controls)el('scope').add(new Option(control.scope_id,control.scope_id));fields();}const control=data.controls.find(c=>c.scope_id===el('scope').value);el('ownership').textContent=control?control.owner+' · '+control.phase:'';el('status').textContent=JSON.stringify(data.operations,null,2);}
for(const action of ['pause','resume','cancel'])el(action).onclick=async()=>{try{const data=await request('/api/control',{scopeId:el('scope').value,action});el('result').textContent=data.code||data.instruction;await refresh();}catch(error){el('result').textContent=error.message;}};
el('run').onclick=async()=>{const button=el('run');button.disabled=true;el('result').textContent='Running…';try{const input={};for(const field of el('inputs').querySelectorAll('input'))input[field.dataset.name]=field.dataset.type==='number'?Number(field.value):field.dataset.type==='boolean'?field.checked:field.value;const data=await request('/api/act',{operationId:el('operation').value,recipe:el('recipe').value,input});el('result').textContent=data.operation?.state+' · '+(data.code||data.operation?.code||'');await refresh();}catch(error){el('result').textContent=error.message;}finally{button.disabled=false;}};
el('operation').value='op-'+crypto.randomUUID();el('recipe').onchange=fields;el('scope').onchange=refresh;el('refresh').onclick=refresh;refresh().catch(error=>el('result').textContent=error.message);`;

export async function createControlServer(engine: Engine, port = 8788) {
  let origin = '';
  const server = createServer((request, response) => {
    const send = (status: number, body: unknown, type = 'application/json') => {
      response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'" });
      response.end(type === 'application/json' ? JSON.stringify(body) : body as string);
    };
    void (async () => {
      if (!origin || request.headers.host !== new URL(origin).host) return send(403, { code: 'HOST_REJECTED' });
      const path = request.url;
      if (request.method === 'GET') {
        if (path === '/') return send(200, html, 'text/html; charset=utf-8');
        if (path === '/style.css') return send(200, style, 'text/css');
        if (path === '/app.js') return send(200, js, 'application/javascript');
        if (path === '/api/status') return send(200, engine.status());
        return send(404, { code: 'NOT_FOUND' });
      }
      if (request.method !== 'POST' || request.headers.origin !== origin || request.headers['x-web-operator'] !== 'control'
        || request.headers['content-type'] !== 'application/json') return send(403, { code: 'ORIGIN_REJECTED' });
      if (Number(request.headers['content-length']) > 32768) return send(413, { code: 'INPUT_LIMIT' });
      const chunks = []; let bytes = 0;
      for await (const chunk of request) { bytes += chunk.length; if (bytes > 32768) return send(413, { code: 'INPUT_LIMIT' }); chunks.push(chunk); }
      const data = JSON.parse(Buffer.concat(chunks).toString());
      if (!data || typeof data !== 'object' || Array.isArray(data)) return send(400, { code: 'INVALID_INPUT' });
      if (path === '/api/control') return send(200, await engine.control(data.scopeId, data.action));
      if (path === '/api/act') return send(200, await engine.act(data));
      return send(404, { code: 'NOT_FOUND' });
    })().catch(error => send(400, { code: /^[A-Z_0-9]{1,64}$/.test(error?.code) ? error.code : 'INVALID_REQUEST' }));
  });
  server.requestTimeout = 15000;
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Control server failed to bind');
  origin = 'http://127.0.0.1:' + address.port;
  return { origin, close: () => new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections(); }) };
}
