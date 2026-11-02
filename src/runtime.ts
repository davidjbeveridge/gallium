import { Engine } from './engine.ts';
import { createNavigator } from './navigators.ts';
import { FixtureAdapter } from './adapters/fixture.ts';
import { HttpAdapter } from './adapters/http.ts';
import { PlaywriterAdapter } from './adapters/playwriter.ts';
import { BrowserRequestAdapter } from './adapters/browser-request.ts';
import type { Config, Navigator } from './contracts.ts';

export async function createEngine(config: Config): Promise<Engine> {
  const navigators: Record<string, Navigator> = { deterministic: createNavigator({ provider: 'deterministic' }) };
  for (const [name, provider] of Object.entries(config.navigators)) navigators[name] = createNavigator(provider);
  // Constructing adapters does not connect a browser or call a provider. Playwriter loads lazily.
  const bridge = config.playwriter ? new PlaywriterAdapter(config.playwriter, config.scopes) : undefined;
  return new Engine(config, {
    fixture: new FixtureAdapter(config.stateDir, config.scopes),
    http: new HttpAdapter(config.scopes),
    ...(bridge ? { playwriter: bridge, 'browser-request': new BrowserRequestAdapter(bridge, config.scopes) } : {}),
  }, navigators);
}
