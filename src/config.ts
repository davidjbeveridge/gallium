import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { OperatorError } from './contracts.ts';
import type { Config, Recipe, Inputs } from './contracts.ts';

function requireThat(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new OperatorError(code, message);
}

const identifier = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const sensitive = /password|passwd|secret|cookie|token|credential|otp|one.?time|card.?number|cvv|authorization/i;

export function validateConfig(value: unknown, baseDir = process.cwd()): Config {
  const config = value as Config;
  requireThat(config && config.version === 1, 'CONFIG', 'Expected configuration version 1.');
  requireThat(typeof config.stateDir === 'string' && config.stateDir.length > 0, 'CONFIG', 'stateDir is required.');
  requireThat(Array.isArray(config.scopes) && config.scopes.length > 0, 'CONFIG', 'Configure at least one scope.');
  requireThat(Array.isArray(config.recipes), 'CONFIG', 'recipes must be an array.');
  requireThat(config.navigators && typeof config.navigators === 'object' && !Array.isArray(config.navigators), 'CONFIG', 'navigators must be an object.');
  requireThat(config.sharedService === undefined || typeof config.sharedService === 'boolean', 'CONFIG', 'sharedService must be boolean.');
  if (config.taskRouter) {
    requireThat(config.taskRouter.provider === 'typesafe', 'CONFIG', 'Task routing requires the System One API.');
    requireThat(!config.taskRouter.apiKeyFile || config.taskRouter.apiKeyFile.startsWith('/'), 'CONFIG', 'Credential file paths must be absolute.');
  }
  const scopeIds = new Set<string>();
  const identities = new Set<string>();
  for (const scope of config.scopes) {
    requireThat(typeof scope.id === 'string' && identifier.test(scope.id) && !scopeIds.has(scope.id), 'CONFIG', 'Scope IDs must be unique identifiers.');
    scopeIds.add(scope.id);
    requireThat(typeof scope.account === 'string' && scope.account.length > 0 && scope.account.length <= 256, 'CONFIG', 'Each scope needs an expected account identity.');
    let url: URL;
    try { url = new URL(scope.origin); } catch { throw new OperatorError('CONFIG', 'Each scope needs a valid origin.'); }
    requireThat(url!.origin === scope.origin && ['http:', 'https:'].includes(url!.protocol), 'CONFIG', 'Scope origin must be an exact HTTP(S) origin, with no path or credentials.');
    requireThat(!url!.username && !url!.password, 'CONFIG', 'Do not embed credentials in URLs.');
    const identity = JSON.stringify([scope.origin, scope.account]);
    requireThat(!identities.has(identity), 'CONFIG', 'Reuse one scope ID for the same origin/account so every route shares control, leases, and cooldowns.');
    identities.add(identity);
  }
  const recipeIds = new Set<string>();
  for (const recipe of config.recipes) {
    requireThat(typeof recipe.id === 'string' && identifier.test(recipe.id) && !recipeIds.has(recipe.id), 'CONFIG', 'Recipe IDs must be unique identifiers.');
    recipeIds.add(recipe.id);
    requireThat(scopeIds.has(recipe.scopeId), 'CONFIG', 'Each recipe must use a configured scope.');
    requireThat(['fixture','http','playwriter','browser-request'].includes(recipe.adapter), 'CONFIG', 'Unsupported adapter.');
    requireThat(typeof recipe.description === 'string' && recipe.description.length <= 4000, 'CONFIG', 'Recipe description is required and limited to 4000 characters.');
    requireThat(recipe.inputs && typeof recipe.inputs === 'object' && !Array.isArray(recipe.inputs), 'CONFIG', 'Recipe inputs must be declared.');
    for (const [key, kind] of Object.entries(recipe.inputs)) {
      requireThat(identifier.test(key) && !sensitive.test(key), 'CONFIG', 'Recipe inputs must be non-secret business fields. Credential entry is a handoff in this prototype.');
      requireThat(['string','number','boolean'].includes(kind), 'CONFIG', 'Only scalar recipe inputs are supported.');
    }
    requireThat(recipe.maxActions === undefined || (Number.isInteger(recipe.maxActions) && recipe.maxActions >= 1 && recipe.maxActions <= 12), 'CONFIG', 'maxActions must be 1–12.');
    requireThat(recipe.navigator === undefined || Object.hasOwn(config.navigators, recipe.navigator), 'CONFIG', 'Unknown navigator.');
    if (recipe.adapter === 'http') requireThat(recipe.http, 'CONFIG', 'HTTP recipe configuration is required.');
    if (recipe.adapter === 'playwriter') requireThat(recipe.browser && config.playwriter, 'CONFIG', 'Browser recipe and Playwriter configuration are required.');
    if (recipe.adapter === 'browser-request') {
      requireThat(recipe.browser && recipe.http && config.playwriter, 'CONFIG', 'Browser request requires browser identity, HTTP contract and bridge configuration.');
      requireThat(!Object.keys(recipe.http.headersFromEnv ?? {}).length, 'CONFIG', 'Browser requests use the browser session; portable credential headers are unsupported.');
      requireThat(!sensitive.test(recipe.http.goalPath) && !sensitive.test(recipe.http.accountPath), 'CONFIG', 'Browser verification cannot extract secret fields.');
    }
  }
  for (const navigator of Object.values(config.navigators)) {
    requireThat(navigator && ['deterministic','typesafe','openai-compatible'].includes(navigator.provider), 'CONFIG', 'Unsupported navigator provider.');
    requireThat(navigator.timeoutMs === undefined || (Number.isInteger(navigator.timeoutMs) && navigator.timeoutMs >= 1 && navigator.timeoutMs <= 30000), 'CONFIG', 'Navigator timeout must be 1–30000ms.');
  }
  return { ...config, stateDir: resolve(baseDir, config.stateDir) };
}

export function loadConfig(path: string): Config {
  let value: unknown;
  try { value = JSON.parse(readFileSync(path, 'utf8')); }
  catch { throw new OperatorError('CONFIG', 'Cannot read configuration JSON.'); }
  return validateConfig(value, dirname(resolve(path)));
}

export function validateInput(recipe: Recipe, input: unknown): Inputs {
  requireThat(input && typeof input === 'object' && !Array.isArray(input), 'INPUT', 'Inputs must be an object.');
  const record = input as Inputs;
  requireThat(Object.keys(record).length === Object.keys(recipe.inputs).length, 'INPUT', 'Supply exactly the declared input fields.');
  for (const [key, kind] of Object.entries(recipe.inputs)) {
    requireThat(Object.hasOwn(record, key) && typeof record[key] === kind, 'INPUT', 'An input field is missing or has the wrong type.');
    if (typeof record[key] === 'string') requireThat((record[key] as string).length <= 4000, 'INPUT', 'Input strings are limited to 4000 characters.');
    if (typeof record[key] === 'number') requireThat(Number.isFinite(record[key]), 'INPUT', 'Numeric inputs must be finite.');
  }
  requireThat(JSON.stringify(record).length <= 32768, 'INPUT', 'Inputs exceed the supported size.');
  return { ...record };
}

export function validateId(value: unknown): asserts value is string {
  requireThat(typeof value === 'string' && identifier.test(value), 'INPUT', 'Use an operation ID of 1–128 letters, numbers, periods, underscores, colons, or hyphens.');
}
