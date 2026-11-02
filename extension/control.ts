// Appended to the pinned Playwriter service worker by scripts/build-extension.ts.
// Durable paused tab IDs survive service-worker suspension. No credentials are captured.
async function webOperatorControl(params: { action?: string; origin?: string }) {
  const { action, origin } = params || {};
  if (!origin || new URL(origin).origin !== origin || !['pause', 'resume', 'status'].includes(action || ''))
    throw new Error('Invalid local control request');
  const key = 'webOperatorPaused';
  const stored = await chrome.storage.local.get(key);
  const paused: Record<string, number[]> = stored[key] || {};
  if (action === 'pause') {
    const ids: number[] = [];
    for (const tabId of store.getState().tabs.keys()) {
      const tab = await chrome.tabs.get(tabId);
      if (tab.url && new URL(tab.url).origin === origin) ids.push(tabId);
    }
    paused[origin] = [...new Set([...(paused[origin] || []), ...ids])];
    await chrome.storage.local.set({ [key]: paused });
    for (const tabId of ids) {
      // Remove tracking first: onDetach must not automatically reattach.
      detachTab(tabId, false);
      await chrome.debugger.detach({ tabId });
    }
    for (const tabId of ids) {
      let attached = true;
      try { await chrome.debugger.sendCommand({ tabId }, 'Runtime.getIsolateId'); }
      catch (error) {
        if (/not attached/i.test(String(error))) attached = false;
        else throw new Error('Detach verification unavailable');
      }
      if (attached) throw new Error('Detach not verified');
    }
    return { detached: true, count: ids.length };
  }
  if (action === 'resume') {
    for (const tabId of paused[origin] || []) {
      const tab = await chrome.tabs.get(tabId);
      if (!tab.url || new URL(tab.url).origin !== origin) throw new Error('Paused tab origin changed');
      await attachTab(tabId);
    }
    delete paused[origin];
    await chrome.storage.local.set({ [key]: paused });
    return { resumed: true };
  }
  return { paused: Boolean(paused[origin]?.length), count: paused[origin]?.length || 0 };
}

chrome.commands.onCommand.addListener(async command => {
  if (command !== 'take-over') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url) await webOperatorControl({ action: 'pause', origin: new URL(tab.url).origin });
});
