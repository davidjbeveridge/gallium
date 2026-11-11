import { existsSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, lstatSync, realpathSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Use Node 24+ to install.');
const root = resolve(import.meta.dirname, '..');
const home = homedir();
const galliumDirectory = join(home, '.config/gallium');
const legacyDirectory = join(home, '.config/web-operator');
// Keep an existing Web Operator configuration authoritative so installation is
// upgrade-safe. New installations use Gallium's directory.
const directory = existsSync(join(legacyDirectory, 'config.json')) ? legacyDirectory : galliumDirectory;
mkdirSync(directory, { recursive: true, mode: 0o700 });
if (lstatSync(directory).isSymbolicLink()) throw new Error('Config directory must not be a symlink.');
chmodSync(directory, 0o700);
const configPath = join(directory, 'config.json');
if (!existsSync(configPath)) {
  const fixture = JSON.parse(readFileSync(resolve(root, 'config.example.json'), 'utf8'));
  const browser = JSON.parse(readFileSync(resolve(root, 'examples/browser.config.json'), 'utf8'));
  const http = JSON.parse(readFileSync(resolve(root, 'examples/http.config.json'), 'utf8'));
  fixture.stateDir = join(home, 'Library/Application Support/Gallium');
  fixture.scopes.push(...browser.scopes);
  fixture.recipes.push(...browser.recipes, ...http.recipes);
  // Both configured routes bind the exact same account/origin and must share control.
  for (const recipe of fixture.recipes) if (recipe.adapter === 'http') recipe.scopeId = browser.scopes[0].id;
  fixture.playwriter = browser.playwriter;
  fixture.sharedService = true;
  fixture.taskRouter = {
    provider: 'typesafe', endpoint: 'https://openrouter.ai/api/v1/systemone',
    model: 'typesafe/jev-1.14-20261014', apiKeyEnv: 'OPENROUTER_API_KEY', timeoutMs: 15000,
    ...(existsSync(join(home, '.openrouter_key')) ? { apiKeyFile: join(home, '.openrouter_key') } : {}),
  };

  const request = structuredClone(browser.recipes[0]);
  request.id = 'save-browser-request'; request.adapter = 'browser-request';
  request.http = { ...http.recipes[0].http, url: 'http://127.0.0.1:8787/api/session-profile', verifyUrl: 'http://127.0.0.1:8787/api/session-profile' };
  request.browser.csrf = { selector: 'meta[name="fixture-csrf"]', attribute: 'content', header: 'X-Fixture-CSRF' };
  fixture.recipes.push(request);
  writeFileSync(configPath, JSON.stringify(fixture, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
}
const bin = join(home, '.local/bin'); mkdirSync(bin, { recursive: true });
const galliumTarget = join(bin, 'gallium');
if (existsSync(galliumTarget) && realpathSync(galliumTarget) !== resolve(root, 'bin/gallium.mjs')) throw new Error('Existing gallium command belongs to another installation.');
if (!existsSync(galliumTarget)) symlinkSync(resolve(root, 'bin/gallium.mjs'), galliumTarget);
const legacyTarget = join(bin, 'web-operator');
if (!existsSync(legacyTarget)) symlinkSync(resolve(root, 'bin/web-operator.mjs'), legacyTarget);
chmodSync(resolve(root, 'bin/gallium.mjs'), 0o755);
chmodSync(resolve(root, 'bin/web-operator.mjs'), 0o755);
execFileSync('codex', ['mcp', 'add', 'gallium', '--', 'node', resolve(root, 'bin/mcp.mjs')], { stdio: 'inherit' });
const skills = join(home, '.agents/skills'); mkdirSync(skills, { recursive: true });
const skill = join(skills, 'gallium');
const skillSource = resolve(root, 'skills/web-operator');
if (existsSync(skill) && realpathSync(skill) !== skillSource) throw new Error('Existing Gallium skill belongs to another installation.');
if (!existsSync(skill)) symlinkSync(skillSource, skill);
console.log('Installed Gallium CLI, MCP and routing skill. Existing configuration preserved. Chrome extension installation is separate.');
