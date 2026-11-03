import { runTask, type TaskRequest } from './task-controller.ts';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { OperatorError, assertActive } from './contracts.ts';
import type { Adapter, Config, Guard, Inputs, Navigator, Observation, Operation, Recipe } from './contracts.ts';
import { Journal } from './journal.ts';
import type { RecordRow } from './journal.ts';
import { validateId, validateInput } from './config.ts';

interface ActRequest { operationId: string; recipe: string; input: Inputs; maxActions?: number; }
type AdapterMap = Partial<Record<Recipe['adapter'], Adapter>>;

function pending(row: RecordRow): boolean { return ['dispatched','acknowledged','unknown'].includes(row.effect); }
function publicRow(row: RecordRow): Record<string, unknown> {
  const { fingerprint, ...safe } = row;
  return safe;
}

/** The only execution loop. Navigators propose; adapters execute; local verifiers adjudicate completion. */
export class Engine {
  readonly journal: Journal;
  readonly config: Config;
  private adapters: AdapterMap;
  private navigators: Record<string, Navigator>;
  private active = new Map<string, AbortController>();
  private shuttingDown = false;
  private queues = new Map<string, Promise<void>>();

  private schedule<T>(recipe: Recipe, execute: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.journal.control(recipe.scopeId).owner === 'human') return execute();
    const keys = ['scope:' + recipe.scopeId];
    if (['playwriter','browser-request'].includes(recipe.adapter)) keys.push('browser');
    const epoch = this.journal.control(recipe.scopeId).epoch;
    const previous = Promise.all(keys.map(key => this.queues.get(key)));
    const pending = previous.then(() => {
      signal?.throwIfAborted();
      if (this.journal.control(recipe.scopeId).epoch !== epoch)
        throw new OperatorError('CONTROL_REVOKED','Ownership changed while the task was queued.');
      return execute();
    });
    const tail = pending.then(() => {}, () => {});
    for (const key of keys) this.queues.set(key, tail);
    void tail.then(() => {
      for (const key of keys) if (this.queues.get(key) === tail) this.queues.delete(key);
    });
    return pending;
  }

  constructor(config: Config, adapters: AdapterMap, navigators: Record<string, Navigator>, journal?: Journal) {
    this.config = config;
    this.adapters = adapters;
    this.navigators = navigators;
    this.journal = journal ?? new Journal(config.stateDir);
    for (const scope of config.scopes) this.journal.ensureScope(scope.id);
  }

  async task(request: TaskRequest, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return runTask(this, request, signal);
  }

  private recipe(id: string): Recipe {
    const recipe = this.config.recipes.find(r => r.id === id);
    if (!recipe) throw new OperatorError('UNKNOWN_RECIPE', 'Choose a configured recipe from web_status.');
    return recipe;
  }

  private adapter(recipe: Recipe): Adapter {
    const adapter = this.adapters[recipe.adapter];
    if (!adapter) throw new OperatorError('ADAPTER_UNAVAILABLE', 'This adapter has not been configured.');
    return adapter;
  }

  private checkObservation(op: Operation, obs: Observation): void {
    const scope = this.config.scopes.find(s => s.id === op.recipe.scopeId)!;
    if (obs.scopeId !== scope.id || obs.origin !== scope.origin || obs.account !== scope.account)
      throw new OperatorError('ACCOUNT_MISMATCH', 'The observed origin/account does not match the configured authentication context.');
    if (Date.now() - obs.capturedAt > 30000 || obs.capturedAt > Date.now() + 1000)
      throw new OperatorError('STALE_OBSERVATION', 'Observation expired; inspect the current state again.');
    const ids = new Set<string>();
    for (const candidate of obs.candidates) {
      if (!candidate.id || ids.has(candidate.id) || !['read','ui','write'].includes(candidate.effect))
        throw new OperatorError('INVALID_OBSERVATION', 'The adapter produced an invalid candidate set.');
      ids.add(candidate.id);
      if (candidate.inputKey && !Object.hasOwn(op.input, candidate.inputKey))
        throw new OperatorError('INVALID_OBSERVATION', 'An action refers to an unavailable input binding.');
    }
  }

  status(scopeId?: string, operationId?: string): Record<string, unknown> {
    if (scopeId && !this.config.scopes.some(s => s.id === scopeId)) throw new OperatorError('UNKNOWN_SCOPE', 'Unknown configured scope.');
    if (operationId) {
      const publicTask = this.journal.db.prepare('SELECT id,state,evidence_hash FROM public_tasks WHERE id=?').get(operationId);
      if (publicTask) return { publicTask };
      const row = this.journal.get(operationId);
      if (!row) throw new OperatorError('UNKNOWN_OPERATION', 'Unknown operation ID.');
      return { operation: publicRow(row), control: this.controlStatus(row.scope_id) };
    }
    return {
      version: '0.2.0',
      recipes: this.config.recipes.filter(r => !scopeId || r.scopeId === scopeId).map(r => ({ id: r.id, scopeId: r.scopeId, description: r.description, adapter: r.adapter, inputs: r.inputs, navigator: r.navigator ?? 'deterministic' })),
      controls: this.config.scopes.filter(s => !scopeId || s.id === scopeId).map(s => this.controlStatus(s.id)),
      operations: this.journal.list(scopeId).map(publicRow),
    };
  }

  private controlStatus(scopeId: string): Record<string, unknown> {
    const control = this.journal.control(scopeId);
    const lease = this.journal.lease(scopeId);
    const browser = this.config.recipes.some(recipe => recipe.scopeId === scopeId && ['playwriter','browser-request'].includes(recipe.adapter));
    const detached = !browser || this.journal.browserControl(scopeId) === 'detached';
    return { ...control, phase: lease ? (control.owner === 'human' ? 'quiescing' : 'active') : (control.owner === 'human' ? (detached ? 'handed_off' : 'detach_required') : 'ready'),
      browserDetached: browser ? detached : null, leaseExpiresAt: lease?.expires_at ?? null };
  }

  private async transitionAdapters(scopeId: string, action: 'pause' | 'resume' | 'cancel') {
    const adapters = new Set(this.config.recipes.filter(recipe => recipe.scopeId === scopeId).map(recipe => this.adapter(recipe)));
    for (const adapter of adapters) await adapter.control?.(scopeId, action);
    this.journal.setBrowserControl(scopeId, action === 'resume' ? 'attached' : 'detached');
  }

  private async releaseAdapter(adapter: Adapter, scopeId: string) {
    await adapter.release?.(scopeId);
    if (this.journal.control(scopeId).owner === 'human') {
      try { await this.transitionAdapters(scopeId, 'pause'); }
      catch { this.journal.setBrowserControl(scopeId, 'unknown'); }
    }
  }

  async control(scopeId: string, action: 'pause' | 'resume' | 'cancel'): Promise<Record<string, unknown>> {
    if (!['pause','resume','cancel'].includes(action)) throw new OperatorError('INPUT', 'Control action must be pause, resume, or cancel.');
    this.journal.control(scopeId);
    const existingLease = this.journal.lease(scopeId);
    if (action === 'resume' && existingLease && existingLease.expires_at > Date.now()) return { control: this.controlStatus(scopeId), code: 'CONTROL_BUSY' };
    if (action !== 'resume') {
      this.journal.changeControl(scopeId, action);
      this.journal.setBrowserControl(scopeId, 'unknown');
    }
    const controller = this.active.get(scopeId);
    if (controller) controller.abort(new OperatorError('CONTROL_REVOKED', 'Control ownership changed.'));
    if (action !== 'resume') {
      // Give an active worker time to stop and release keys. Do not announce handoff until it quiesces.
      const until = Date.now() + 1000;
      while (this.journal.lease(scopeId) && Date.now() < until) await delay(20);
    }
    if (!this.journal.lease(scopeId) || action === 'resume') {
      try {
        await this.transitionAdapters(scopeId, action);
        if (action === 'resume') this.journal.changeControl(scopeId, action);
      } catch {
        // A failed bridge transition never leaves the scope with agent ownership.
        if (action === 'resume') this.journal.changeControl(scopeId, 'pause');
        return { control: this.controlStatus(scopeId), code: 'BROWSER_CONTROL_REQUIRED', instruction: 'The bridge could not verify detach/reattach. Use the extension to detach before authentication. Keep this scope paused until the bridge is ready.' };
      }
    }
    return { control: this.controlStatus(scopeId), instruction: action === 'resume'
      ? 'Reissue the same web_act operation ID and inputs. It will observe again and reconcile before continuing.'
      : 'Wait for handed_off before using the page. Resume explicitly after authentication or other manual work.' };
  }

  private lease(scopeId: string, external?: AbortSignal): { guard: Guard; stop: () => Promise<void> } {
    if (this.shuttingDown) throw new OperatorError('SHUTDOWN', 'The operator is shutting down.');
    const owner = randomUUID();
    const epoch = this.journal.acquire(scopeId, owner);
    const controller = new AbortController();
    this.active.set(scopeId, controller);
    const signal = external ? AbortSignal.any([external, controller.signal]) : controller.signal;
    let lastRenew = Date.now();
    const guard: Guard = { signal, epoch, assertCurrent: () => this.journal.assertLease(scopeId, owner, epoch) };
    const timer = setInterval(() => {
      try {
        guard.assertCurrent();
        if (Date.now() - lastRenew > 5000) { this.journal.renew(scopeId, owner, epoch); lastRenew = Date.now(); }
      } catch { controller.abort(new OperatorError('CONTROL_REVOKED', 'The worker no longer owns this context.')); }
    }, 100);
    timer.unref();
    return { guard, stop: async () => {
      clearInterval(timer);
      // The active adapter has finished before release. Browser release implementations must not close user tabs.
      this.journal.release(scopeId, owner);
      if (this.active.get(scopeId) === controller) this.active.delete(scopeId);
    } };
  }

  async read(recipeId: string, input: Inputs, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return this.schedule(this.recipe(recipeId), () => this.readInternal(recipeId, input, signal), signal);
  }

  private async readInternal(recipeId: string, input: Inputs, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const recipe = this.recipe(recipeId);
    const op: Operation = { id: 'read-' + randomUUID(), recipe, input: validateInput(recipe, input) };
    const adapter = this.adapter(recipe);
    const deadline = AbortSignal.timeout(30000);
    const lease = this.lease(recipe.scopeId, signal ? AbortSignal.any([signal, deadline]) : deadline);
    try {
      assertActive(lease.guard);
      const observation = await adapter.observe(op, lease.guard);
      assertActive(lease.guard);
      this.checkObservation(op, observation);
      return { observation, pageContentTrust: 'untrusted', controlEpoch: lease.guard.epoch };
    } finally {
      try { await this.releaseAdapter(adapter, recipe.scopeId); }
      finally { await lease.stop(); }
    }
  }

  async act(request: ActRequest, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return this.schedule(this.recipe(request.recipe), () => this.actInternal(request, signal), signal);
  }

  private async actInternal(request: ActRequest, signal?: AbortSignal): Promise<Record<string, unknown>> {
    validateId(request.operationId);
    const recipe = this.recipe(request.recipe);
    const op: Operation = { id: request.operationId, recipe, input: validateInput(recipe, request.input) };
    const scope = this.config.scopes.find(s => s.id === recipe.scopeId)!;
    const fingerprint = this.journal.fingerprint({ recipe, scope, input: op.input });
    let row = this.journal.prepare(op.id, recipe.scopeId, recipe.id, fingerprint);
    if (row.state === 'verified') return this.result(op.id, 'ALREADY_VERIFIED');
    const limit = request.maxActions ?? recipe.maxActions ?? 6;
    if (!Number.isInteger(limit) || limit < 1 || limit > (recipe.maxActions ?? 12))
      throw new OperatorError('INPUT', 'Action budget exceeds the configured range.');
    if (this.journal.control(recipe.scopeId).owner !== 'agent') return this.result(op.id, 'PAUSED');
    const adapter = this.adapter(recipe);
    const deadline = AbortSignal.timeout(45000);
    const lease = this.lease(recipe.scopeId, signal ? AbortSignal.any([signal, deadline]) : deadline);
    let wrote = pending(row);
    let outgoing: Record<string, unknown> | undefined;
    const finish = (code?: string) => { outgoing = this.result(op.id, code); return outgoing; };
    try {
      assertActive(lease.guard);
      // Goal-first reconciliation also handles a user who completed the task during handoff.
      const initial = await adapter.verify(op, lease.guard);
      assertActive(lease.guard);
      if (initial.state === 'satisfied') {
        this.journal.update(op.id, 'verified', 'GOAL_VERIFIED', 'verified');
        return finish();
      }
      row = this.journal.get(op.id)!;
      if (pending(row)) {
        this.journal.update(op.id, 'unknown', 'RECONCILIATION_REQUIRED', 'unknown');
        return finish();
      }
      if (row.cancel_requested) return finish('CANCELLED');
      if (initial.state === 'unknown') {
        this.journal.update(op.id, 'needs_supervisor', 'VERIFICATION_UNAVAILABLE');
        return finish();
      }
      const unresolved = this.journal.unresolved(recipe.scopeId, op.id);
      if (unresolved) {
        this.journal.update(op.id, 'needs_supervisor', 'SCOPE_RECONCILIATION_REQUIRED');
        const result = finish();
        result.unresolvedOperationId = unresolved.id;
        return result;
      }
      const navigatorName = recipe.navigator ?? 'deterministic';
      const navigator = this.navigators[navigatorName];
      if (!navigator) throw new OperatorError('NAVIGATOR_UNAVAILABLE', 'The configured navigator is unavailable.');
      this.journal.update(op.id, 'running', 'RUNNING');
      let previousSignature = '';
      let unchanged = 0;
      for (let step = 0; step < limit; step++) {
        assertActive(lease.guard);
        if (this.journal.get(op.id)!.actions >= 100) throw new OperatorError('BUDGET_EXHAUSTED', 'The operation reached its total action budget.');
        const observation = await adapter.observe(op, lease.guard);
        assertActive(lease.guard);
        this.checkObservation(op, observation);
        const signature = JSON.stringify([observation.documentId, observation.facts, observation.candidates]);
        unchanged = signature === previousSignature ? unchanged + 1 : 0;
        previousSignature = signature;
        if (unchanged >= 2) {
          this.journal.update(op.id, 'needs_supervisor', 'NO_PROGRESS');
          return finish();
        }
        const decision = await navigator.choose({ operationId: op.id, goal: recipe.description, input: op.input, observation, epoch: lease.guard.epoch }, lease.guard.signal);
        assertActive(lease.guard); // Discards every decision made before takeover, cancellation, or scope revocation.
        this.checkObservation(op, observation);
        if (decision.type !== 'act') {
          if (decision.type === 'done') {
            const verified = await adapter.verify(op, lease.guard);
            assertActive(lease.guard);
            this.journal.update(op.id, verified.state === 'satisfied' ? 'verified' : 'needs_supervisor', verified.state === 'satisfied' ? 'GOAL_VERIFIED' : 'UNVERIFIED_DONE', verified.state === 'satisfied' ? 'verified' : undefined);
          } else this.journal.update(op.id, 'needs_supervisor', decision.type === 'blocked' ? 'NAVIGATOR_BLOCKED' : 'NAVIGATOR_ESCALATED');
          return finish();
        }
        const candidate = observation.candidates.find(c => c.id === decision.candidateId);
        if (!candidate) throw new OperatorError('INVALID_CANDIDATE', 'Navigator selected an action outside the observed candidate set.');
        assertActive(lease.guard);
        this.journal.beforeDispatch(op.id, candidate.effect === 'write');
        wrote = candidate.effect === 'write';
        try {
          await adapter.execute(op, candidate, { ...lease.guard, observation });
        } catch (error) {
          if (wrote && error instanceof OperatorError && error.beforeEffect) {
            wrote = false;
            this.journal.update(op.id, 'running', 'REJECTED_BEFORE_EFFECT', 'none');
          }
          throw error;
        }
        assertActive(lease.guard);
        if (wrote) this.journal.update(op.id, 'running', 'WRITE_ACKNOWLEDGED', 'acknowledged');
        const verification = await adapter.verify(op, lease.guard);
        assertActive(lease.guard);
        if (verification.state === 'satisfied') {
          this.journal.update(op.id, 'verified', 'GOAL_VERIFIED', 'verified');
          return finish();
        }
        if (wrote) {
          this.journal.update(op.id, 'unknown', 'RECONCILIATION_REQUIRED', 'unknown');
          return finish(); // Never switch routes or retry a possibly completed write.
        }
        if (verification.state === 'unknown') {
          this.journal.update(op.id, 'needs_supervisor', 'VERIFICATION_UNAVAILABLE');
          return finish();
        }
      }
      this.journal.update(op.id, 'needs_supervisor', 'BUDGET_EXHAUSTED');
      return finish();
    } catch (error) {
      const known = error instanceof OperatorError;
      const code = deadline.aborted ? 'TIME_BUDGET_EXHAUSTED' : known ? error.code : lease.guard.signal.aborted ? 'INTERRUPTED' : 'ADAPTER_ERROR';
      if (known && error.retryAfterMs) this.journal.cooldown(recipe.scopeId, error.retryAfterMs);
      row = this.journal.get(op.id)!;
      if (wrote || pending(row)) this.journal.update(op.id, 'unknown', code, 'unknown');
      else if (this.journal.control(recipe.scopeId).owner === 'human')
        this.journal.update(op.id, row.cancel_requested ? 'cancelled' : 'paused', code);
      else this.journal.update(op.id, 'needs_supervisor', code);
      if (['ACCOUNT_MISMATCH','AUTH_REQUIRED','CHALLENGE_REQUIRED'].includes(code)) {
        this.journal.changeControl(recipe.scopeId, 'pause');
      }
      return finish(code);
    } finally {
      try { await this.releaseAdapter(adapter, recipe.scopeId); }
      finally {
        await lease.stop();
        if (outgoing) outgoing.control = this.controlStatus(recipe.scopeId);
      }
    }
  }

  private result(id: string, code?: string): Record<string, unknown> {
    const row = this.journal.get(id)!;
    return { operation: publicRow(row), control: this.controlStatus(row.scope_id), ...(code ? { code } : {}) };
  }

  async close(): Promise<void> {
    this.shuttingDown = true;
    for (const controller of this.active.values()) controller.abort(new OperatorError('SHUTDOWN', 'Operator shutting down.'));
    const until = Date.now() + 5000;
    while (this.active.size && Date.now() < until) await delay(20);
    if (this.active.size) return; // Leave durable leases/effect state for explicit recovery; do not close SQLite under live work.
    for (const adapter of new Set(Object.values(this.adapters))) await adapter?.close?.();
    this.journal.close();
  }
}
