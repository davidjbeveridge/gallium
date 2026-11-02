import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { assertActive, OperatorError } from '../contracts.ts';
import type { Adapter, Candidate, ExecutionContext, Guard, Observation, Operation, ScopeConfig, Verification } from '../contracts.ts';

interface State {
  version: 1;
  account: string;
  revision: number;
  draft: string;
  saved: string;
  saveCount: number;
}

interface Captured {
  operationId: string;
  scopeId: string;
  recipeId: string;
  name: string;
  revision: number;
  candidate?: Candidate;
}

/** A fake two-step profile form. It never touches a browser or an external service. */
export class FixtureAdapter implements Adapter {
  readonly name = 'fixture';
  private stateDir: string;
  private scopes: Map<string, ScopeConfig>;
  private observed = new Map<string, Captured>();

  constructor(stateDir: string, scopes: ScopeConfig[]) {
    this.stateDir = join(stateDir, 'fixture');
    this.scopes = new Map(scopes.map(scope => [scope.id, scope]));
    mkdirSync(this.stateDir, { recursive: true, mode: 0o700 });
  }

  private setup(operation: Operation): { scope: ScopeConfig; name: string; path: string } {
    const scope = this.scopes.get(operation.recipe.scopeId);
    if (!scope || operation.recipe.adapter !== 'fixture') {
      throw new OperatorError('INVALID_FIXTURE_SCOPE', 'The fixture scope is not configured.');
    }
    const name = operation.input.name;
    if (typeof name !== 'string' || name.length > 256) {
      throw new OperatorError('INVALID_FIXTURE_INPUT', 'The fixture requires a name string of at most 256 characters.');
    }
    const file = createHash('sha256').update(scope.id).digest('hex') + '.json';
    return { scope, name, path: join(this.stateDir, file) };
  }

  private read(path: string, scope: ScopeConfig): State {
    let raw: string;
    try {
      raw = readFileSync(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { version: 1, account: scope.account, revision: 0, draft: '', saved: '', saveCount: 0 };
      }
      throw new OperatorError('FIXTURE_STATE_UNAVAILABLE', 'The fixture state could not be read.');
    }
    let state: State;
    try { state = JSON.parse(raw); } catch {
      throw new OperatorError('FIXTURE_STATE_INVALID', 'The fixture state is not valid JSON.');
    }
    if (state?.version !== 1 || typeof state.account !== 'string' ||
        !Number.isSafeInteger(state.revision) || state.revision < 0 ||
        !Number.isSafeInteger(state.saveCount) || state.saveCount < 0 ||
        typeof state.draft !== 'string' || typeof state.saved !== 'string') {
      throw new OperatorError('FIXTURE_STATE_INVALID', 'The fixture state does not match its schema.');
    }
    if (state.account !== scope.account) {
      throw new OperatorError('ACCOUNT_MISMATCH', 'The fixture account differs from the configured account.');
    }
    return state;
  }

  private write(path: string, state: State): void {
    const temporary = path + '.' + randomUUID() + '.tmp';
    try {
      writeFileSync(temporary, JSON.stringify(state), { encoding: 'utf8', flag: 'wx', mode: 0o600, flush: true });
      renameSync(temporary, path);
    } catch {
      try { unlinkSync(temporary); } catch { /* No temporary file was created. */ }
      throw new OperatorError('FIXTURE_WRITE_UNKNOWN', 'The fixture write could not be confirmed.', false);
    }
  }

  async observe(operation: Operation, guard: Guard): Promise<Observation> {
    assertActive(guard);
    const { scope, name, path } = this.setup(operation);
    const state = this.read(path, scope);
    const done = state.saved === name;
    const draftReady = state.draft === name;
    const candidate: Candidate | undefined = done ? undefined : draftReady
      ? { id: 'fixture.save', kind: 'click', label: 'Save profile name', effect: 'write' }
      : { id: 'fixture.type', kind: 'type', label: 'Enter supplied profile name', effect: 'ui', inputKey: 'name' };
    const id = randomUUID();
    this.observed.set(id, {
      operationId: operation.id, scopeId: scope.id, recipeId: operation.recipe.id,
      name, revision: state.revision, candidate: candidate ? { ...candidate } : undefined,
    });
    if (this.observed.size > 256) this.observed.delete(this.observed.keys().next().value!);
    return {
      id, documentId: scope.id + ':' + state.revision,
      scopeId: scope.id, origin: scope.origin, account: scope.account,
      summary: done ? 'The saved fixture profile matches the goal.' : 'A local fixture profile form is available.',
      candidates: candidate ? [candidate] : [],
      facts: { goalSatisfied: done, draftMatches: draftReady, saveCount: state.saveCount },
      capturedAt: Date.now(),
    };
  }

  async execute(operation: Operation, candidate: Candidate, context: ExecutionContext): Promise<void> {
    assertActive(context);
    const { scope, name, path } = this.setup(operation);
    const captured = this.observed.get(context.observation.id);
    const state = this.read(path, scope);
    if (!captured || captured.operationId !== operation.id || captured.recipeId !== operation.recipe.id ||
        captured.scopeId !== scope.id || captured.name !== name || captured.revision !== state.revision ||
        captured.candidate?.id !== candidate.id || context.observation.scopeId !== scope.id ||
        context.observation.origin !== scope.origin || context.observation.account !== scope.account ||
        context.observation.documentId !== scope.id + ':' + state.revision) {
      throw new OperatorError('STALE_OBSERVATION', 'Observe the fixture again before acting.');
    }
    const canonical = captured.candidate;
    if (!canonical || candidate.kind !== canonical.kind || candidate.effect !== canonical.effect ||
        candidate.inputKey !== canonical.inputKey) {
      throw new OperatorError('INVALID_CANDIDATE', 'The fixture candidate is not the observed action.');
    }
    assertActive(context);
    this.observed.delete(context.observation.id);
    if (candidate.id === 'fixture.type') {
      this.write(path, { ...state, draft: name, revision: state.revision + 1 });
    } else if (candidate.id === 'fixture.save' && state.draft === name) {
      this.write(path, { ...state, saved: name, saveCount: state.saveCount + 1, revision: state.revision + 1 });
    } else {
      throw new OperatorError('INVALID_CANDIDATE', 'The fixture action is not currently available.');
    }
  }

  async verify(operation: Operation, guard: Guard): Promise<Verification> {
    assertActive(guard);
    const { scope, name, path } = this.setup(operation);
    const state = this.read(path, scope);
    return state.saved === name
      ? { state: 'satisfied', code: 'FIXTURE_SAVED_VALUE_MATCHES' }
      : { state: 'not_satisfied', code: 'FIXTURE_SAVED_VALUE_DIFFERS' };
  }

  /** Test/demo helper that represents a human completing the fake form during handoff. */
  humanSet(operation: Operation): void {
    const { scope, name, path } = this.setup(operation);
    const state = this.read(path, scope);
    this.write(path, { ...state, draft: name, saved: name, revision: state.revision + 1, saveCount: state.saveCount + 1 });
  }

  /** Returns only the fake profile fields, never browser state. */
  inspect(scopeId: string): Readonly<State> {
    const scope = this.scopes.get(scopeId);
    if (!scope) throw new OperatorError('INVALID_FIXTURE_SCOPE', 'The fixture scope is not configured.');
    const file = createHash('sha256').update(scope.id).digest('hex') + '.json';
    return Object.freeze(this.read(join(this.stateDir, file), scope));
  }
}
