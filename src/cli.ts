import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadConfig, validateConfig } from './config.ts';
import { createEngine } from './runtime.ts';
import { FixtureAdapter } from './adapters/fixture.ts';
import { OperatorError } from './contracts.ts';
import type { Config, Inputs, Operation } from './contracts.ts';
import { createControlServer } from './control-server.ts';

const HELP = `Web Operator 0.2.0 — Node 24+, no install required for the core

  node src/cli.ts demo
  node src/cli.ts [--config FILE] status [--operation ID] [--scope ID]
  node src/cli.ts [--config FILE] read --recipe ID --input '{"name":"Ada"}'
  node src/cli.ts [--config FILE] act --recipe ID --operation ID --input '{"name":"Ada"}'
  node src/cli.ts [--config FILE] pause|resume|cancel --scope ID
  node src/cli.ts [--config FILE] doctor
  node src/cli.ts [--config FILE] ui [--port 8788]

Use --input - to read a JSON object from stdin. Inputs must be non-secret business fields.
Reuse the same operation ID after interruption. A possibly completed write is reconciled, never blindly retried.
Cancel stops all unfinished operations in the scope. Resume returns control, but does not execute actions.
`;

function parse(args: string[]): { command: string; flags: Record<string, string> } {
  let command = '';
  const flags: Record<string, string> = {};
  const allowed = new Set(['config','operation','scope','recipe','input','max-actions','port']);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') return { command: 'help', flags: {} };
    if (arg.startsWith('--')) {
      const name = arg.slice(2);
      if (!allowed.has(name) || Object.hasOwn(flags, name) || !args[i + 1] || args[i + 1].startsWith('--'))
        throw new OperatorError('CLI_ARGUMENT', 'Unknown, duplicate, or missing command option. Use --help.');
      flags[name] = args[++i];
    } else if (!command) command = arg;
    else throw new OperatorError('CLI_ARGUMENT', 'Unexpected command argument. Use --help.');
  }
  return { command: command || 'help', flags };
}

async function inputs(value?: string): Promise<Inputs> {
  if (!value) return {};
  let text = value;
  if (value === '-') {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const part of process.stdin) {
      const chunk = Buffer.from(part);
      size += chunk.length;
      if (size > 32768) throw new OperatorError('INPUT', 'Input exceeds 32 KiB.');
      chunks.push(chunk);
    }
    text = Buffer.concat(chunks).toString('utf8');
  }
  try { return JSON.parse(text); }
  catch { throw new OperatorError('INPUT', 'Input must be valid JSON.'); }
}

async function demo(): Promise<unknown> {
  const stateDir = mkdtempSync(join(tmpdir(), 'web-operator-demo-'));
  const config: Config = validateConfig({ version: 1, stateDir,
    scopes: [{ id: 'demo', origin: 'https://fixture.invalid', account: 'demo-user' }],
    recipes: [{ id: 'set-name', scopeId: 'demo', description: 'Save the supplied profile name.', adapter: 'fixture', inputs: { name: 'string' } }],
    navigators: { deterministic: { provider: 'deterministic' } },
  });
  let engine = await createEngine(config);
  try {
    const first = await engine.act({ operationId: 'demo-first', recipe: 'set-name', input: { name: 'Ada' } });
    const repeated = await engine.act({ operationId: 'demo-first', recipe: 'set-name', input: { name: 'Ada' } });
    await engine.control('demo', 'pause');
    await engine.close();
    engine = await createEngine(config);
    const paused = await engine.act({ operationId: 'demo-handoff', recipe: 'set-name', input: { name: 'Lin' } });
    const fixture = new FixtureAdapter(stateDir, config.scopes);
    const op: Operation = { id: 'demo-handoff', recipe: config.recipes[0], input: { name: 'Lin' } };
    fixture.humanSet(op);
    await engine.control('demo', 'resume');
    const resumed = await engine.act({ operationId: op.id, recipe: op.recipe.id, input: op.input });
    return {
      fixtureOnly: true,
      firstOperation: (first.operation as any).state,
      actionsToComplete: (first.operation as any).actions,
      repeatResult: repeated.code,
      pauseSurvivedRestart: paused.code === 'PAUSED',
      handbackResult: (resumed.operation as any).state,
      actionsAfterHumanCompletedGoal: (resumed.operation as any).actions,
      savedCount: fixture.inspect('demo').saveCount,
      temporaryStateRemovedAfterDemo: true,
    };
  } finally { await engine.close(); rmSync(stateDir, { recursive: true, force: true }); }
}

