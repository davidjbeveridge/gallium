import { HttpAdapter } from './http.ts';
import { PlaywriterAdapter } from './playwriter.ts';
import { assertActive, OperatorError } from '../contracts.ts';
import type { Adapter, Candidate, ExecutionContext, Guard, Observation, Operation, ScopeConfig, Verification } from '../contracts.ts';

/** Same operation journal and HTTP verifier; credentials and CSRF remain inside Chrome. */
export class BrowserRequestAdapter implements Adapter {
  readonly name = 'browser-request';
  private bridge: PlaywriterAdapter;
  private scopes: ScopeConfig[];
  private delegates = new Map<string, { scopeId: string; adapter: HttpAdapter; guard: Guard }>();
  constructor(bridge: PlaywriterAdapter, scopes: ScopeConfig[]) { this.bridge = bridge; this.scopes = scopes; }

  private setup(operation: Operation, guard: Guard) {
    assertActive(guard);
    if (operation.recipe.adapter !== 'browser-request' || !operation.recipe.http || !operation.recipe.browser)
      throw new OperatorError('BROWSER_REQUEST_CONFIG', 'A browser request needs explicit endpoints and identity checks.');
    const csrf = operation.recipe.browser.csrf;
    if (csrf && (!/^x-[a-z0-9-]+$/i.test(csrf.header) || !/^[a-z][a-z0-9-]*$/i.test(csrf.attribute)))
      throw new OperatorError('BROWSER_REQUEST_CONFIG', 'Use an explicit CSRF attribute and X- header.');
    const browserOperation = { ...operation, recipe: { ...operation.recipe, adapter: 'playwriter' as const } };
    let entry = this.delegates.get(operation.id);
    if (!entry) {
      entry = { scopeId: operation.recipe.scopeId, guard, adapter: undefined! };
      const current = entry;
      const fetcher = async (url: string | URL | Request, init: RequestInit = {}) => {
        assertActive(current.guard);
        const page = await this.bridge.page(browserOperation, current.guard);
        const scope = this.scopes.find(scope => scope.id === current.scopeId)!;
        if (new URL(String(url)).origin !== scope.origin) throw new Error('Origin mismatch');
        assertActive(current.guard);
        const result = await page.evaluate(async (args: any) => {
          if (location.origin !== args.origin || new URL(args.url).origin !== location.origin) throw new Error('Origin mismatch');
          const headers = new Headers(args.headers);
          if (args.csrf && args.method !== 'GET') {
            const nodes = document.querySelectorAll(args.csrf.selector);
            if (nodes.length !== 1) throw new Error('CSRF acquisition unavailable');
            const value = nodes[0].getAttribute(args.csrf.attribute);
            if (!value || value.length > 4096) throw new Error('CSRF acquisition unavailable');
            headers.set(args.csrf.header, value);
          }
          const response = await fetch(args.url, { method: args.method, headers, body: args.body,
            credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000) });
          const responseHeaders = Object.fromEntries(['content-type','retry-after'].flatMap(name => {
            const value = response.headers.get(name); return value ? [[name, value]] : [];
          }));
          let body = '';
          if (args.method === 'GET' && response.ok) {
            if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('JSON required');
            const reader = response.body!.getReader(); let bytes = 0; const chunks = [];
            try { while (true) { const part = await reader.read(); if (part.done) break;
              bytes += part.value.length; if (bytes > 65536) throw new Error('Response limit'); chunks.push(part.value); }
            } finally { await reader.cancel().catch(() => {}); }
            const joined = new Uint8Array(bytes); let offset = 0;
            for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
            const data = JSON.parse(new TextDecoder().decode(joined));
            const projected: any = {};
            for (const path of args.paths) {
              const parts = path.split('.'); let source = data, target = projected;
              for (const key of parts) { if (!/^[a-zA-Z0-9_-]+$/.test(key) || ['__proto__','constructor','prototype'].includes(key)) throw new Error('Invalid path'); source = source?.[key]; }
              for (const key of parts.slice(0, -1)) target = target[key] ??= {};
              if (source !== null && !['string','number','boolean'].includes(typeof source)) throw new Error('Scalar required');
              target[parts.at(-1)] = source;
            }
            body = JSON.stringify(projected);
          } else await response.body?.cancel();
          return { status: response.status, headers: responseHeaders, body };
        }, { origin: scope.origin, url: String(url), method: init.method || 'GET', headers: Object.fromEntries(new Headers(init.headers)),
          body: init.body, csrf, paths: [operation.recipe.http!.accountPath, operation.recipe.http!.goalPath] });
        assertActive(current.guard);
        return new Response(result.body || null, { status: result.status, headers: result.headers });
      };
      entry.adapter = new HttpAdapter(this.scopes, { fetch: fetcher as typeof fetch });
      this.delegates.set(operation.id, entry);
    }
    entry.guard = guard;
    return { adapter: entry.adapter, operation: { ...operation, recipe: { ...operation.recipe, adapter: 'http' as const } } };
  }
  async observe(operation: Operation, guard: Guard): Promise<Observation> {
    const next = this.setup(operation, guard); return next.adapter.observe(next.operation, guard);
  }
  async execute(operation: Operation, candidate: Candidate, context: ExecutionContext): Promise<void> {
    const next = this.setup(operation, context); await next.adapter.execute(next.operation, candidate, context);
  }
  async verify(operation: Operation, guard: Guard): Promise<Verification> {
    const next = this.setup(operation, guard); return next.adapter.verify(next.operation, guard);
  }
  async release(scopeId: string): Promise<void> {
    for (const [id, entry] of this.delegates) if (entry.scopeId === scopeId) this.delegates.delete(id);
    await this.bridge.release(scopeId);
  }
  async control(scopeId: string, action: 'pause' | 'resume' | 'cancel') { await this.bridge.control(scopeId, action); }
}
