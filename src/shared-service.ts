import { createServer, createConnection } from 'node:net';
import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, lstatSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createInterface } from 'node:readline';
import { createEngine } from './runtime.ts';
import { loadConfig } from './config.ts';
import { OperatorError } from './contracts.ts';
import type { Config } from './contracts.ts';
import type { Engine } from './engine.ts';

const methods = new Set(['task','act','read','status','control']);
function identity(config: Config) {
  const hash = createHash('sha256').update(JSON.stringify(config));
  for (const file of readdirSync(import.meta.dirname, { recursive: true }).map(String).filter(file => file.endsWith('.ts')).sort())
    hash.update(file).update(readFileSync(join(import.meta.dirname, file)));
  return hash.digest('hex');
}
function socketPath(config: Config) {
  mkdirSync(config.stateDir, { recursive: true, mode: 0o700 });
  if (lstatSync(config.stateDir).isSymbolicLink()) throw new OperatorError('STATE_PATH','Unsafe service directory.');
  chmodSync(config.stateDir, 0o700);
  const path = join(config.stateDir, 'operator.sock');
  if (Buffer.byteLength(path) > 100) throw new OperatorError('STATE_PATH','Service socket path is too long.');
  return path;
}

async function serve(config: Config) {
  const engine = await createEngine(config);
  const fingerprint = identity(config);
  let outstanding = 0;
  const server = createServer(socket => {
    const requests = new Map<string, AbortController>();
    let size = 0;
    socket.on('data', chunk => { size += chunk.length; if (size > 256 * 1024) socket.destroy(); });
    const lines = createInterface({ input: socket });
    lines.on('line', async line => {
      let request: any;
      let counted = false;
      try {
        request = JSON.parse(line);
        if (request.method === 'restart') {
          if (outstanding) throw new OperatorError('SERVICE_BUSY','Finish or cancel active requests before restarting.');
          socket.end(JSON.stringify({ id: request.id, result: { restarting: true } }) + '\n');
          server.close(() => { void engine.close().then(() => process.exit()); });
          return;
        }
        if (request.cancel) { requests.get(request.cancel)?.abort(); return; }
        if (request.fingerprint !== fingerprint) throw new OperatorError('SERVICE_CONFIG_CHANGED','Restart the shared service after a configuration change.');
        if (!methods.has(request.method) || !Array.isArray(request.args)) throw new OperatorError('INPUT','Unknown service operation.');
        if (outstanding >= 64 && !['control','status'].includes(request.method))
          throw new OperatorError('SERVICE_BUSY','Shared service queue is full.');
        outstanding++; counted = true;
        const controller = new AbortController();
        requests.set(request.id, controller);
        const execute = async () => {
          controller.signal.throwIfAborted();
          const args = request.args;
          switch (request.method) {
            case 'task': return engine.task(args[0], controller.signal);
            case 'act': return engine.act(args[0], controller.signal);
            case 'read': return engine.read(args[0], args[1], controller.signal);
            case 'status': return { ...engine.status(args[0], args[1]), service: { pid: process.pid, sessionMode: 'shared' } };
            case 'control': return engine.control(args[0], args[1]);
          }
        };
        const result = await execute();
        if (!socket.destroyed) socket.write(JSON.stringify({ id: request.id, result }) + '\n');
      } catch (error) {
        if (!socket.destroyed) socket.write(JSON.stringify({ id: request?.id, error: error instanceof OperatorError ? error.code : 'SERVICE_ERROR' }) + '\n');
      } finally { if (counted) outstanding--; if (request?.id) requests.delete(request.id); }
    });
    socket.on('close', () => { for (const controller of requests.values()) controller.abort(); });
  });
  server.on('error', async () => { await engine.close(); process.exitCode = 1; });
  server.listen(socketPath(config), () => chmodSync(socketPath(config), 0o600));
  const shutdown = () => { server.close(); void engine.close().then(() => process.exit()); };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

export async function sharedEngine(configPath: string, config: Config): Promise<Engine> {
  const path = socketPath(config);
  const fingerprint = identity(config);
  const connect = () => new Promise<import('node:net').Socket>((resolveSocket, reject) => {
    const socket = createConnection(path);
    socket.once('connect', () => { socket.removeListener('error', reject); resolveSocket(socket); });
    socket.once('error', reject);
  });
  let socket;
  try { socket = await connect(); } catch (error: any) {
    // A leftover socket requires explicit recovery. Never displace a possibly live owner.
    if (existsSync(path)) throw new OperatorError('SERVICE_UNAVAILABLE','Shared service socket exists but cannot be reached.');
    const child = spawn(process.execPath, [resolve(import.meta.dirname, 'shared-service.ts'), configPath],
      { detached: true, stdio: 'ignore' });
    child.unref();
    const deadline = Date.now() + 5000;
    while (!socket && Date.now() < deadline) {
      try { socket = await connect(); } catch { await delay(50); }
    }
    if (!socket) throw new OperatorError('SERVICE_UNAVAILABLE','Shared service did not start.');
  }
  const transport = socket;
  transport.on('error', () => {});
  transport.end();
  const call = (method: string, args: unknown[], signal?: AbortSignal) => new Promise<any>((resolveResult, reject) => {
    const id = randomUUID();
    const connection = createConnection(path);
    let resultReceived = false;
    const cancel = () => { connection.destroy(); reject(new OperatorError('REQUEST_CANCELLED','Request cancelled.')); };
    if (signal?.aborted) { cancel(); return; }
    signal?.addEventListener('abort', cancel, { once: true });
    const deadline = setTimeout(() => { connection.destroy(); reject(new OperatorError('SERVICE_TIMEOUT','Service request deadline exceeded.')); }, 120000);
    connection.once('connect', () => connection.write(JSON.stringify({ id, fingerprint, method, args }) + '\n'));
    createInterface({ input: connection }).once('line', line => {
      try {
        const response = JSON.parse(line);
        resultReceived = true;
        if (response.error) reject(new OperatorError(response.error,'Shared service operation failed.'));
        else resolveResult(response.result);
      } catch { reject(new OperatorError('SERVICE_PROTOCOL','Invalid service response.')); }
      connection.end();
    });
    connection.once('error', () => reject(new OperatorError('SERVICE_UNAVAILABLE','Shared service unavailable.')));
    connection.once('close', () => {
      clearTimeout(deadline); signal?.removeEventListener('abort', cancel);
      if (!resultReceived) reject(new OperatorError('SERVICE_UNAVAILABLE','Shared service disconnected.'));
    });
  });
  return {
    task: (request: any, signal?: AbortSignal) => call('task',[request],signal),
    act: (request: any, signal?: AbortSignal) => call('act',[request],signal),
    read: (recipe: string, input: any, signal?: AbortSignal) => call('read',[recipe,input],signal),
    status: (scope?: string, operation?: string) => call('status',[scope,operation]),
    control: (scope: string, action: string) => call('control',[scope,action]),
    restartService: () => call('restart',[]),
    close: async () => {},
  } as unknown as Engine;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  serve(loadConfig(resolve(process.argv[2]))).catch(() => { process.exitCode = 1; });
}

export async function restartSharedService(configPath: string, config: Config): Promise<void> {
  const service = await sharedEngine(configPath, config);
  await (service as unknown as { restartService(): Promise<void> }).restartService();
  const deadline = Date.now() + 5000;
  while (existsSync(socketPath(config)) && Date.now() < deadline) await delay(25);
  if (existsSync(socketPath(config))) throw new OperatorError('SERVICE_BUSY','Shared service has not finished stopping.');
  await sharedEngine(configPath, config);
}
