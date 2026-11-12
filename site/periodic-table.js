const stage = document.querySelector('.periodic-stage');
const board = stage.querySelector('.periodic-board');
const picker = document.querySelector('#element-picker');
const specimen = {
  number: document.querySelector('#specimen-number'),
  symbol: document.querySelector('#specimen-symbol'),
  name: document.querySelector('#specimen-name'),
  position: document.querySelector('#specimen-position'),
};

const entriesByButton = new Map();
const entriesByNumber = new Map();
const rows = [...board.querySelectorAll('.periodic-row')].map((row, rowIndex) =>
  [...row.querySelectorAll('.periodic-cell')].map((cell) => {
    const number = cell.querySelector('small').textContent;
    const symbol = cell.querySelector('b').textContent;
    const name = { Ga: 'Gallium', Cr: 'Chromium' }[symbol] ?? symbol;
    const column = Number(cell.getAttribute('aria-colindex'));
    const button = document.createElement('button');
    button.type = 'button';
    button.tabIndex = -1;
    button.setAttribute('aria-label', name === symbol ? `${number} ${symbol}` : `${number} ${symbol}, ${name}`);
    button.append(...cell.childNodes);
    cell.append(button);
    cell.setAttribute('role', 'gridcell');
    cell.setAttribute('aria-selected', 'false');
    const entry = { number, symbol, name, column, rowIndex, button, cell };
    entriesByButton.set(button, entry);
    entriesByNumber.set(number, entry);
    return entry;
  })
);

for (const entry of [...entriesByNumber.values()].sort((a, b) => Number(a.number) - Number(b.number))) {
  const label = entry.name === entry.symbol ? entry.symbol : `${entry.symbol} · ${entry.name}`;
  picker.add(new Option(`${entry.number} · ${label}`, entry.number));
}

let selected;
function select(entry) {
  if (entry === selected) return;
  if (selected) {
    selected.cell.removeAttribute('data-selected');
    selected.cell.parentElement.removeAttribute('data-active');
    selected.cell.setAttribute('aria-selected', 'false');
    selected.button.tabIndex = -1;
  }
  selected = entry;
  entry.cell.setAttribute('data-selected', '');
  entry.cell.parentElement.setAttribute('data-active', '');
  entry.cell.setAttribute('aria-selected', 'true');
  entry.button.tabIndex = 0;
  picker.value = entry.number;
  specimen.number.textContent = entry.number;
  specimen.symbol.textContent = entry.symbol;
  specimen.name.textContent = entry.name;
  const location = entry.rowIndex < 7
    ? `Group ${entry.column} · Period\u00a0${entry.rowIndex + 1}`
    : entry.rowIndex === 7 ? 'Lanthanoid series · Period\u00a06' : 'Actinoid series · Period\u00a07';
  specimen.position.textContent = `Atomic number ${entry.number} · ${location}`;
}

board.setAttribute('role', 'grid');
board.setAttribute('aria-rowcount', String(rows.length));
board.setAttribute('data-interactive', '');
select(entriesByNumber.get('31'));
picker.parentElement.hidden = false;

board.addEventListener('click', (event) => {
  const entry = entriesByButton.get(event.target.closest('button'));
  if (entry) select(entry);
});
picker.addEventListener('change', () => select(entriesByNumber.get(picker.value)));

board.addEventListener('keydown', (event) => {
  const entry = entriesByButton.get(event.target);
  if (!entry || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
  const row = rows[entry.rowIndex];
  const index = row.indexOf(entry);
  let target;
  switch (event.key) {
    case 'ArrowLeft': target = row[index - 1]; break;
    case 'ArrowRight': target = row[index + 1]; break;
    case 'Home': target = row[0]; break;
    case 'End': target = row.at(-1); break;
    case 'ArrowUp':
    case 'ArrowDown': {
      const nextRow = rows[entry.rowIndex + (event.key === 'ArrowUp' ? -1 : 1)];
      target = nextRow?.reduce((best, cell) =>
        Math.abs(cell.column - entry.column) < Math.abs(best.column - entry.column) ? cell : best
      );
      break;
    }
    default: return;
  }
  event.preventDefault();
  if (!target) return;
  select(target);
  target.button.focus();
});

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
const narrowTable = matchMedia('(max-width: 700px)');
const clamp = (value) => Math.min(1, Math.max(0, value));
let inView = !('IntersectionObserver' in window);
let frame = 0;
let pointer;

function renderMaterial() {
  frame = 0;
  const bounds = stage.getBoundingClientRect();
  const depth = clamp((innerHeight * .84 - bounds.top) / (innerHeight * .65));
  const x = pointer ? clamp((pointer.x - bounds.left) / bounds.width) : .5;
  const y = pointer ? clamp((pointer.y - bounds.top) / bounds.height) : .5;
  const pitch = narrowTable.matches ? 15 - depth * 6 : 29 - depth * 14;
  const pointerTilt = pointer ? (.5 - y) * 8 : 0;
  stage.style.setProperty('--board-pitch', `${pitch + pointerTilt}deg`);
  stage.style.setProperty('--board-yaw', `${pointer ? (x - .5) * 12 : 0}deg`);
  if (depth > .24) stage.setAttribute('data-lifted', '');
}

function schedule() {
  if (!frame && inView && !reducedMotion.matches && !document.hidden) {
    frame = requestAnimationFrame(renderMaterial);
  }
}

function resetPointer() {
  pointer = undefined;
  schedule();
}

if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    if (!inView) {
      cancelAnimationFrame(frame);
      frame = 0;
      pointer = undefined;
    }
    schedule();
  });
  observer.observe(stage);
} else {
  schedule();
}

stage.addEventListener('pointermove', (event) => {
  if (event.pointerType !== 'mouse' || !finePointer.matches || reducedMotion.matches) return;
  pointer = { x: event.clientX, y: event.clientY };
  schedule();
}, { passive: true });
stage.addEventListener('pointerleave', resetPointer);
window.addEventListener('scroll', schedule, { passive: true });
window.addEventListener('resize', schedule, { passive: true });
document.addEventListener('visibilitychange', schedule);
finePointer.addEventListener('change', resetPointer);
reducedMotion.addEventListener('change', () => {
  cancelAnimationFrame(frame);
  frame = 0;
  resetPointer();
});
