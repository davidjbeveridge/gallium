for (const button of document.querySelectorAll('[data-copy]')) {
  const command = document.getElementById(button.dataset.copy);
  const status = button.closest('.command-block').querySelector('.copy-status');
  let confirmation;
  button.hidden = false;
  button.addEventListener('click', async () => {
    clearTimeout(confirmation);
    status.textContent = '';
    try {
      await navigator.clipboard.writeText(command.textContent);
      button.setAttribute('data-copied', '');
      status.classList.add('copy-confirmation');
      status.textContent = 'Copied';
      confirmation = setTimeout(() => {
        button.removeAttribute('data-copied');
        status.textContent = '';
      }, 2000);
    } catch {
      button.removeAttribute('data-copied');
      status.classList.remove('copy-confirmation');
      const range = document.createRange();
      range.selectNodeContents(command);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      status.textContent = 'Selected. Use your keyboard shortcut to copy.';
    }
  });
}

const routeTabs = document.querySelector('[data-route-tabs]');
const tabs = [...routeTabs.querySelectorAll('button')];
const panels = tabs.map((tab) => document.getElementById(tab.getAttribute('aria-controls')));

function selectRoute(index) {
  tabs.forEach((tab, position) => {
    const selected = position === index;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    panels[position].hidden = !selected;
  });
}

routeTabs.setAttribute('role', 'tablist');
routeTabs.setAttribute('aria-label', 'Example tasks');
tabs.forEach((tab, index) => {
  const panel = panels[index];
  tab.setAttribute('role', 'tab');
  panel.setAttribute('role', 'tabpanel');
  panel.setAttribute('aria-labelledby', tab.id);
  panel.tabIndex = 0;
  tab.addEventListener('click', () => selectRoute(index));
  tab.addEventListener('keydown', (event) => {
    let next;
    switch (event.key) {
      case 'ArrowLeft': next = (index - 1 + tabs.length) % tabs.length; break;
      case 'ArrowRight': next = (index + 1) % tabs.length; break;
      case 'Home': next = 0; break;
      case 'End': next = tabs.length - 1; break;
      default: return;
    }
    event.preventDefault();
    selectRoute(next);
    tabs[next].focus();
  });
});
selectRoute(0);
routeTabs.hidden = false;

const routeConsole = routeTabs.closest('.route-console');
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting) return;
    routeConsole.setAttribute('data-seen', '');
    observer.disconnect();
  });
  observer.observe(routeConsole);
} else {
  routeConsole.setAttribute('data-seen', '');
}
