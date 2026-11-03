import { request } from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { createHash } from 'node:crypto';
import { OperatorError } from './contracts.ts';
import type { Engine } from './engine.ts';
import { systemOne } from './navigators.ts';

/** Restrict unauthenticated reconnaissance to public IPv4. DNS is pinned for the request. */
export function publicAddress(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a,b] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0,168].includes(b)) ||
    (a === 198 && [18,19,51].includes(b)) || (a === 203 && b === 0));
}

export function publicTarget(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new OperatorError('INPUT','Provide a public HTTPS URL.'); }
  if (value.length > 2048 || url.protocol !== 'https:' || url.username || url.password ||
    (url.port && url.port !== '443'))
    throw new OperatorError('PUBLIC_TARGET_REQUIRED','Public reads require HTTPS without credentials or custom ports.');
  for (const key of url.searchParams.keys()) {
    if (/token|key|auth|session|password|secret|signature/i.test(key))
      throw new OperatorError('PUBLIC_TARGET_REQUIRED','Credential-bearing URLs require a configured procedure.');
  }
  return url;
}

export async function fetchPublicText(target: string, signal: AbortSignal): Promise<string> {
  const url = publicTarget(target);
  const addresses = await lookup(url.hostname, { all: true, family: 4 });
  if (!addresses.length || addresses.some(item => !publicAddress(item.address)))
    throw new OperatorError('PUBLIC_TARGET_REQUIRED','The target must resolve to a public address.');
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: 'GET', signal,
      headers: { Accept: 'text/html, text/plain, application/json', 'User-Agent': 'WebOperator/0.2' },
      lookup: (_hostname, options, callback: any) => {
        if ((options as any).all) callback(null, [addresses[0]]);
        else callback(null, addresses[0].address, 4);
      },
    }, response => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new OperatorError('PUBLIC_HTTP_STATUS','The public source requires a different URL or authentication.'));
        return;
      }
      const type = String(response.headers['content-type'] || '').split(';')[0];
      if (!['text/html','text/plain','application/json'].includes(type)) {
        response.resume(); reject(new OperatorError('PUBLIC_CONTENT_TYPE','Unsupported public document format.')); return;
      }
      const chunks: Buffer[] = []; let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 256 * 1024) { req.destroy(new Error('body limit')); return; }
        chunks.push(chunk);
      });
      response.on('error', () => reject(new OperatorError('PUBLIC_FETCH_FAILED','Public document fetch failed.')));
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.setTimeout(10000, () => req.destroy(new Error('timeout')));
    req.on('error', () => reject(new OperatorError('PUBLIC_FETCH_FAILED','Public document fetch failed.')));
    req.end();
  });
}

/** Conservative text projection. Output is source evidence, never instructions or generated prose. */
export function evidenceBlocks(document: string): string[] {
  const html = /<(?:html|!doctype|p|article|body)\b/i.test(document);
  const projected = html ? document
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\/(?:p|div|article|section|h[1-6]|li|tr)>/gi, '\n\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : document;
  return projected.split(/\n\s*\n/).map(text => text.trim().replace(/\s+/g,' '))
    .filter(text => text.length > 15 && text.length <= 2000).slice(0,64);
}

