import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { assertActive, OperatorError } from '../contracts.ts';
import { typeWithPolicy } from '../input-policy.ts';
import type {
  Adapter, BrowserCandidate, BrowserRecipe, Candidate, Config, ExecutionContext,
  Guard, Observation, Operation, ScopeConfig, Verification,
} from '../contracts.ts';

// Structural types keep the optional Playwriter dependency out of the core install.
// Handles are retained deliberately: a Locator would silently resolve a replacement node.
type Handle = any;
type Page = any;
interface Connection {
  browser: { contexts(): { pages(): Page[] }[] };
  extensionBrowser?: { id: string };
  sessionId?: string;
  close(): Promise<void>;
}
export interface PlaywriterDependencies {
  connect?: (options: Record<string, unknown>) => Promise<Connection>;
  loadModule?: (name: string) => Promise<{ connectViaExtension: PlaywriterDependencies['connect'] }>;
}
interface DocumentRef { handle: Handle; id: string }
interface TargetRef { handle?: Handle; signature?: string; definition: BrowserCandidate }
interface Snapshot {
  page: Page; document: DocumentRef; observation: Observation; targets: Map<string, TargetRef>;
  operationId: string; recipeId: string; epoch: number;
}

const secretKey = /password|passphrase|secret|token|otp|one.?time|verification.?code|security.?code|card.?number|credit.?card|cvv|cvc/i;

/** Runs in the page; never reads an input's value. */
function probeElement(element: any) {
  const tag = String(element.tagName || '').toLowerCase();
  const attributes = ['type', 'autocomplete', 'id', 'name', 'aria-label', 'role', 'href']
    .map((key) => String(element.getAttribute(key) || ''));
  const metadata = attributes.slice(0, 6).join(' ');
  const sensitive = ['password', 'hidden', 'file'].includes(attributes[0].toLowerCase())
    || /password|passphrase|secret|token|otp|one.?time|verification.?code|security.?code|cc-|card.?number|credit.?card|cvv|cvc/i.test(metadata)
    || Boolean(element.closest('[data-private],[data-sensitive],[data-secret]'));
  const text = ['input', 'textarea', 'select'].includes(tag) ? '' : String(element.textContent || '').slice(0, 1024);
  return {
    connected: Boolean(element.isConnected), sensitive,
    editable: (tag === 'input' || tag === 'textarea') && !element.readOnly,
    singleSelect: tag === 'select' && !element.multiple,
    signature: JSON.stringify([tag, ...attributes, text, Boolean(element.readOnly), Boolean(element.disabled)]),
  };
}

/** Only a boolean leaves the page. Form values and editable content are never read. */
function matchesText(element: any, expected: string | null) {
  const tag = String(element.tagName || '').toLowerCase();
  const metadata = ['type', 'autocomplete', 'id', 'name', 'aria-label'].map((k) => element.getAttribute(k) || '').join(' ');
  if (['input', 'textarea', 'select'].includes(tag) || element.isContentEditable
    || /password|passphrase|secret|token|otp|one.?time|verification.?code|security.?code|cc-|card.?number|credit.?card|cvv|cvc/i.test(metadata)
    || element.closest('[data-private],[data-sensitive],[data-secret]')) return false;
  if (expected === null) return true;
  return String(element.textContent || '').trim().replace(/\s+/g, ' ') === expected.trim().replace(/\s+/g, ' ');
}
function documentReference() { return document; }
function documentIsCurrent(reference: unknown) { return reference === document; }
function sameElement(element: unknown, other: unknown) { return element === other; }
function selectChoices(element: any) {
  return Array.from(element.options || []).filter((option: any) => !option.disabled && !option.parentElement?.disabled)
    .map((option: any) => String(option.value));
}

function publicCandidate(candidate: BrowserCandidate): Candidate {
  return {
    id: candidate.id, kind: candidate.kind, label: candidate.label, effect: candidate.effect,
    ...(candidate.inputKey === undefined ? {} : { inputKey: candidate.inputKey }),
  };
}
function boundedUrlMatches(value: string, prefix: string, origin: string): boolean {
  try {
    const url = new URL(value), base = new URL(prefix);
    if (url.origin !== origin || base.origin !== origin) return false;
    const path = base.pathname.replace(/\/$/, '') || '/';
    return (path === '/' || url.pathname === path || url.pathname.startsWith(path + '/'))
      && (!base.search || base.search === url.search)
      && (!base.hash || base.hash === url.hash);
  } catch { return false; }
}

