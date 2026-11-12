const copyButton = document.querySelector('[data-copy]');
const command = document.querySelector('#install-command');
const copyStatus = document.querySelector('.copy-status');

copyButton.hidden = false;
copyButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(command.textContent);
    copyButton.textContent = 'Copied';
    copyStatus.textContent = 'Copied. Paste the commands into your terminal.';
  } catch {
    const range = document.createRange();
    range.selectNodeContents(command);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    copyStatus.textContent = 'Commands selected. Use your keyboard shortcut to copy.';
  }
});

const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
const strip = document.querySelector('.element-strip');
let scrollFrame = 0;

function updateTile() {
  scrollFrame = 0;
  if (motion.matches) return;
  const box = strip.getBoundingClientRect();
  const progress = Math.max(0, Math.min(1, (innerHeight - box.top) / (innerHeight * 0.8)));
  strip.style.setProperty('--lift', `${-24 * progress}px`);
}

function requestTileUpdate() {
  if (!scrollFrame) scrollFrame = requestAnimationFrame(updateTile);
}

window.addEventListener('scroll', requestTileUpdate, { passive: true });
motion.addEventListener('change', requestTileUpdate);
requestTileUpdate();

if ('IntersectionObserver' in window) {
  const sections = document.querySelectorAll('.section-heading, .steps li, .faq details');
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

video.addEventListener('ended', () => updateControl(true));
motionButton.addEventListener('click', () => {
  if (video.ended) {
    video.currentTime = 0;
    userPaused = false;
  } else {
    userPaused = !userPaused;
  }
  updateControl(userPaused);
  updateVideo();
});
motion.addEventListener('change', () => {
  if (!motion.matches && userPaused) motionButton.hidden = false;
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
