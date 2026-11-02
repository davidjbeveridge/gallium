import { createServer } from 'node:http';
import type { Server, IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

interface Profile {
  account: 'demo-user';
  name: string;
  saveCount: number;
  postCount: number;
}

export interface FixtureServer {
  server: Server;
  port: number;
  origin: string;
  close(): Promise<void>;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

function profilePage(profile: Profile, nonce: string, csrf: string): string {
  const result = profile.saveCount > 0
    ? '<output id="saved-result" data-saved-name aria-live="polite">' + escapeHtml(profile.name) + '</output>'
    : '<output id="saved-result" aria-live="polite">Nothing saved yet.</output>';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Web Operator local fixture</title>
<meta name="fixture-csrf" content="${csrf}">
<style nonce="${nonce}">body{font:18px system-ui;max-width:38rem;margin:4rem auto;padding:0 1rem;line-height:1.5}label,input,button,output{display:block;margin:1rem 0}input,button{font:inherit;padding:.6rem}small{color:#555}</style></head>
<body><h1>Local profile fixture</h1><p>This fake profile exists only in this local server's memory.</p>
<p>Account: <strong data-account>demo-user</strong></p>
<form id="profile-form" data-stage="empty"><label for="name">Profile name</label>
<input id="name" name="name" type="text" maxlength="256" autocomplete="off" required>
<button id="save" type="submit" disabled>Save profile</button></form>
<h2>Saved name</h2>${result}<p id="status" role="status"></p>
<small>Restarting the fixture server resets its fake data.</small>
<script nonce="${nonce}">
const form = document.getElementById('profile-form');
const input = document.getElementById('name');
const save = document.getElementById('save');
const result = document.getElementById('saved-result');
const status = document.getElementById('status');
input.addEventListener('input', () => {
  form.dataset.stage = input.value.length ? 'ready' : 'empty';
  save.disabled = !input.value.length;
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!input.value.length || form.dataset.stage !== 'ready') return;
  form.dataset.stage = 'saving';
  save.disabled = true;
  status.textContent = 'Saving…';
  try {
    const response = await fetch('/api/profile', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ name: input.value })
    });
    if (!response.ok) throw new Error('Save failed');
    const profile = await response.json();
    result.textContent = profile.name;
    result.setAttribute('data-saved-name', '');
    form.dataset.stage = 'saved';
    status.textContent = 'Saved.';
  } catch {
    form.dataset.stage = input.value.length ? 'ready' : 'empty';
    save.disabled = !input.value.length;
    status.textContent = 'The save was not confirmed. Check the saved state before retrying.';
  }
});
</script></body></html>`;
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(value));
}

/** A fake loopback service. It has no credentials, browser dependency, or persistent user data. */
export async function createFixtureServer(options: { port?: number } = {}): Promise<FixtureServer> {
  const port = options.port ?? 8787;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Fixture port must be an integer from 0 to 65535.');
  const state: Profile = { account: 'demo-user', name: '', saveCount: 0, postCount: 0 };
  const idempotency = new Map<string, { name: string; result: Profile }>();
  const session = randomBytes(24).toString('hex');
  const csrf = randomBytes(24).toString('hex');
  let origin = '';
  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      if (!response.headersSent) sendJson(response, 500, { error: 'fixture_error' });
      else response.end();
    });
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 1000;

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.headers.host !== new URL(origin).host) {
      sendJson(response, 403, { error: 'host_rejected' });
      return;
    }
    const url = new URL(request.url ?? '/', origin);
    if (url.origin !== origin) { sendJson(response, 403, { error: 'origin_rejected' }); return; }
    if (request.method === 'GET' && (url.pathname === '/profile' || url.pathname === '/')) {
      const nonce = randomBytes(16).toString('base64');
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Set-Cookie': 'fixture_session=' + session + '; HttpOnly; SameSite=Strict; Path=/',
        'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; frame-src chrome-extension:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
      });
      response.end(profilePage(state, nonce, csrf));
      return;
    }
    if (!['/api/profile','/api/session-profile'].includes(url.pathname)) { sendJson(response, 404, { error: 'not_found' }); return; }
    if (url.pathname === '/api/session-profile') {
      if (!request.headers.cookie?.split(';').some(value => value.trim() === 'fixture_session=' + session)) {
        sendJson(response, 401, { error: 'session_required' }); return;
      }
      if (request.method !== 'GET' && request.headers['x-fixture-csrf'] !== csrf) {
        sendJson(response, 403, { error: 'csrf_required' }); return;
      }
    }
    if (request.method === 'GET') { sendJson(response, 200, state); return; }
    if (request.method !== 'POST') { sendJson(response, 405, { error: 'method_not_allowed' }); return; }
    if ((request.headers.origin && request.headers.origin !== origin) ||
        (request.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(String(request.headers['sec-fetch-site'])))) {
      sendJson(response, 403, { error: 'cross_origin_write_rejected' });
      return;
    }
    if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      sendJson(response, 415, { error: 'json_required' });
      return;
    }
    const key = request.headers['idempotency-key'];
    if (key !== undefined && (typeof key !== 'string' || !/^[\x21-\x7e]{1,128}$/.test(key))) {
      sendJson(response, 400, { error: 'invalid_idempotency_key' });
      return;
    }
    if (Number(request.headers['content-length']) > 4096) { sendJson(response, 413, { error: 'body_too_large' }); return; }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > 4096) { sendJson(response, 413, { error: 'body_too_large' }); return; }
      chunks.push(bytes);
    }
    let input: unknown;
    try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { sendJson(response, 400, { error: 'invalid_json' }); return; }
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1 ||
        !Object.hasOwn(input, 'name') || typeof (input as { name?: unknown }).name !== 'string' ||
        (input as { name: string }).name.length < 1 || (input as { name: string }).name.length > 256) {
      sendJson(response, 400, { error: 'name_required' });
      return;
    }
    const name = (input as { name: string }).name;
    state.postCount++;
    const previous = key ? idempotency.get(key) : undefined;
    if (previous) {
      sendJson(response, previous.name === name ? 200 : 409, previous.name === name ? previous.result : { error: 'idempotency_conflict' });
      return;
    }
    if (key && idempotency.size >= 1000) { sendJson(response, 503, { error: 'fixture_idempotency_capacity' }); return; }
    state.name = name;
    state.saveCount++;
    const result = { ...state };
    if (key) idempotency.set(key, { name, result });
    sendJson(response, 200, result);
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture server did not bind a TCP port.');
  origin = 'http://127.0.0.1:' + address.port;
  let closing: Promise<void> | undefined;
  return {
    server, port: address.port, origin,
    close() {
      closing ??= new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        server.closeIdleConnections();
      });
      return closing;
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fixture = await createFixtureServer();
  process.stdout.write('Local fake profile: ' + fixture.origin + '/profile\n');
  process.once('SIGINT', () => { void fixture.close(); });
  process.once('SIGTERM', () => { void fixture.close(); });
}
