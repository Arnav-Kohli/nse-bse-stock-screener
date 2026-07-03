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
const floatFigures = Array.from(document.querySelectorAll("[data-parallax]")).map(
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

/* ---------------- Live 3D globe (canvas, no image, no dependency) ----------------
   A real rotating sphere of glowing data points, drawn every frame at the
   device's true resolution. It never pixelates when scaled, rotates as a
   genuine 3D object (not a spinning flat image), keeps animating on its own
   regardless of scroll, and leans toward the cursor. */
class Globe3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.points = this.buildFibonacciSphere(760);
    this.bars = this.buildBars(46);
    this.angleY = 0;
    this.angleX = -0.35;
    this.tiltX = 0;
    this.tiltY = 0;
    this.running = true;

    this.resize = this.resize.bind(this);
    this.frame = this.frame.bind(this);
    window.addEventListener("resize", this.resize);
    this.resize();
    requestAnimationFrame(this.frame);

    // Pause when off-screen to save battery.
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => { this.running = e.isIntersecting; }),
      { threshold: 0 }
    );
    io.observe(canvas);
  }

  buildFibonacciSphere(n) {
    const pts = [];
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const y = 1 - (i / (n - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const theta = golden * i;
      pts.push({ x: Math.cos(theta) * r, y, z: Math.sin(theta) * r });
    }
    return pts;
  }

  // A few points that get a brighter "data node" treatment.
  buildBars(n) {
    const bars = [];
    for (let i = 0; i < n; i++) {
      const u = Math.random();
      const v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      bars.push({
        x: Math.sin(phi) * Math.cos(theta),
        y: Math.cos(phi),
        z: Math.sin(phi) * Math.sin(theta),
        h: 0.12 + Math.random() * 0.22,
      });
    }
    return bars;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.round(rect.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * this.dpr));
    this.cx = this.canvas.width / 2;
    this.cy = this.canvas.height / 2;
    this.radius = Math.min(this.canvas.width, this.canvas.height) * 0.4;
  }

  rotate(p, ay, ax) {
    // rotate around Y
    let x = p.x * Math.cos(ay) - p.z * Math.sin(ay);
    let z = p.x * Math.sin(ay) + p.z * Math.cos(ay);
    let y = p.y;
    // rotate around X
    const y2 = y * Math.cos(ax) - z * Math.sin(ax);
    const z2 = y * Math.sin(ax) + z * Math.cos(ax);
    return { x, y: y2, z: z2 };
  }

  frame() {
    if (!this.running) {
      requestAnimationFrame(this.frame);
      return;
    }
    const speed = reduceMotion ? 0.0015 : 0.004;
    this.angleY += speed;

    // ease tilt toward mouse
    const targetTiltY = normMouseX * 0.5;
    const targetTiltX = -0.35 + normMouseY * 0.3;
    this.tiltY += (targetTiltY - this.tiltY) * 0.05;
    this.tiltX += (targetTiltX - this.tiltX) * 0.05;

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const fov = 2.6;
    const project = (r) => {
      const scale = fov / (fov + r.z);
      return {
        px: this.cx + r.x * this.radius * scale + this.tiltY * this.radius * 0.15,
        py: this.cy + r.y * this.radius * scale,
        scale,
        depth: (r.z + 1) / 2,
      };
    };

    // points
    for (const p of this.points) {
      const r = this.rotate(p, this.angleY, this.tiltX);
      const pr = project(r);
      const alpha = 0.15 + pr.depth * 0.75;
      const size = (0.6 + pr.depth * 1.6) * this.dpr;
      ctx.beginPath();
      ctx.fillStyle = `rgba(120, 220, 255, ${alpha.toFixed(3)})`;
      ctx.arc(pr.px, pr.py, size, 0, Math.PI * 2);
      ctx.fill();
    }

    // brighter data nodes with a short radial "bar" glow
    for (const b of this.bars) {
      const r = this.rotate(b, this.angleY, this.tiltX);
      const pr = project(r);
      if (r.z < -0.1) continue; // only front-facing
      const alpha = 0.3 + pr.depth * 0.7;
      const size = (1.6 + pr.depth * 2.2) * this.dpr;
      const grad = ctx.createRadialGradient(pr.px, pr.py, 0, pr.px, pr.py, size * 3);
      grad.addColorStop(0, `rgba(180, 240, 255, ${alpha.toFixed(3)})`);
      grad.addColorStop(1, "rgba(79, 209, 255, 0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(pr.px, pr.py, size * 3, 0, Math.PI * 2);
      ctx.fill();
    }

    requestAnimationFrame(this.frame);
  }
}

const globeCanvas = document.getElementById("globeCanvas");
if (globeCanvas) new Globe3D(globeCanvas);

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