export class PlaywriterAdapter implements Adapter {
  readonly name = 'playwriter';
  private config: NonNullable<Config['playwriter']>;
  private scopes: Map<string, ScopeConfig>;
  private dependencies: PlaywriterDependencies;
  private connecting?: Promise<Connection>;
  private snapshots = new Map<string, Snapshot>();
  private documents = new Map<Page, DocumentRef>();
  private scopePages = new Map<string, Page>();
  private timeout: number;
  private verificationDeadlines = new Map<string, number>();

  constructor(config: NonNullable<Config['playwriter']>, scopes: ScopeConfig[], dependencies: PlaywriterDependencies = {}) {
    this.config = config;
    this.scopes = new Map(scopes.map((scope) => [scope.id, scope]));
    this.dependencies = dependencies;
    this.timeout = Math.max(100, Math.min(config.timeoutMs ?? 5000, 15000));
  }

  private async connection(): Promise<Connection> {
    if (this.config.preserveExtensionsVerified !== true) {
      throw new OperatorError('EXTENSION_COMPATIBILITY_REQUIRED',
        'Live Playwriter attachment is disabled until an extension build that preserves password-manager overlays has been verified. See docs/playwriter-compatibility.md.');
    }
    if (!this.connecting) {
      this.connecting = (async () => {
        const connect = this.dependencies.connect ?? (await (this.dependencies.loadModule ?? ((name) => import(name)))(this.config.module ?? 'playwriter')).connectViaExtension;
        if (typeof connect !== 'function') throw new Error('Unsupported SDK');
        return await connect({
          tabGroup: this.config.tabGroup ?? 'operator', closeTabsOnEnd: false,
          logger: { log: () => {} }, // Raw relay diagnostics must not enter MCP stdout or model context.
          selectBrowser: (browsers: { id: string }[]) => {
            if (this.config.browserId) return browsers.find(browser => browser.id === this.config.browserId);
            if (browsers.length !== 1) throw new OperatorError('BROWSER_SELECTION_REQUIRED', 'Select one Chrome profile when multiple bridges are available.');
            return browsers[0];
          },
        });
      })().catch(() => {
        this.connecting = undefined;
        throw new OperatorError('BROWSER_CONNECTION_UNAVAILABLE', 'The configured Playwriter SDK, relay, or browser is unavailable.');
      });
    }
    return this.connecting;
  }

  private definition(operation: Operation): { scope: ScopeConfig; recipe: BrowserRecipe } {
    const scope = this.scopes.get(operation.recipe.scopeId), recipe = operation.recipe.browser;
    if (!scope || !recipe || operation.recipe.adapter !== 'playwriter')
      throw new OperatorError('BROWSER_RECIPE_REQUIRED', 'A configured browser recipe and scope are required.');
    if (recipe.account.text !== scope.account || !boundedUrlMatches(recipe.urlPrefix, recipe.urlPrefix, scope.origin))
      throw new OperatorError('BROWSER_SCOPE_INVALID', 'The browser recipe must use the configured account and exact origin.');
    if (new Set(recipe.candidates.map((candidate) => candidate.id)).size !== recipe.candidates.length)
      throw new OperatorError('DUPLICATE_CANDIDATE', 'Browser candidate IDs must be unique.');
    return { scope, recipe };
  }

  async page(operation: Operation, guard: Guard): Promise<Page> {
    assertActive(guard);
    const { scope, recipe } = this.definition(operation);
    const connection = await this.connection();
    assertActive(guard);
    const matchingPages = () => connection.browser.contexts().flatMap((context) => context.pages())
      .filter((page) => !page.isClosed() && boundedUrlMatches(page.url(), recipe.urlPrefix, scope.origin));
    let matches = matchingPages();
    // Relay attach acknowledgements can arrive before the SDK consumes the target event.
    const until = Date.now() + 1000;
    while (!matches.length && Date.now() < until) {
      await delay(25, undefined, { signal: guard.signal }); assertActive(guard); matches = matchingPages();
    }
    if (matches.length !== 1) throw new OperatorError(matches.length ? 'BROWSER_TAB_AMBIGUOUS' : 'BROWSER_TAB_REQUIRED',
      'Exactly one existing, explicitly enabled tab must match the configured origin and path.');
    this.scopePages.set(scope.id, matches[0]);
    await this.assertIdentity(matches[0], operation, guard);
    return matches[0];
  }

  private async unique(page: Page, selector: string): Promise<Handle | undefined> {
    const locator = page.locator(selector);
    if (await locator.count() !== 1) return undefined;
    return await locator.elementHandle({ timeout: this.timeout }) ?? undefined;
  }

