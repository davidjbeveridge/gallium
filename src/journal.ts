import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, existsSync, lstatSync, readFileSync, writeFileSync, linkSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { OperatorError } from './contracts.ts';

export type EffectState = 'none' | 'dispatched' | 'acknowledged' | 'unknown' | 'verified';
export type OperationState = 'prepared' | 'running' | 'paused' | 'verified' | 'unknown' | 'needs_supervisor' | 'failed' | 'cancelled';
export interface RecordRow {
  id: string; scope_id: string; recipe: string; fingerprint: string;
  state: OperationState; effect: EffectState; actions: number; last_code: string;
  cancel_requested: number; created_at: number; updated_at: number;
}
export interface ControlRow {
  scope_id: string; owner: 'agent' | 'human'; epoch: number;
  cooldown_until: number; updated_at: number;
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stableJson((value as any)[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

/** Durable intent/effect state. Inputs, page bodies, credentials, and model traces are never stored. */
export class Journal {
  db: DatabaseSync;
  private key: Buffer;
  readonly stateDir: string;
  constructor(stateDir: string) {
    this.stateDir = stateDir;
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    if (lstatSync(stateDir).isSymbolicLink()) throw new OperatorError('STATE_PATH', 'State directory must not be a symlink.');
    chmodSync(stateDir, 0o700);
    const keyPath = join(stateDir, 'journal.key');
    if (!existsSync(keyPath)) {
      if (existsSync(join(stateDir, 'journal.sqlite')) && !existsSync(keyPath))
        throw new OperatorError('STATE_KEY', 'An established journal is missing its key. Restore the matching key; do not regenerate it.');
      const staged = join(stateDir, 'journal.key.' + randomUUID());
      writeFileSync(staged, randomBytes(32), { flag: 'wx', mode: 0o600 });
      try { linkSync(staged, keyPath); }
      catch (error: any) { if (error.code !== 'EEXIST') throw error; }
      finally { unlinkSync(staged); }
    }
    if (lstatSync(keyPath).isSymbolicLink()) throw new OperatorError('STATE_PATH', 'State key must not be a symlink.');
    chmodSync(keyPath, 0o600);
    this.key = readFileSync(keyPath);
    if (this.key.length !== 32) throw new OperatorError('STATE_KEY', 'Invalid journal key.');
    const path = join(stateDir, 'journal.sqlite');
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new OperatorError('STATE_PATH', 'Journal must not be a symlink.');
    this.db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.db.exec(`PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS model_usage(model TEXT NOT NULL, cost REAL, elapsed_ms INTEGER NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS public_tasks(id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, state TEXT NOT NULL, evidence_hash TEXT);
      CREATE TABLE IF NOT EXISTS task_routes (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, recipe TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS operations (
        id TEXT PRIMARY KEY, scope_id TEXT NOT NULL, recipe TEXT NOT NULL, fingerprint TEXT NOT NULL,
        state TEXT NOT NULL, effect TEXT NOT NULL, actions INTEGER NOT NULL DEFAULT 0,
        last_code TEXT NOT NULL, cancel_requested INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS controls (
        scope_id TEXT PRIMARY KEY, owner TEXT NOT NULL DEFAULT 'agent', epoch INTEGER NOT NULL DEFAULT 0,
        cooldown_until INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS leases (scope_id TEXT PRIMARY KEY, owner TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS browser_controls (scope_id TEXT PRIMARY KEY, state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, operation_id TEXT, code TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS operation_scope ON operations(scope_id);
    `);
  }

  fingerprint(value: unknown): string { return createHmac('sha256', this.key).update(stableJson(value)).digest('hex'); }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }

  ensureScope(id: string): void {
    this.db.prepare('INSERT OR IGNORE INTO controls(scope_id,updated_at) VALUES (?,?)').run(id, Date.now());
  }

  control(id: string): ControlRow {
    const row = this.db.prepare('SELECT * FROM controls WHERE scope_id=?').get(id) as unknown as ControlRow;
    if (!row) throw new OperatorError('UNKNOWN_SCOPE', 'Unknown configured scope.');
    return row;
  }

  browserControl(id: string): string {
    return (this.db.prepare('SELECT state FROM browser_controls WHERE scope_id=?').get(id) as { state: string } | undefined)?.state ?? 'unknown';
  }
  setBrowserControl(id: string, state: 'unknown' | 'detached' | 'attached'): void {
    this.db.prepare('INSERT INTO browser_controls(scope_id,state) VALUES (?,?) ON CONFLICT(scope_id) DO UPDATE SET state=excluded.state').run(id, state);
  }

  changeControl(scopeId: string, action: 'pause' | 'resume' | 'cancel'): ControlRow {
    return this.transaction(() => {
      this.control(scopeId);
      const now = Date.now();
      this.db.prepare('UPDATE controls SET owner=?,epoch=epoch+1,updated_at=? WHERE scope_id=?')
        .run(action === 'resume' ? 'agent' : 'human', now, scopeId);
      if (action === 'resume') {
        // A live holder keeps its lease until it has quiesced. An explicit handback may reclaim an expired lease.
        this.db.prepare('DELETE FROM leases WHERE scope_id=? AND expires_at<?').run(scopeId, now);
      } else {
        this.db.prepare(`UPDATE operations SET
          effect=CASE WHEN effect IN ('dispatched','acknowledged') THEN 'unknown' ELSE effect END,
          state=CASE WHEN effect IN ('dispatched','acknowledged','unknown') THEN 'unknown' ELSE ? END,
          cancel_requested=CASE WHEN ?='cancel' THEN 1 ELSE cancel_requested END,
          last_code=?,updated_at=? WHERE scope_id=? AND state!='verified'`)
          .run(action === 'cancel' ? 'cancelled' : 'paused', action, action === 'cancel' ? 'CANCELLED' : 'USER_CONTROL', now, scopeId);
      }
      this.event(null, action === 'resume' ? 'CONTROL_RESUMED' : action === 'cancel' ? 'CONTROL_CANCELLED' : 'CONTROL_PAUSED');
      return this.control(scopeId);
    });
  }

  prepare(id: string, scopeId: string, recipe: string, fingerprint: string): RecordRow {
    return this.transaction(() => {
      const old = this.get(id);
      if (old) {
        if (old.fingerprint !== fingerprint || old.scope_id !== scopeId || old.recipe !== recipe)
          throw new OperatorError('OPERATION_CONFLICT', 'Reuse the operation ID only with the identical recipe, scope, and inputs.');
        return old;
      }
      const now = Date.now();
      this.db.prepare(`INSERT INTO operations(id,scope_id,recipe,fingerprint,state,effect,last_code,created_at,updated_at)
        VALUES (?,?,?,?,'prepared','none','PREPARED',?,?)`).run(id, scopeId, recipe, fingerprint, now, now);
      this.event(id, 'PREPARED');
      return this.get(id)!;
    });
  }

  get(id: string): RecordRow | undefined {
    return this.db.prepare('SELECT * FROM operations WHERE id=?').get(id) as unknown as RecordRow | undefined;
  }

  list(scopeId?: string): RecordRow[] {
    return (scopeId
      ? this.db.prepare('SELECT * FROM operations WHERE scope_id=? ORDER BY updated_at DESC LIMIT 50').all(scopeId)
      : this.db.prepare('SELECT * FROM operations ORDER BY updated_at DESC LIMIT 50').all()) as unknown as RecordRow[];
  }

  unresolved(scopeId: string, exceptId = ''): RecordRow | undefined {
    return this.db.prepare(`SELECT * FROM operations WHERE scope_id=? AND id!=?
      AND effect IN ('dispatched','acknowledged','unknown') LIMIT 1`).get(scopeId, exceptId) as unknown as RecordRow | undefined;
  }

  update(id: string, state: OperationState, code: string, effect?: EffectState): RecordRow {
    this.db.prepare(`UPDATE operations SET state=?,last_code=?,effect=COALESCE(?,effect),updated_at=? WHERE id=?`)
      .run(state, code, effect ?? null, Date.now(), id);
    this.event(id, code);
    return this.get(id)!;
  }

  beforeDispatch(id: string, write: boolean): void {
    this.transaction(() => {
      this.db.prepare(`UPDATE operations SET state='running',actions=actions+1,
        effect=CASE WHEN ?=1 THEN 'dispatched' ELSE effect END,last_code='DISPATCHED',updated_at=? WHERE id=?`)
        .run(write ? 1 : 0, Date.now(), id);
      this.event(id, write ? 'WRITE_DISPATCHED' : 'ACTION_DISPATCHED');
    });
  }

  acquire(scopeId: string, owner: string, ttlMs = 30000): number {
    return this.transaction(() => {
      const control = this.control(scopeId);
      if (control.owner !== 'agent') throw new OperatorError('PAUSED', 'The user owns this authentication context. Explicit resume is required.');
      if (control.cooldown_until > Date.now()) throw new OperatorError('RATE_LIMITED', 'The authentication context is cooling down.');
      const lease = this.db.prepare('SELECT * FROM leases WHERE scope_id=?').get(scopeId) as any;
      if (lease) throw new OperatorError(lease.expires_at < Date.now() ? 'STALE_LEASE' : 'BUSY',
        lease.expires_at < Date.now() ? 'An interrupted worker holds an expired lease. Explicit resume is required.' : 'Another operation is still active in this authentication context.');
      this.db.prepare('INSERT INTO leases(scope_id,owner,expires_at) VALUES (?,?,?)').run(scopeId, owner, Date.now() + ttlMs);
      return control.epoch;
    });
  }

  assertLease(scopeId: string, owner: string, epoch: number): void {
    const c = this.control(scopeId);
    const lease = this.db.prepare('SELECT * FROM leases WHERE scope_id=?').get(scopeId) as any;
    if (c.owner !== 'agent' || c.epoch !== epoch || !lease || lease.owner !== owner || lease.expires_at < Date.now())
      throw new OperatorError('CONTROL_REVOKED', 'The operation lost control; refresh state after explicit handback.');
  }

  renew(scopeId: string, owner: string, epoch: number, ttlMs = 30000): void {
    this.assertLease(scopeId, owner, epoch);
    this.db.prepare('UPDATE leases SET expires_at=? WHERE scope_id=? AND owner=?').run(Date.now() + ttlMs, scopeId, owner);
  }

  release(scopeId: string, owner: string): void {
    this.db.prepare('DELETE FROM leases WHERE scope_id=? AND owner=?').run(scopeId, owner);
  }

  lease(scopeId: string): { owner: string; expires_at: number } | undefined {
    return this.db.prepare('SELECT owner,expires_at FROM leases WHERE scope_id=?').get(scopeId) as any;
  }

  cooldown(scopeId: string, milliseconds: number): void {
    const until = Date.now() + Math.max(1000, Math.min(milliseconds, 3600000));
    this.db.prepare('UPDATE controls SET cooldown_until=MAX(cooldown_until,?) WHERE scope_id=?').run(until, scopeId);
  }

  event(operationId: string | null, code: string): void {
    this.db.prepare('INSERT INTO events(operation_id,code,created_at) VALUES (?,?,?)').run(operationId, code, Date.now());
    // Only diagnostics are bounded. Never evict unresolved operation or control records.
    this.db.prepare('DELETE FROM events WHERE sequence <= (SELECT MAX(sequence)-2000 FROM events)').run();
  }

  close(): void { this.db.close(); }
}
