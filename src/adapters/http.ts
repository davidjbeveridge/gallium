import { createHash, randomUUID } from 'node:crypto';
import { assertActive, OperatorError } from '../contracts.ts';
import type { Adapter, Candidate, ExecutionContext, Guard, HttpRecipe, Json, Observation, Operation, ScopeConfig, Verification } from '../contracts.ts';

export interface HttpAdapterOptions {
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
  env?: Record<string, string | undefined>;
}

/** Safe metadata only: neither response bodies nor credentials are attached. */
export class HttpRateLimitError extends OperatorError {
  retryAfterMs: number;
  constructor(retryAfterMs: number, beforeEffect: boolean) {
    super('RATE_LIMITED', 'The configured service requested a cooldown.', beforeEffect);
    this.retryAfterMs = retryAfterMs;
  }
}

interface State {
  account: string;
  goal: Json;
  satisfied: boolean;
  revision: string;
}

interface Captured {
  operationId: string;
  scopeId: string;
  binding: string;
  revision: string;
  candidateId?: string;
}

function atPath(value: unknown, path: string): unknown {
  if (!path || !path.split('.').every(key => /^[a-zA-Z0-9_-]+$/.test(key) &&
      !['__proto__', 'prototype', 'constructor'].includes(key))) {
    throw new OperatorError('INVALID_HTTP_RECIPE', 'JSON paths must contain simple property names.');
  }
  let current: unknown = value;
  for (const key of path.split('.')) {
    if (!current || typeof current !== 'object' || !Object.hasOwn(current, key)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function isScalar(value: unknown): value is null | boolean | number | string {
  return value === null || typeof value === 'string' || typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value));
}

function retryAfter(value: string | null): number {
  const seconds = value && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) * 1000 : NaN;
  const date = value ? Date.parse(value) - Date.now() : NaN;
  return Math.min(60 * 60 * 1000, Math.max(1000, Number.isFinite(seconds) ? seconds : Number.isFinite(date) ? date : 60_000));
}

/** Uses only explicitly configured portable API endpoints; it does not export browser cookies. */
export class HttpAdapter implements Adapter {
  readonly name = 'http';
  private scopes: Map<string, ScopeConfig>;
  private fetcher: typeof globalThis.fetch;
  private timeoutMs: number;
  private maxResponseBytes: number;
  private env: Record<string, string | undefined>;
  private observed = new Map<string, Captured>();

