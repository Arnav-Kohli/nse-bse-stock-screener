const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------------- Scroll progress bar ---------------- */
const progressBar = document.getElementById("scrollProgressBar");
function updateScrollProgress() {
  const scrollTop = window.scrollY;
  const docHeight = document.documentElement.scrollHeight - window.innerHeight;
  const pct = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
  if (progressBar) progressBar.style.width = pct + "%";
}

/* ---------------- Reveal on scroll (staggered) ---------------- */
function setupReveals(selector, baseDelayMs) {
  const groups = new Map();
  document.querySelectorAll(selector).forEach((el) => {
    const parent = el.parentElement;
    if (!groups.has(parent)) groups.set(parent, []);
    groups.get(parent).push(el);
  });
  groups.forEach((els) => {
    els.forEach((el, i) => {
      if (!el.style.transitionDelay) {
        el.style.transitionDelay = Math.min(i * baseDelayMs, baseDelayMs * 6) + "ms";
      }
    });
  });

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
  );
  document.querySelectorAll(selector).forEach((el) => observer.observe(el));
}

setupReveals(".reveal", 0);
setupReveals(".reveal-card", 90);

/* ---------------- Hero parallax ---------------- */
const heroGlow = document.getElementById("heroGlow");
const heroContent = document.getElementById("heroContent");
const hero = document.querySelector(".hero");

function updateHeroParallax() {
  if (reduceMotion || !hero) return;
  const heroHeight = hero.offsetHeight;
  const scrollY = window.scrollY;
  const progress = Math.min(scrollY / heroHeight, 1);

  if (heroGlow) {
    heroGlow.style.transform = `translate(-50%, ${scrollY * 0.35}px)`;
  }
  if (heroContent) {
    heroContent.style.opacity = String(Math.max(1 - progress * 1.6, 0));
    heroContent.style.transform = `translateY(${progress * 60}px) scale(${1 - progress * 0.06})`;
  }
}

/* ---------------- Scroll-scrubbed canvas video sequences ---------------- */
class ScrubSequence {
  constructor(pinEl) {
    this.pin = pinEl;
    this.sticky = pinEl.querySelector(".scrub-sticky");
    this.canvas = pinEl.querySelector(".scrub-canvas");
    this.ctx = this.canvas.getContext("2d");
    this.progressFill = pinEl.querySelector(".scrub-progress-fill");
    this.dir = pinEl.dataset.framesDir;
    this.count = parseInt(pinEl.dataset.frameCount, 10);
    this.pad = parseInt(pinEl.dataset.framePad, 10) || 3;
    this.images = [];
    this.loaded = 0;
    this.lastDrawnIndex = -1;
    this.ready = false;

    this.resize = this.resize.bind(this);
    this.render = this.render.bind(this);

    this.preload();
    window.addEventListener("resize", this.resize);
    this.resize();
  }

  frameUrl(i) {
    const n = String(i + 1).padStart(this.pad, "0");
    return `${this.dir}/frame_${n}.jpg`;
  }

  preload() {
    for (let i = 0; i < this.count; i++) {
      const img = new Image();
      img.src = this.frameUrl(i);
      img.onload = () => {
        this.loaded++;
        if (i === 0) this.drawFrame(0);
        if (this.loaded === this.count) this.ready = true;
      };
      this.images[i] = img;
    }
  }

  resize() {
    const rect = this.sticky.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    if (this.lastDrawnIndex >= 0) this.drawFrame(this.lastDrawnIndex);
  }

  drawFrame(index) {
    const img = this.images[index];
    if (!img || !img.complete || img.naturalWidth === 0) return;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const scale = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    const dx = (cw - dw) / 2;
    const dy = (ch - dh) / 2;
    this.ctx.clearRect(0, 0, cw, ch);
    this.ctx.drawImage(img, dx, dy, dw, dh);
    this.lastDrawnIndex = index;
  }

  render() {
    const rect = this.pin.getBoundingClientRect();
    const scrollableDistance = rect.height - window.innerHeight;
    let progress = scrollableDistance > 0 ? -rect.top / scrollableDistance : 0;
    progress = Math.max(0, Math.min(1, progress));

    const frameIndex = Math.round(progress * (this.count - 1));
    if (frameIndex !== this.lastDrawnIndex) {
      this.drawFrame(frameIndex);
    }
    if (this.progressFill) {
      this.progressFill.style.width = progress * 100 + "%";
    }
  }
}

const scrubSequences = Array.from(document.querySelectorAll(".scrub-pin")).map(
  (el) => new ScrubSequence(el)
);

/* ---------------- Single rAF loop driving scroll-linked effects ---------------- */
let ticking = false;
function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    updateScrollProgress();
    updateHeroParallax();
    scrubSequences.forEach((s) => s.render());
    ticking = false;
  });
}
window.addEventListener("scroll", onScroll, { passive: true });
onScroll();

/* ---------------- Stat count-up / scramble ---------------- */
function animateCount(el, finalText, duration = 1100) {
  const matches = [...finalText.matchAll(/\d+(\.\d+)?/g)];
  if (matches.length === 0) {
    el.textContent = finalText;
    return;
  }
  const start = performance.now();
  const easeOutExpo = (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));

  function frame(now) {
    const elapsed = now - start;
    const t = Math.min(elapsed / duration, 1);
    const eased = easeOutExpo(t);
    let result = "";
    let lastIndex = 0;
    for (const m of matches) {
      const target = parseFloat(m[0]);
      const current = Math.round(target * eased);
      result += finalText.slice(lastIndex, m.index) + current;
      lastIndex = m.index + m[0].length;
    }
    result += finalText.slice(lastIndex);
    el.textContent = result;
    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

const scrambleChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
function animateScramble(el, finalText, duration = 900) {
  const start = performance.now();
  function frame(now) {
    const elapsed = now - start;
    const t = Math.min(elapsed / duration, 1);
    const lockedCount = Math.floor(t * finalText.length);
    let result = "";
    for (let i = 0; i < finalText.length; i++) {
      if (i < lockedCount) {
        result += finalText[i];
      } else {
        result += scrambleChars[Math.floor(Math.random() * scrambleChars.length)];
      }
    }
    el.textContent = result;
    if (t < 1) requestAnimationFrame(frame);
    else el.textContent = finalText;
  }
  requestAnimationFrame(frame);
}

const statObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.querySelectorAll("[data-count]").forEach((el) => {
        animateCount(el, el.dataset.count);
      });
      entry.target.querySelectorAll("[data-scramble]").forEach((el) => {
        animateScramble(el, el.dataset.scramble);
      });
      statObserver.unobserve(entry.target);
    }
  },
  { threshold: 0.4 }
);
document.querySelectorAll(".stat-row").forEach((el) => statObserver.observe(el));

/* ---------------- Card tilt-on-hover ---------------- */
if (!reduceMotion) {
  document.querySelectorAll(".card").forEach((card) => {
    card.addEventListener("mousemove", (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const rotateX = ((y / rect.height) - 0.5) * -10;
      const rotateY = ((x / rect.width) - 0.5) * 10;
      card.style.transform = `perspective(900px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(1.02)`;
    });
    card.addEventListener("mouseleave", () => {
      card.style.transform = "perspective(900px) rotateX(0) rotateY(0) scale(1)";
    });
  });
}
