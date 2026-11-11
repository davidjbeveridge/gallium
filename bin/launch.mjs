import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export function launch(entry, args = []) {
  const candidates = [...new Set([process.env.GALLIUM_NODE, process.env.WEB_OPERATOR_NODE, process.execPath, '/opt/homebrew/opt/node@26/bin/node', '/opt/homebrew/opt/node@24/bin/node', '/opt/homebrew/bin/node', '/usr/local/bin/node'].filter(Boolean))];
  const node = candidates.find(candidate => {
    const version = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    return version.status === 0 && Number(version.stdout.match(/^v(\d+)/)?.[1]) >= 24;
  });
  if (!node) { console.error('Gallium requires Node 24+. Set GALLIUM_NODE to its executable.'); process.exit(1); }
  const root = resolve(import.meta.dirname, '..');
  const legacyConfig = join(homedir(), '.config/web-operator/config.json');
  const defaultConfig = existsSync(legacyConfig) ? legacyConfig : join(homedir(), '.config/gallium/config.json');
  const config = process.env.GALLIUM_CONFIG || process.env.WEB_OPERATOR_CONFIG || defaultConfig;
  const configured = existsSync(config) ? config : resolve(root, 'config.example.json');
  const configArgs = args.includes('--config') ? [] : ['--config', configured];
  const child = spawnSync(node, [resolve(root, entry), ...configArgs, ...args], { stdio: 'inherit' });
  process.exit(child.status ?? 1);
}
