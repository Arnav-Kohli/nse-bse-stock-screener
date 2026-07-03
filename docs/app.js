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

/* ---------------- Floating-object parallax (scroll + mouse) ----------------
   Each .float-figure[data-parallax] drifts vertically as it passes through
   the viewport (scroll depth) and leans slightly toward the cursor (mouse
   depth). The looping float/spin motion is pure CSS on the inner
   .float-object, so this outer transform never fights it. */
const floatFigures = Array.from(document.querySelectorAll(".float-figure[data-parallax]")).map(
  (el) => ({ el, factor: parseFloat(el.dataset.parallax) || 0 })
);
let normMouseX = 0;
let normMouseY = 0;

function applyFigureTransforms() {
  if (reduceMotion) return;
  const vh = window.innerHeight;
  for (const { el, factor } of floatFigures) {
    const rect = el.getBoundingClientRect();
    const centerFromViewportCenter = rect.top + rect.height / 2 - vh / 2;
    const scrollOffset = -centerFromViewportCenter * factor;
    const mx = normMouseX * factor * 220;
    const my = normMouseY * factor * 140;
    el.style.transform = `translate3d(${mx.toFixed(1)}px, ${(scrollOffset + my).toFixed(1)}px, 0)`;
  }
}

/* ---------------- Single rAF loop driving scroll-linked effects ---------------- */
let ticking = false;
function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    updateScrollProgress();
    updateHeroParallax();
    applyFigureTransforms();
    ticking = false;
  });
}
window.addEventListener("scroll", onScroll, { passive: true });
window.addEventListener("resize", onScroll, { passive: true });
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

/* ---------------- Cursor-follow spotlight + hero orbit tilt ---------------- */
const cursorSpotlight = document.getElementById("cursorSpotlight");
const orbitVisual = document.getElementById("orbitVisual");

if (!reduceMotion && cursorSpotlight) {
  let mouseTicking = false;
  let lastX = window.innerWidth / 2;
  let lastY = window.innerHeight / 2;

  function applyMouseEffects() {
    cursorSpotlight.style.transform = `translate(${lastX}px, ${lastY}px)`;

    normMouseX = (lastX / window.innerWidth) * 2 - 1;
    normMouseY = (lastY / window.innerHeight) * 2 - 1;
    applyFigureTransforms();

    if (orbitVisual) {
      const heroRect = hero.getBoundingClientRect();
      if (heroRect.bottom > 0 && heroRect.top < window.innerHeight) {
        const cx = heroRect.left + heroRect.width / 2;
        const cy = heroRect.top + heroRect.height / 2;
        const dx = (lastX - cx) / (heroRect.width / 2);
        const dy = (lastY - cy) / (heroRect.height / 2);
        const rotateY = Math.max(-1, Math.min(1, dx)) * 18;
        const rotateX = Math.max(-1, Math.min(1, dy)) * -14;
        orbitVisual.style.transform = `translate(-50%, -50%) rotateY(${rotateY}deg) rotateX(${rotateX}deg)`;
      }
    }
    mouseTicking = false;
  }

  window.addEventListener(
    "mousemove",
    (e) => {
      lastX = e.clientX;
      lastY = e.clientY;
      cursorSpotlight.classList.add("is-active");
      if (!mouseTicking) {
        mouseTicking = true;
        requestAnimationFrame(applyMouseEffects);
      }
    },
    { passive: true }
  );

  window.addEventListener("mouseleave", () => {
    cursorSpotlight.classList.remove("is-active");
  });
}

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
