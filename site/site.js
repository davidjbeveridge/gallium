for (const button of document.querySelectorAll('[data-copy]')) {
  const command = document.getElementById(button.dataset.copy);
  const status = button.closest('.command-block').querySelector('.copy-status');
  button.hidden = false;
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(command.textContent);
      status.textContent = 'Copied. Paste into your terminal.';
    } catch {
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
const board = document.querySelector('.periodic-board');
if ('IntersectionObserver' in window && !motion.matches) {
  board.setAttribute('data-awaiting', '');
  const revealGallium = new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting) return;
    board.removeAttribute('data-awaiting');
    revealGallium.disconnect();
  }, { threshold: 0.3 });
  revealGallium.observe(board);
}

if ('IntersectionObserver' in window) {
  const sections = document.querySelectorAll('.section-heading, .engine-notes article');
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      if (!motion.matches) {
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

const video = document.querySelector('[data-motion-src]');
const heroMedia = video.parentElement;
const motionButton = document.querySelector('.motion-toggle');
let inView = !('IntersectionObserver' in window);
let userPaused = false;

function updateControl(paused) {
  const label = video.ended ? 'Replay hero video' : paused ? 'Play hero video' : 'Pause hero video';
  motionButton.toggleAttribute('data-paused', paused);
  motionButton.setAttribute('aria-label', label);
  motionButton.title = label;
}

function loadVideo() {
  if (video.firstElementChild) return;
  for (const [url, type] of [
    [video.dataset.motionSrc, 'video/webm'],
    [video.dataset.motionFallback, 'video/mp4'],
  ]) {
    const source = document.createElement('source');
    source.src = url;
    source.type = type;
    video.append(source);
  }
  video.load();
}

function updateVideo() {
  if (motion.matches || userPaused || video.ended || !inView || document.hidden) {
    video.pause();
    if (motion.matches) {
      heroMedia.removeAttribute('data-playing');
      video.hidden = true;
      motionButton.hidden = true;
    }
    return;
  }

  loadVideo();
  video.hidden = false;
  video.play().then(() => {
    if (motion.matches || userPaused || !inView || document.hidden) {
      video.pause();
      return;
    }
    heroMedia.removeAttribute('data-settled');
    heroMedia.setAttribute('data-playing', '');
    motionButton.hidden = false;
    updateControl(false);
  }).catch((error) => {
    if (error.name !== 'NotAllowedError' || motion.matches || !inView || document.hidden) return;
    userPaused = true;
    motionButton.hidden = false;
    updateControl(true);
  });
}

const canvas = heroMedia.querySelector('.hero-metal');
let drawMetal;
let animationFrame = 0;
let fullyRaised = false;

function resetTilt() {
  if (fullyRaised) drawMetal(1);
}

function hideMetal() {
  cancelAnimationFrame(animationFrame);
  fullyRaised = false;
  canvas.hidden = true;
}

function showPoster() {
  hideMetal();
  heroMedia.setAttribute('data-settled', '');
  heroMedia.removeAttribute('data-playing');
}

video.addEventListener('ended', () => {
  updateControl(true);
  if (motion.matches) return;
  drawMetal ??= window.createGalliumModel(canvas);
  if (!drawMetal) {
    showPoster();
    return;
  }
  canvas.hidden = false;
  const started = performance.now();
  function raise(now) {
    const progress = Math.min(1, (now - started) / 1400);
    drawMetal(progress * progress * (3 - 2 * progress));
    fullyRaised = progress === 1;
    if (!fullyRaised) animationFrame = requestAnimationFrame(raise);
  }
  drawMetal(0);
  animationFrame = requestAnimationFrame(raise);
});

canvas.addEventListener('webglcontextlost', () => {
  drawMetal = null;
  if (video.ended) showPoster();
});

const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
heroMedia.addEventListener('pointermove', (event) => {
  if (!fullyRaised || motion.matches || !finePointer.matches || event.pointerType !== 'mouse') return;
  const box = heroMedia.getBoundingClientRect();
  drawMetal(1, (0.5 - (event.clientY - box.top) / box.height) * .36,
    ((event.clientX - box.left) / box.width - 0.5) * .46);
});
heroMedia.addEventListener('pointerleave', resetTilt);
finePointer.addEventListener('change', resetTilt);
motionButton.addEventListener('click', () => {
  if (video.ended) {
    hideMetal();
    video.currentTime = 0;
    userPaused = false;
  } else {
    userPaused = !userPaused;
  }
  updateControl(userPaused);
  updateVideo();
});
motion.addEventListener('change', () => {
  if (motion.matches) hideMetal();
  if (!motion.matches && (userPaused || video.ended)) motionButton.hidden = false;
  if (!motion.matches && video.ended) {
    video.hidden = false;
    video.dispatchEvent(new Event('ended'));
    if (drawMetal) heroMedia.setAttribute('data-playing', '');
  }
  updateVideo();
});
document.addEventListener('visibilitychange', updateVideo);

if ('IntersectionObserver' in window) {
  const mediaObserver = new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    updateVideo();
  }, { threshold: 0.2 });
  mediaObserver.observe(video.closest('.hero'));
} else {
  updateVideo();
}