  constructor(scopes: ScopeConfig[], options: HttpAdapterOptions = {}) {
    this.scopes = new Map(scopes.map(scope => [scope.id, scope]));
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxResponseBytes = options.maxResponseBytes ?? 65_536;
    this.env = options.env ?? process.env;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 120_000 ||
        !Number.isSafeInteger(this.maxResponseBytes) || this.maxResponseBytes < 1 || this.maxResponseBytes > 1_048_576) {
      throw new OperatorError('INVALID_HTTP_OPTIONS', 'HTTP timeout or response limit is outside the supported range.');
    }
  }

  private setup(operation: Operation): { scope: ScopeConfig; recipe: HttpRecipe; expected: Json; binding: string } {
    const scope = this.scopes.get(operation.recipe.scopeId);
    const recipe = operation.recipe.http;
    if (!scope || operation.recipe.adapter !== 'http' || !recipe) {
      throw new OperatorError('INVALID_HTTP_RECIPE', 'The portable HTTP recipe is not configured.');
    }
    for (const value of [recipe.url, recipe.verifyUrl]) {
      let url: URL;
      try { url = new URL(value); } catch {
        throw new OperatorError('INVALID_HTTP_RECIPE', 'The HTTP recipe contains an invalid URL.');
      }
      if (url.origin !== scope.origin || !['http:', 'https:'].includes(url.protocol) ||
          url.username || url.password || url.hash) {
        throw new OperatorError('ORIGIN_MISMATCH', 'The HTTP recipe URL is outside its configured origin.');
      }
      if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
          Object.keys(recipe.headersFromEnv ?? {}).length > 0) {
        throw new OperatorError('HTTPS_REQUIRED', 'Credential-bearing HTTP requests require HTTPS except on loopback.');
      }
    }
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(recipe.method) ||
        !['read', 'write'].includes(recipe.effect) || (recipe.method !== 'GET' && recipe.effect !== 'write')) {
      throw new OperatorError('INVALID_HTTP_RECIPE', 'HTTP mutation methods must be classified as writes.');
    }
    const expected = recipe.expectedInputKey !== undefined
      ? operation.input[recipe.expectedInputKey]
      : recipe.expected;
    if (!isScalar(expected)) {
      throw new OperatorError('INVALID_HTTP_RECIPE', 'The HTTP goal requires a configured scalar expected value.');
    }
    for (const key of recipe.inputKeys ?? []) {
      if (!Object.hasOwn(operation.input, key) || !isScalar(operation.input[key])) {
        throw new OperatorError('INVALID_HTTP_INPUT', 'A configured HTTP input is missing or invalid.');
      }
    }
    const binding = createHash('sha256').update(JSON.stringify({ recipe, input: operation.input })).digest('hex');
    return { scope, recipe, expected, binding };
  }

  private headers(recipe: HttpRecipe): Headers {
    const headers = new Headers({ Accept: 'application/json' });
    for (const [name, envName] of Object.entries(recipe.headersFromEnv ?? {})) {
      if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(name) ||
          ['host', 'connection', 'content-length', 'transfer-encoding', 'cookie', 'set-cookie'].includes(name.toLowerCase())) {
        throw new OperatorError('INVALID_HTTP_HEADERS', 'A configured HTTP header is unsupported.');
      }
      const secret = this.env[envName];
      if (!secret || /[\r\n]/.test(secret)) {
        throw new OperatorError('HTTP_CREDENTIAL_UNAVAILABLE', 'A configured HTTP credential is missing or invalid.');
      }
      try { headers.set(name, secret); } catch {
        throw new OperatorError('INVALID_HTTP_HEADERS', 'A configured HTTP header is invalid.');
      }
    }
    return headers;
  }

  private async request(url: string, init: RequestInit, guard: Guard, beforeEffect: boolean): Promise<Response> {
    assertActive(guard);
    const signal = AbortSignal.any([guard.signal, AbortSignal.timeout(this.timeoutMs)]);
    let response: Response;
    try {
      response = await this.fetcher(url, { ...init, redirect: 'error', credentials: 'omit', signal });
    } catch {
      throw new OperatorError('HTTP_TRANSPORT_UNKNOWN', 'The configured HTTP request did not return a usable response.', beforeEffect);
    }
    if (response.redirected || (response.url && response.url !== url)) {
      await response.body?.cancel().catch(() => {});
      throw new OperatorError('HTTP_REDIRECT_REJECTED', 'The HTTP endpoint attempted an unexpected redirect.', beforeEffect);
    }
    if (response.status === 429) {
      await response.body?.cancel().catch(() => {});
      throw new HttpRateLimitError(retryAfter(response.headers.get('retry-after')), beforeEffect);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new OperatorError('HTTP_STATUS_' + response.status, 'The configured HTTP service returned an unsuccessful status.', beforeEffect);
    }
    assertActive(guard);
    return response;
  }

  private async json(response: Response): Promise<unknown> {
    const declared = response.headers.get('content-length');
    if (declared && Number(declared) > this.maxResponseBytes) {
      await response.body?.cancel().catch(() => {});
      throw new OperatorError('HTTP_RESPONSE_TOO_LARGE', 'The verification response exceeds the configured limit.');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new OperatorError('HTTP_RESPONSE_INVALID', 'The verification endpoint returned no JSON body.');
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > this.maxResponseBytes) {
          await reader.cancel().catch(() => {});
          throw new OperatorError('HTTP_RESPONSE_TOO_LARGE', 'The verification response exceeds the configured limit.');
        }
        chunks.push(next.value);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (error) {
      if (error instanceof OperatorError) throw error;
      throw new OperatorError('HTTP_RESPONSE_INVALID', 'The verification endpoint returned an invalid JSON body.');
    } finally { reader.releaseLock(); }
  }

  private async state(operation: Operation, guard: Guard): Promise<State> {
    const { scope, recipe, expected } = this.setup(operation);
    const response = await this.request(recipe.verifyUrl, { method: 'GET', headers: this.headers(recipe) }, guard, true);
    const data = await this.json(response);
    assertActive(guard);
    const account = atPath(data, recipe.accountPath);
    const goal = atPath(data, recipe.goalPath);
    if (account !== scope.account) {
      throw new OperatorError('ACCOUNT_MISMATCH', 'The HTTP account differs from the configured account.');
    }
    if (!isScalar(goal)) {
      throw new OperatorError('HTTP_VERIFICATION_INCOMPLETE', 'The configured business-state field is missing or not scalar.');
    }
    return {
      account: account as string, goal, satisfied: goal === expected,
      revision: createHash('sha256').update(JSON.stringify([account, goal])).digest('hex'),
    };
  }

  async observe(operation: Operation, guard: Guard): Promise<Observation> {
    const { scope, recipe, binding } = this.setup(operation);
    const state = await this.state(operation, guard);
    const id = randomUUID();
    const candidate: Candidate | undefined = state.satisfied ? undefined : {
      id: 'http.request', kind: 'request', label: 'Call the configured portable API operation', effect: recipe.effect,
    };
    this.observed.set(id, { operationId: operation.id, scopeId: scope.id, binding, revision: state.revision, candidateId: candidate?.id });
    if (this.observed.size > 256) this.observed.delete(this.observed.keys().next().value!);
    return {
      id, documentId: state.revision, scopeId: scope.id, origin: scope.origin, account: state.account,
      summary: 'The configured API account and business-state field were checked.',
      candidates: candidate ? [candidate] : [], facts: { goalSatisfied: state.satisfied }, capturedAt: Date.now(),
    };
  }

  async execute(operation: Operation, candidate: Candidate, context: ExecutionContext): Promise<void> {
    assertActive(context);
    const { scope, recipe, binding } = this.setup(operation);
    const captured = this.observed.get(context.observation.id);
    if (!captured || captured.operationId !== operation.id || captured.scopeId !== scope.id || captured.binding !== binding ||
        captured.candidateId !== candidate.id || candidate.id !== 'http.request' || candidate.kind !== 'request' ||
        candidate.effect !== recipe.effect || context.observation.scopeId !== scope.id ||
        context.observation.origin !== scope.origin || context.observation.account !== scope.account ||
        context.observation.documentId !== captured.revision) {
      throw new OperatorError('STALE_OBSERVATION', 'Observe the configured API again before acting.');
    }
    const current = await this.state(operation, context);
    if (current.revision !== captured.revision) {
      throw new OperatorError('STALE_OBSERVATION', 'The configured API business state changed after observation.');
    }
    if (this.setup(operation).binding !== binding) {
      throw new OperatorError('STALE_OBSERVATION', 'The configured API operation changed during verification.');
    }
    const headers = this.headers(recipe);
    if (recipe.idempotencyHeader) {
      if (!/^[a-z][a-z0-9-]*$/i.test(recipe.idempotencyHeader) ||
          ['authorization', 'cookie', 'host', 'content-length', 'connection', 'transfer-encoding'].includes(recipe.idempotencyHeader.toLowerCase()) ||
          !/^[\x21-\x7e]{1,200}$/.test(operation.id)) {
        throw new OperatorError('INVALID_HTTP_RECIPE', 'The idempotency header configuration or operation ID is invalid.');
      }
      headers.set(recipe.idempotencyHeader, operation.id);
    }
    let body: string | undefined;
    if (recipe.method !== 'GET') {
      body = JSON.stringify(Object.fromEntries((recipe.inputKeys ?? []).map(key => [key, operation.input[key]])));
      headers.set('Content-Type', 'application/json');
    } else if (recipe.inputKeys?.length) {
      throw new OperatorError('INVALID_HTTP_RECIPE', 'GET recipes cannot have a JSON request body.');
    }
    assertActive(context);
    this.observed.delete(context.observation.id);
    const response = await this.request(recipe.url, { method: recipe.method, headers, body }, context, recipe.effect !== 'write');
    await response.body?.cancel().catch(() => {});
  }

  async verify(operation: Operation, guard: Guard): Promise<Verification> {
    const state = await this.state(operation, guard);
    return state.satisfied
      ? { state: 'satisfied', code: 'HTTP_BUSINESS_STATE_MATCHES' }
      : { state: 'not_satisfied', code: 'HTTP_BUSINESS_STATE_DIFFERS' };
  }
}
