import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'vite';

const root = resolve(import.meta.dirname, '..');
const revision = 'bf2b96717e2b36ee9781d260d4ed8a7228f47c48';
const sha256 = '692ae42e10aeaed4992492b51223d4816a6afb78c1491245b079e3a6ffcc7778';
const archive = resolve(root, 'work/playwriter.tar.gz');
mkdirSync(resolve(root, 'work'), { recursive: true });
if (!existsSync(archive)) {
  const response = await fetch(`https://codeload.github.com/remorses/playwriter/tar.gz/${revision}`);
  if (!response.ok) throw new Error('Upstream source download failed');
  writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
}
if (createHash('sha256').update(readFileSync(archive)).digest('hex') !== sha256) throw new Error('Upstream archive hash mismatch');
const source = resolve(root, 'work/extension-build');
mkdirSync(source, { recursive: true });
execFileSync('tar', ['-xzf', archive, '-C', source, '--strip-components=1']);
execFileSync('patch', ['-p1', '-i', resolve(root, 'docs/patches/playwriter-preserve-extensions.patch')], { cwd: source });
const backgroundPath = resolve(source, 'extension/src/background.ts');
let background = readFileSync(backgroundPath, 'utf8');
const marker = "  if (msg.method !== 'forwardCDPCommand') return";
if (background.split(marker).length !== 2) throw new Error('Control patch no longer applies');
background = background.replace(marker, marker + `
  if (msg.params.method === 'WebOperator.control') {
    if (remoteRuntime) throw new Error('Local control only');
    return webOperatorControl(msg.params.params as any);
  }
`);
background += '\n' + readFileSync(resolve(root, 'extension/control.ts'), 'utf8');
// Never compete with password-manager overlays after an unexpected detach.
background = background.replace('if (canReattach(tabId))', 'if (false && canReattach(tabId))');
// Source currently calls canReattach with a different surrounding expression: patch its implementation too.
const reattachPath = resolve(source, 'extension/src/session-reattach.ts');
let reattach = readFileSync(reattachPath, 'utf8');
reattach = reattach.replace('export function canReattach(tabId: number): boolean {', 'export function canReattach(tabId: number): boolean { return false;');
writeFileSync(reattachPath, reattach);
writeFileSync(backgroundPath, background);
cpSync(resolve(root, 'node_modules/playwriter/dist'), resolve(source, 'playwriter/dist'), { recursive: true });
const outDir = resolve(root, 'dist/extension');
await build({
  configFile: false, root: resolve(source, 'extension'),
  resolve: { alias: { 'playwriter/src': resolve(source, 'playwriter/src') } },
  define: {
    'process.env.PLAYWRITER_PORT': JSON.stringify('19988'),
    __PLAYWRITER_VERSION__: JSON.stringify('0.9.0'),
    __PLAYWRITER_OPEN_WELCOME_PAGE__: 'false',
  },
  build: { outDir, emptyOutDir: true, minify: false, rollupOptions: {
    input: { background: backgroundPath, 'content-script': resolve(source, 'extension/src/content-script.ts'), offscreen: resolve(source, 'extension/src/offscreen.html') },
    output: { entryFileNames: '[name].js', format: 'es' },
  } },
});
cpSync(resolve(source, 'extension/icons'), resolve(outDir, 'icons'), { recursive: true });
const manifest = JSON.parse(readFileSync(resolve(source, 'extension/manifest.json'), 'utf8'));
manifest.name = 'Web Operator Bridge (Playwriter)';
manifest.description = 'Local Web Operator bridge: preserves extension overlays and supports explicit authentication detach.';
manifest.permissions.push('tabs');
// Public development identity recognized by the pinned relay's extension-origin allowlist.
const upstreamVite = readFileSync(resolve(source, 'extension/vite.config.mts'), 'utf8');
manifest.key = upstreamVite.match(/manifest\.key =\s*'([^']+)'/)?.[1];
if (!manifest.key) throw new Error('Upstream development identity missing');
manifest.commands = { 'take-over': { suggested_key: { default: 'Ctrl+Shift+Y', mac: 'Command+Shift+Y' }, description: 'Detach this tab for human control' } };
writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
cpSync(resolve(source, 'LICENSE'), resolve(outDir, 'LICENSE'));
console.log('Built extension at dist/extension. No browser profile has been changed.');
