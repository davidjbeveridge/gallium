import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig, validateInput } from '../src/config.ts';
import type { Config } from '../src/contracts.ts';

function config(): Config {
  return {
    version: 1, stateDir: '.state',
    scopes: [{ id: 'primary', origin: 'https://example.invalid', account: 'account-1' }],
    recipes: [{ id: 'set-name', scopeId: 'primary', adapter: 'fixture', description: 'Set a name', inputs: { name: 'string' } }],
    navigators: { deterministic: { provider: 'deterministic' } },
  };
}

test('configuration resolves state relative to its file directory', () => {
  const result = validateConfig(config(), '/tmp/operator-config-test');
  assert.equal(result.stateDir, '/tmp/operator-config-test/.state');
});

test('two scope IDs cannot alias the same authenticated origin and account', () => {
  const value = config();
  value.scopes.push({ ...value.scopes[0], id: 'bypass-alias' });
  assert.throws(() => validateConfig(value), { code: 'CONFIG' });
});

test('genuinely distinct configured accounts may have independent scopes', () => {
  const value = config();
  value.scopes.push({ ...value.scopes[0], id: 'second-account', account: 'account-2' });
  assert.equal(validateConfig(value).scopes.length, 2);
});

test('missing and duplicate recipe or scope IDs are rejected', () => {
  for (const field of ['scopes', 'recipes'] as const) {
    const missing: any = config();
    delete missing[field][0].id;
    assert.throws(() => validateConfig(missing), { code: 'CONFIG' });
    const duplicate: any = config();
    duplicate[field].push({ ...duplicate[field][0] });
    assert.throws(() => validateConfig(duplicate), { code: 'CONFIG' });
  }
});

test('credential-like input fields are excluded from model-visible recipe inputs', () => {
  for (const key of ['password', 'otp', 'sessionToken', 'authorization', 'creditCardNumber']) {
    const value = config();
    value.recipes[0].inputs = { [key]: 'string' };
    assert.throws(() => validateConfig(value), { code: 'CONFIG' });
  }
});

test('scope origins cannot contain paths, credentials, or non-HTTP protocols', () => {
  for (const origin of ['https://example.invalid/path', 'https://user:pass@example.invalid', 'file:///tmp/example']) {
    const value = config();
    value.scopes[0].origin = origin;
    assert.throws(() => validateConfig(value), { code: 'CONFIG' });
  }
});

test('inputs must exactly match declared business fields with bounded scalar values', () => {
  const recipe = config().recipes[0];
  assert.deepEqual(validateInput(recipe, { name: 'Grace' }), { name: 'Grace' });
  for (const input of [{}, { name: 'Grace', extra: 'field' }, { name: 123 }, { name: 'a'.repeat(4001) }]) {
    assert.throws(() => validateInput(recipe, input), { code: 'INPUT' });
  }
  recipe.inputs = { amount: 'number' };
  assert.throws(() => validateInput(recipe, { amount: NaN }), { code: 'INPUT' });
  assert.throws(() => validateInput(recipe, { amount: Infinity }), { code: 'INPUT' });
});
