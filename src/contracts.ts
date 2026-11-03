export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Inputs = Record<string, string | number | boolean>;
export type InputKind = 'string' | 'number' | 'boolean';
export type ActionKind = 'click' | 'type' | 'select' | 'scroll' | 'wait' | 'request';
export type Effect = 'read' | 'ui' | 'write';

export interface ScopeConfig {
  id: string;
  origin: string;
  account: string;
}

export interface Candidate {
  id: string;
  kind: ActionKind;
  label: string;
  effect: Effect;
  inputKey?: string;
}

export interface Observation {
  id: string;
  documentId: string;
  scopeId: string;
  origin: string;
  account: string;
  summary: string;
  candidates: Candidate[];
  facts: Record<string, Json>;
  capturedAt: number;
}

export interface Verification {
  state: 'satisfied' | 'not_satisfied' | 'unknown';
  code: string;
}

export interface Operation {
  id: string;
  recipe: Recipe;
  input: Inputs;
}

export interface Guard {
  signal: AbortSignal;
  epoch: number;
  assertCurrent: () => void;
}

export interface ExecutionContext extends Guard {
  observation: Observation;
}

export interface Adapter {
  readonly name: string;
  observe(operation: Operation, guard: Guard): Promise<Observation>;
  execute(operation: Operation, candidate: Candidate, context: ExecutionContext): Promise<void>;
  verify(operation: Operation, guard: Guard): Promise<Verification>;
  release?(scopeId: string): Promise<void>;
  control?(scopeId: string, action: 'pause' | 'resume' | 'cancel'): Promise<void>;
  close?(): Promise<void>;
}

export interface BrowserCandidate extends Candidate {
  selector?: string;
  when?: { selector: string; text?: string; absent?: boolean };
  direction?: 'up' | 'down';
  pixels?: number;
  waitMs?: number;
}

export interface BrowserRecipe {
  urlPrefix: string;
  account: { selector: string; text: string };
  goal: { selector: string; text?: string; inputKey?: string };
  candidates: BrowserCandidate[];
  csrf?: { selector: string; attribute: string; header: string };
}

export interface HttpRecipe {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  effect: Effect;
  inputKeys?: string[];
  verifyUrl: string;
  accountPath: string;
  goalPath: string;
  expected?: Json;
  expectedInputKey?: string;
  idempotencyHeader?: string;
  headersFromEnv?: Record<string, string>;
}

export interface Recipe {
  id: string;
  scopeId: string;
  description: string;
  adapter: 'fixture' | 'http' | 'playwriter' | 'browser-request';
  inputs: Record<string, InputKind>;
  navigator?: string;
  maxActions?: number;
  browser?: BrowserRecipe;
  http?: HttpRecipe;
}

export interface DecisionRequest {
  operationId: string;
  goal: string;
  input: Inputs;
  observation: Observation;
  epoch: number;
}

export type Decision =
  | { type: 'act'; candidateId: string; score?: number }
  | { type: 'done' }
  | { type: 'blocked'; reason: string }
  | { type: 'escalate'; reason: string };

export interface Navigator {
  readonly name: string;
  choose(request: DecisionRequest, signal: AbortSignal): Promise<Decision>;
}

export interface NavigatorConfig {
  provider: 'deterministic' | 'typesafe' | 'openai-compatible';
  endpoint?: string;
  model?: string;
  apiKeyEnv?: string;
  apiKeyFile?: string;
  timeoutMs?: number;
}

export interface Config {
  version: 1;
  stateDir: string;
  scopes: ScopeConfig[];
  recipes: Recipe[];
  navigators: Record<string, NavigatorConfig>;
  sharedService?: boolean;
  taskRouter?: NavigatorConfig;
  playwriter?: {
    browserId?: string;
    tabGroup?: string;
    module?: string;
    /** Live attachment requires a verified extension build that preserves other extensions. */
    preserveExtensionsVerified: boolean;
    timeoutMs?: number;
    inputPolicy?: { mode: 'efficient' | 'natural'; maxOverheadMs?: number };
  };
}

export class OperatorError extends Error {
  code: string;
  beforeEffect: boolean;
  retryAfterMs?: number;
  constructor(code: string, message: string, beforeEffect = true) {
    super(message);
    this.name = 'OperatorError';
    this.code = code;
    this.beforeEffect = beforeEffect;
  }
}

export function assertActive(guard: Guard): void {
  guard.signal.throwIfAborted();
  guard.assertCurrent();
}