async function main(): Promise<void> {
  const { command, flags } = parse(process.argv.slice(2));
  if (command === 'help') { process.stdout.write(HELP); return; }
  if (command === 'demo') { process.stdout.write(JSON.stringify(await demo(), null, 2) + '\n'); return; }
  const config = loadConfig(resolve(flags.config ?? process.env.WEB_OPERATOR_CONFIG ?? 'config.example.json'));
  if (command === 'doctor') {
    let playwriterAvailable = false;
    try { import.meta.resolve(config.playwriter?.module ?? 'playwriter'); playwriterAvailable = true; } catch { /* Optional. */ }
    process.stdout.write(JSON.stringify({ node: process.version, minimumNode: '24.0.0', coreRuntimeDependencies: 0,
      browserBinaryBundled: false, stateDir: config.stateDir,
      playwriter: { configured: !!config.playwriter, moduleAvailable: playwriterAvailable,
        preserveExtensionsVerified: config.playwriter?.preserveExtensionsVerified === true,
        liveCompatibilityTested: false },
      navigatorProviders: Object.entries(config.navigators).map(([name, n]) => ({ name, provider: n.provider,
        credentialPresent: n.provider === 'deterministic' ? null : !!process.env[n.apiKeyEnv ?? (n.provider === 'typesafe' ? 'TYPESAFE_API_KEY' : 'NAVIGATOR_API_KEY')] })),
    }, null, 2) + '\n');
    return;
  }
  const engine = await createEngine(config);
  if (command === 'ui') {
    const port = Number(flags.port ?? 8788);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new OperatorError('CLI_ARGUMENT', 'Invalid control panel port.');
    const server = await createControlServer(engine, port);
    process.stdout.write('Web Operator control: ' + server.origin + '\n');
    const stop = async () => { await engine.close(); await server.close(); };
    process.once('SIGINT', () => { void stop(); });
    process.once('SIGTERM', () => { void stop(); });
    return;
  }
  const controller = new AbortController();
  const interrupt = () => controller.abort(new OperatorError('INTERRUPTED', 'CLI operation interrupted.'));
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  let result: unknown;
  try {
    switch (command) {
      case 'status': result = engine.status(flags.scope, flags.operation); break;
      case 'read': result = await engine.read(flags.recipe, await inputs(flags.input), controller.signal); break;
      case 'act': {
        if (!flags.operation) throw new OperatorError('CLI_ARGUMENT', 'An explicit --operation ID is required for resumable actions.');
        result = await engine.act({ operationId: flags.operation, recipe: flags.recipe, input: await inputs(flags.input),
          ...(flags['max-actions'] ? { maxActions: Number(flags['max-actions']) } : {}) }, controller.signal);
        break;
      }
      case 'pause': case 'resume': case 'cancel':
        if (!flags.scope) throw new OperatorError('CLI_ARGUMENT', '--scope is required.');
        result = await engine.control(flags.scope, command); break;
      default: throw new OperatorError('CLI_ARGUMENT', 'Unknown command. Use --help.');
    }
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } finally {
    process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
    await engine.close();
  }
}

main().catch(error => {
  const safe = error instanceof OperatorError ? { code: error.code, message: error.message } : { code: 'INTERNAL_ERROR', message: 'The operator could not complete this command.' };
  process.stderr.write(JSON.stringify({ error: safe }) + '\n');
  process.exitCode = 1;
});