  private async assertIdentity(page: Page, operation: Operation, guard: Guard): Promise<void> {
    assertActive(guard);
    const { scope, recipe } = this.definition(operation);
    if (page.isClosed() || !boundedUrlMatches(page.url(), recipe.urlPrefix, scope.origin))
      throw new OperatorError('BROWSER_ORIGIN_CHANGED', 'The tab moved outside the configured origin or path.');
    const identity = await this.unique(page, recipe.account.selector);
    let matches = false;
    try { matches = !!identity && await identity.isVisible() && await identity.evaluate(matchesText, scope.account); }
    finally { await identity?.dispose().catch(() => {}); }
    assertActive(guard);
    if (!matches) throw new OperatorError('ACCOUNT_MISMATCH', 'The active account could not be verified. Hand control to the user.');
  }

  private async document(page: Page): Promise<DocumentRef> {
    const existing = this.documents.get(page);
    if (existing && await page.evaluate(documentIsCurrent, existing.handle).catch(() => false)) return existing;
    if (existing) await existing.handle.dispose().catch(() => {});
    const current = { handle: await page.evaluateHandle(documentReference), id: randomUUID() };
    this.documents.set(page, current);
    return current;
  }

  private async condition(page: Page, definition: BrowserCandidate): Promise<boolean> {
    const when = definition.when;
    if (!when) return true;
    const count = await page.locator(when.selector).count();
    if (when.absent) return count === 0;
    if (count !== 1) return false;
    const handle = await this.unique(page, when.selector);
    try { return !!handle && await handle.isVisible() && await handle.evaluate(matchesText, when.text ?? null); }
    finally { await handle?.dispose().catch(() => {}); }
  }

  private async clearSnapshot(scopeId: string): Promise<void> {
    const snapshot = this.snapshots.get(scopeId);
    this.snapshots.delete(scopeId);
    if (snapshot) await Promise.all([...snapshot.targets.values()].map((target) => target.handle?.dispose().catch(() => {})));
  }

  async observe(operation: Operation, guard: Guard): Promise<Observation> {
    try { return await this.observeInternal(operation, guard); }
    catch (error) {
      if (error instanceof OperatorError) throw error;
      throw new OperatorError('BROWSER_OBSERVATION_FAILED', 'The browser could not produce a fresh observation.');
    }
  }

  private async observeInternal(operation: Operation, guard: Guard): Promise<Observation> {
    const page = await this.page(operation, guard);
    const { scope, recipe } = this.definition(operation);
    await this.clearSnapshot(scope.id);
    const document = await this.document(page), targets = new Map<string, TargetRef>();
    try {
      for (const definition of recipe.candidates) {
        assertActive(guard);
        if (definition.inputKey && secretKey.test(definition.inputKey)) continue;
        if (!await this.condition(page, definition)) continue;
        if (definition.kind === 'request') continue;
        if (!definition.selector) {
          if (definition.kind === 'wait') targets.set(definition.id, { definition });
          continue;
        }
        const handle = await this.unique(page, definition.selector);
        if (!handle) continue;
        let keep = false;
        try {
          const probe = await handle.evaluate(probeElement);
          if (!probe.connected || probe.sensitive || !await handle.isVisible() || !await handle.isEnabled()) continue;
          if (definition.kind === 'type' && !probe.editable) continue;
          if (definition.kind === 'select' && !probe.singleSelect) continue;
          targets.set(definition.id, { definition, handle, signature: probe.signature });
          keep = true;
        } finally { if (!keep) await handle.dispose().catch(() => {}); }
      }
      await this.assertIdentity(page, operation, guard);
      if (!await page.evaluate(documentIsCurrent, document.handle).catch(() => false))
        throw new OperatorError('STALE_OBSERVATION', 'The document changed during observation. Observe again.');
      assertActive(guard);
      const observation: Observation = {
        id: randomUUID(), documentId: document.id, scopeId: scope.id, origin: scope.origin, account: scope.account,
        summary: operation.recipe.description, candidates: [...targets.values()].map((target) => publicCandidate(target.definition)),
        facts: {}, capturedAt: Date.now(),
      };
      this.snapshots.set(scope.id, { page, document, targets, observation, operationId: operation.id, recipeId: operation.recipe.id, epoch: guard.epoch });
      return observation;
    } catch (error) {
      await Promise.all([...targets.values()].map((target) => target.handle?.dispose().catch(() => {})));
      if (error instanceof OperatorError || guard.signal.aborted) throw error;
      throw new OperatorError('BROWSER_OBSERVATION_FAILED', 'The browser could not produce a fresh observation.');
    }
  }