export async function readPublicTask(engine: Engine, task: { operationId: string; goal: string; target: string }, signal: AbortSignal) {
  const url = publicTarget(task.target);
  const provider = engine.config.taskRouter;
  if (!provider) throw new OperatorError('ROUTER_REQUIRED','Configure the System One router.');
  // The journal stores a fingerprint, never the page body or task text.
  const fingerprint = engine.journal.fingerprint(task);
  engine.journal.transaction(() => {
    if (engine.journal.get(task.operationId) || engine.journal.db.prepare('SELECT id FROM task_routes WHERE id=?').get(task.operationId))
      throw new OperatorError('OPERATION_CONFLICT','This operation ID already belongs to a configured task.');
    engine.journal.db.prepare('INSERT OR IGNORE INTO public_tasks(id,fingerprint,state) VALUES(?,?,?)')
      .run(task.operationId, fingerprint, 'prepared');
    const previous = engine.journal.db.prepare('SELECT fingerprint FROM public_tasks WHERE id=?').get(task.operationId) as any;
    if (previous.fingerprint !== fingerprint) throw new OperatorError('OPERATION_CONFLICT','Task inputs changed.');
  });
  const unavailable = (code: string) => {
    engine.journal.db.prepare('UPDATE public_tasks SET state=? WHERE id=?').run(code.toLowerCase(),task.operationId);
    return { code, operationId:task.operationId };
  };
  const ask = async (state: unknown, questions: unknown) => {
    const started = performance.now();
    const response = await systemOne(provider, { model: provider.model ?? 'jev-latest', state, questions }, signal);
    engine.journal.db.prepare('INSERT INTO model_usage(model,cost,elapsed_ms,created_at) VALUES(?,?,?,?)')
      .run(response.model ?? 'unknown', response.usage?.cost ?? null, Math.round(performance.now()-started), Date.now());
    return response.answers;
  };
  const intent = await ask({ goal: task.goal }, {
    information: { type:'noul', instructions:'Is the requested outcome retrieving or checking public information, possibly through navigation, search, or display-only UI interaction?',
      criteria:{true:'The task reads, finds, checks, or reveals information through read-only interaction.',false:'The task changes stored data or settings, authenticates, purchases, sends a message, or performs another consequential side effect.'} },
    interactive: { type: 'noul', instructions: 'Does the user explicitly request interacting with the live interface, rather than merely obtaining a factual answer?', criteria: { true: 'The goal requests using, opening, clicking, searching, or revealing something in the interface.', false: 'A factual answer from document text suffices.' } },
  });
  if (!validNoul(intent?.information) || !validNoul(intent?.interactive)) throw new OperatorError('NAVIGATOR_RESPONSE_INVALID','Invalid intent judgment.');
  if (intent.information.noul < 0.7) return unavailable('CONFIGURED_PROCEDURE_REQUIRED');
  const explore = async () => {
    let result;
    try { result = await engine.explore(url.href, task.goal, ask, signal); }
    catch (error) {
      unavailable(error instanceof OperatorError ? error.code : signal.aborted ? 'INTERRUPTED' : 'EXPLORATION_FAILED');
      throw error;
    }
    engine.journal.db.prepare('UPDATE public_tasks SET state=?,evidence_hash=? WHERE id=?')
      .run(('state' in result ? result.state : result.code.toLowerCase()) ?? 'unknown', 'evidenceHash' in result ? result.evidenceHash ?? null : null, task.operationId);
    return { operationId: task.operationId, ...result };
  };
  if (intent.interactive.noul >= 0.7) return explore();
  let document: string;
  try { document = await fetchPublicText(url.href, signal); }
  catch (error) {
    if (error instanceof OperatorError && ['PUBLIC_HTTP_STATUS','PUBLIC_FETCH_FAILED'].includes(error.code)) return explore();
    throw error;
  }
  const blocks = evidenceBlocks(document);
  if (!blocks.length) return explore();
  const candidates = Object.fromEntries(blocks.map((text,index)=>['passage_'+index,text]));
  const answers = await ask({ goal:task.goal, source:url.href, passages:candidates }, {
    supported:{type:'noul',instructions:'Does at least one supplied passage directly provide the information requested by goal?',
      criteria:{true:'A passage directly answers the requested factual question.',false:'The requested information is absent, incomplete, or only suggested by unrelated text.'}},
    passage:{type:'choice',instructions:'Which supplied passage directly answers goal?',criteria:candidates},
  });
  if (!validNoul(answers?.supported)) throw new OperatorError('NAVIGATOR_RESPONSE_INVALID','Invalid evidence judgment.');
  if (answers.supported.noul < 0.7) return explore();
  const selected = answers?.passage?.choice;
  if (typeof selected !== 'string' || !Object.hasOwn(candidates,selected))
    throw new OperatorError('NAVIGATOR_RESPONSE_INVALID','Invalid evidence selection.');
  const evidence = candidates[selected];
  const digest = createHash('sha256').update(evidence).digest('hex');
  engine.journal.db.prepare('UPDATE public_tasks SET state=?,evidence_hash=? WHERE id=?').run('evidence_found',digest,task.operationId);
  return { operationId:task.operationId, state:'evidence_found', route:'public-http', source:url.href,
    evidence, evidenceHash:digest, verification:'Passage reproduced from fetched source text; relevance assessed by Jev.', coverage:'bounded_excerpt', pageContentTrust:'untrusted' };
}
function validNoul(value: any): boolean {
  return value?.type === 'noul' && typeof value.noul === 'number' && Number.isFinite(value.noul) && value.noul >= 0 && value.noul <= 1;
}
