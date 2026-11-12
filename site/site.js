for (const button of document.querySelectorAll('[data-copy]')) {
  const command = document.getElementById(button.dataset.copy);
  const status = button.closest('.command-block').querySelector('.copy-status');
  button.hidden = false;
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(command.textContent);
      button.setAttribute('data-copied', '');
      status.textContent = 'Copied. Paste into your terminal.';
    } catch {
      button.removeAttribute('data-copied');
      const range = document.createRange();
      range.selectNodeContents(command);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      status.textContent = 'Command selected. Use your keyboard shortcut to copy.';
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

const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
if ('IntersectionObserver' in window) {
  const sections = document.querySelectorAll('.section-heading, .engine-notes article, .engine-map');
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      if (!motion.matches) {
        if (entry.target.matches('.engine-map')) entry.target.setAttribute('data-entered', '');
        entry.target.animate(
          [{ opacity: 0.55, transform: 'translateY(15px)' }, { opacity: 1, transform: 'translateY(0)' }],
          { duration: 450, easing: 'cubic-bezier(.2,.7,.3,1)' }
        );
      }
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.18 });
  sections.forEach((section) => observer.observe(section));
}