  async execute(operation: Operation, candidate: Candidate, context: ExecutionContext): Promise<void> {
    try { await this.executeInternal(operation, candidate, context); }
    catch (error) {
      if (error instanceof OperatorError) throw error;
      throw new OperatorError('BROWSER_PREFLIGHT_FAILED', 'The browser target could not be revalidated before dispatch.');
    }
  }

  private async executeInternal(operation: Operation, candidate: Candidate, context: ExecutionContext): Promise<void> {
    assertActive(context);
    const snapshot = this.snapshots.get(operation.recipe.scopeId);
    const target = snapshot?.targets.get(candidate.id);
    if (!snapshot || !target || snapshot.observation.id !== context.observation.id
      || snapshot.document.id !== context.observation.documentId || snapshot.epoch !== context.epoch
      || snapshot.operationId !== operation.id || snapshot.recipeId !== operation.recipe.id
      || JSON.stringify(publicCandidate(target.definition)) !== JSON.stringify(candidate))
      throw new OperatorError('STALE_OBSERVATION', 'Observe again before acting on this target.');
    const { page, document } = snapshot, { definition, handle } = target;
    await this.assertIdentity(page, operation, context);
    if (!await page.evaluate(documentIsCurrent, document.handle).catch(() => false) || !await this.condition(page, definition))
      throw new OperatorError('STALE_TARGET', 'The document or action precondition changed. Observe again.');
    if (handle) {
      const fresh = await this.unique(page, definition.selector!);
      let current = false;
      try {
        const probe = await handle.evaluate(probeElement);
        current = !!fresh && await handle.evaluate(sameElement, fresh) && probe.connected && !probe.sensitive
          && probe.signature === target.signature && await handle.isVisible() && await handle.isEnabled();
      } finally { await fresh?.dispose().catch(() => {}); }
      if (!current) throw new OperatorError('STALE_TARGET', 'The observed element changed. Observe again.');
    }
    const input = definition.inputKey ? operation.input[definition.inputKey] : undefined;
    if (['type', 'select'].includes(definition.kind) && (input === undefined || !definition.inputKey
      || secretKey.test(definition.inputKey) || String(input).length > 4096))
      throw new OperatorError('INPUT_UNAVAILABLE', 'A bounded, nonsecret input must be supplied for this action.');
    let optionIndex = -1;
    if (definition.kind === 'select') {
      const values = await handle.evaluate(selectChoices);
      if (values.filter((value: string) => value === String(input)).length !== 1)
        throw new OperatorError('SELECT_OPTION_UNAVAILABLE', 'The requested select option is unavailable or ambiguous.');
      optionIndex = values.indexOf(String(input));
    }
    await this.assertIdentity(page, operation, context);
    assertActive(context);
    try {
      switch (definition.kind) {
        case 'click': await handle.click({ timeout: this.timeout }); break;
        case 'type': {
          await handle.click({ timeout: this.timeout });
          assertActive(context);
          await handle.press('ControlOrMeta+A', { timeout: this.timeout });
          assertActive(context);
          // ElementHandle.type uses browser keyboard input; no value assignment/dispatchEvent.
          // Unicode may use inserted text rather than a physical key sequence.
          if (String(input) === '') await handle.press('Backspace', { timeout: this.timeout });
          else await typeWithPolicy(handle, String(input), context, this.config.inputPolicy, this.timeout);
          break;
        }
        case 'select': {
          await handle.click({ timeout: this.timeout });
          assertActive(context);
          await handle.press('Home', { timeout: this.timeout });
          for (let index = 0; index < optionIndex; index++) {
            assertActive(context);
            await handle.press('ArrowDown', { timeout: this.timeout });
          }
          assertActive(context);
          await handle.press('Enter', { timeout: this.timeout });
          break;
        }
        case 'scroll': {
          const box = await handle.boundingBox();
          if (!box) throw new Error('Target disappeared');
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          assertActive(context);
          await page.mouse.wheel(0, (definition.direction === 'up' ? -1 : 1) * Math.max(1, Math.min(definition.pixels ?? 480, 1200)));
          break;
        }
        case 'wait': await delay(Math.max(0, Math.min(definition.waitMs ?? 100, 1000)), undefined, { signal: context.signal }); break;
        default: throw new OperatorError('ACTION_UNSUPPORTED', 'This browser action is not implemented.');
      }
      assertActive(context);
      if (candidate.effect === 'write') this.verificationDeadlines.set(operation.id, Date.now() + this.timeout);
    } catch (error) {
      // Even a timeout may follow a click or partial typing. The engine must reconcile.
      throw new OperatorError('BROWSER_ACTION_UNCERTAIN', 'The action may have partially or fully executed; verify before any retry.', false);
    } finally { await this.clearSnapshot(operation.recipe.scopeId); }
  }

