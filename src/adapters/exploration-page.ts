import { lookup } from 'node:dns/promises';
import { publicAddress, publicTarget } from '../public-read.ts';
import { OperatorError } from '../contracts.ts';
import type { ExplorationPage, ExploreControl } from '../exploration.ts';

/** This code executes in Chrome. Values from forms, editable and private regions never leave the page. */
function inspect() {
  const sensitive = 'input,textarea,select,[contenteditable],[data-private],[data-sensitive],[data-secret],script,style,noscript,template';
  const blocked = Array.from(document.querySelectorAll('input[type=password],iframe[src*="captcha"],iframe[src*="challenges.cloudflare"],[class*="g-recaptcha"],[class*="h-captcha"]')).some(node => node.checkVisibility());
  const root = document.body.cloneNode(true) as HTMLElement;
  const originals = Array.from(document.body.querySelectorAll('*'));
  const copies = Array.from(root.querySelectorAll('*'));
  originals.forEach((node, index) => {
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || node.getAttribute('aria-hidden') === 'true') copies[index]?.remove();
  });
  root.querySelectorAll(sensitive).forEach(node => node.remove());
  const passages = Array.from(root.querySelectorAll('p,div,blockquote,li,td,h1,h2,h3,article,section,pre,[role=status]'))
    .map(node => (node.textContent || '').trim().replace(/\s+/g, ' '))
    .filter(text => text.length > 15 && text.length <= 2000);
  return { blocked, passages: [...new Set(passages)].slice(0, 64) };
}
function describe(node: any) {
  if (!node.isConnected || node.closest('[data-private],[data-sensitive],[data-secret],[contenteditable]')) return null;
  const label = (node.getAttribute('aria-label') || node.innerText || node.getAttribute('placeholder') || '').trim().slice(0, 240);
  if (!label || /log.?out|sign.?out|delete|remove|purchase|buy|subscribe|unsubscribe|checkout|captcha|verify.*human|robot/i.test(label + ' ' + (node.getAttribute('href') || ''))) return null;
  const tag = node.tagName.toLowerCase();
  let kind: 'link' | 'reveal' | 'search' | 'button';
  if (tag === 'a' && node.href) kind = 'link';
  else if (tag === 'input' && node.type === 'search' && node.form && node.form.method.toLowerCase() === 'get') kind = 'search';
  else if ((node.getAttribute('role') === 'tab' || node.hasAttribute('aria-expanded') || tag === 'summary') && !node.closest('form')) kind = 'reveal';
  else if (tag === 'button' && !node.closest('form')) kind = 'button';
  else return null;
  return { label, kind, href: kind === 'link' ? node.href : kind === 'search' ? node.form.action : undefined,
    signature: JSON.stringify([tag,label,node.getAttribute('href'),node.getAttribute('aria-controls'),node.getAttribute('aria-expanded'),node.form?.action]) };
}

export async function openExplorationPage(context: any, target: string, signal: AbortSignal): Promise<ExplorationPage> {
  const origin = publicTarget(target).origin;
  const addresses = await lookup(new URL(target).hostname, { all: true, family: 4 });
  if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new OperatorError('PUBLIC_TARGET_REQUIRED','Exploration requires a public target.');
  signal.throwIfAborted();
  const page = await context.newPage();
  const handles = new Map<string, { handle: any; signature: string; control: ExploreControl }>();
  let documentHandle: any;
  const guard = () => {
    signal.throwIfAborted();
    if (new URL(page.url()).origin !== origin) throw new OperatorError('EXPLORATION_ORIGIN_CHANGED','Exploration left the target origin.');
  };
  const clear = async () => {
    for (const { handle } of handles.values()) await handle.dispose().catch(() => {});
    handles.clear();
    await documentHandle?.dispose().catch(() => {});
  };
  const abort = () => { void page.close().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    // Route only this task-owned tab; never alter routes or tabs belonging to another caller.
    await page.route('**/*', async (route: any) => {
      const request = route.request();
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
        try { const url = publicTarget(request.url().split('#')[0]); if (url.origin !== origin || request.method() !== 'GET') return route.abort(); }
        catch { return route.abort(); }
      }
      return route.continue();
    });
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(350);
    return {
      async observe() {
        guard(); await clear();
        documentHandle = await page.evaluateHandle(() => document);
        const state = await page.evaluate(inspect);
        if (state.blocked) return { url: page.url(), passages: [], controls: [], blocked: 'AUTH_OR_CHALLENGE_REQUIRED' };
        const nodes = await page.$$('a[href],button,[role=tab],summary,input[type=search]');
        const controls: ExploreControl[] = [];
        for (const handle of nodes) {
          const data = await handle.evaluate(describe);
          let allowed = data && await handle.isVisible() && await handle.isEnabled();
          if (allowed && data.href) {
            try { allowed = publicTarget(data.href.split('#')[0]).origin === origin; } catch { allowed = false; }
          }
          if (allowed && controls.length < 64) {
            const control = { id: 'c'+controls.length, label: data.label, kind: data.kind, ...(data.href ? {href:data.href} : {}) };
            controls.push(control); handles.set(control.id, { handle, signature: data.signature, control });
          } else await handle.dispose();
        }
        guard();
        return { url: page.url(), passages: state.passages, controls };
      },
      async act(id, query) {
        guard();
        const retained = handles.get(id);
        if (!retained || !await page.evaluate((reference: any) => reference === document, documentHandle))
          throw new OperatorError('STALE_OBSERVATION','Exploration document changed.');
        const current = await retained.handle.evaluate(describe);
        if (!current || current.signature !== retained.signature || !await retained.handle.isVisible() || !await retained.handle.isEnabled())
          throw new OperatorError('STALE_OBSERVATION','Exploration control changed.');
        guard();
        if (retained.control.kind === 'search') {
          await retained.handle.fill(query, { timeout: 3000 }); guard();
          await retained.handle.press('Enter', { timeout: 3000 });
        } else await retained.handle.click({ timeout: 3000 });
        await page.waitForLoadState('domcontentloaded', { timeout: 5000 });
        // Allow a bounded async render after disclosure or client-side navigation.
        await page.waitForTimeout(350);
        guard();
      },
      async wait() { guard(); await page.waitForTimeout(1500); guard(); },
      async close() { signal.removeEventListener('abort', abort); await clear(); await page.close().catch(() => {}); },
    };
  } catch (error) { signal.removeEventListener('abort', abort); await page.close().catch(() => {}); throw error; }
}