  async verify(operation: Operation, guard: Guard): Promise<Verification> {
    try {
      let result = await this.verifyInternal(operation, guard);
      while (result.state === 'not_satisfied' && Date.now() < (this.verificationDeadlines.get(operation.id) ?? 0)) {
        await delay(40, undefined, { signal: guard.signal });
        assertActive(guard);
        result = await this.verifyInternal(operation, guard);
      }
      this.verificationDeadlines.delete(operation.id);
      return result;
    }
    catch (error) {
      if (error instanceof OperatorError) throw error;
      return { state: 'unknown', code: 'BROWSER_VERIFICATION_FAILED' };
    }
  }

  private async verifyInternal(operation: Operation, guard: Guard): Promise<Verification> {
    const page = await this.page(operation, guard);
    const goal = this.definition(operation).recipe.goal;
    if (goal.inputKey && secretKey.test(goal.inputKey)) return { state: 'unknown', code: 'SECRET_VERIFICATION_UNSUPPORTED' };
    const expected = goal.inputKey ? operation.input[goal.inputKey] : goal.text;
    if (goal.inputKey && expected === undefined) return { state: 'unknown', code: 'VERIFICATION_INPUT_MISSING' };
    const count = await page.locator(goal.selector).count();
    if (!count) return { state: 'not_satisfied', code: 'GOAL_ABSENT' };
    if (count !== 1) return { state: 'unknown', code: 'GOAL_AMBIGUOUS' };
    const handle = await this.unique(page, goal.selector);
    let satisfied = false;
    try { satisfied = !!handle && await handle.isVisible() && await handle.evaluate(matchesText, expected === undefined ? null : String(expected)); }
    finally { await handle?.dispose().catch(() => {}); }
    await this.assertIdentity(page, operation, guard);
    assertActive(guard);
    return { state: satisfied ? 'satisfied' : 'not_satisfied', code: satisfied ? 'DOM_GOAL_MATCHED' : 'DOM_GOAL_UNMATCHED' };
  }

  async release(scopeId: string): Promise<void> {
    await this.clearSnapshot(scopeId);
    // No deliberately held input spans calls. Do not send unconditional key/mouse-up
    // events here: they could release a physical key the user is holding after takeover.
    // SDK close is not a per-tab debugger detach; human authentication must detach via
    // the extension until a verified preservation/detach bridge is installed.
    this.scopePages.delete(scopeId);
  }

  async control(scopeId: string, action: 'pause' | 'resume' | 'cancel'): Promise<void> {
    const scope = this.scopes.get(scopeId);
    if (!scope) throw new OperatorError('UNKNOWN_SCOPE', 'Unknown browser scope.');
    await this.clearSnapshot(scopeId);
    const connection = await this.connection();
    if (!connection.extensionBrowser?.id || !connection.sessionId) throw new Error('Bridge control identity unavailable');
    const sdk = await import(this.config.module ?? 'playwriter');
    const url = sdk.getCdpUrl({ extensionId: connection.extensionBrowser.id, sessionId: connection.sessionId });
    const result: any = await new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      const finish = (error?: Error, value?: unknown) => { clearTimeout(timer); socket.close(); error ? reject(error) : resolve(value); };
      const timer = setTimeout(() => finish(new Error('Bridge control deadline')), this.timeout);
      socket.onopen = () => socket.send(JSON.stringify({ id: 1, method: 'WebOperator.control', params: { origin: scope.origin, action: action === 'cancel' ? 'pause' : action } }));
      socket.onmessage = event => {
        try { const message = JSON.parse(String(event.data)); if (message.id === 1) finish(message.error ? new Error('Bridge rejected control') : undefined, message.result); }
        catch { finish(new Error('Bridge response invalid')); }
      };
      socket.onerror = () => finish(new Error('Bridge control unavailable'));
    });
    if ((action === 'resume' && !result?.resumed) || (action !== 'resume' && !result?.detached)) throw new Error('Unverified browser control');
  }

  async close(): Promise<void> {
    for (const scopeId of [...this.snapshots.keys()]) await this.clearSnapshot(scopeId);
    for (const document of this.documents.values()) await document.handle.dispose().catch(() => {});
    this.documents.clear();
    this.scopePages.clear();
    if (this.connecting) {
      const pending = this.connecting;
      this.connecting = undefined;
      await (await pending).close(); // Never browser.close(), context.close(), or page.close().
    }
  }
}
