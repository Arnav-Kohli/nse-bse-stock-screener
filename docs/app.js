// Reveal-on-scroll for any .reveal element
const revealObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        revealObserver.unobserve(entry.target);
      }
    }
  },
  { threshold: 0.15 }
);

document.querySelectorAll(".reveal").forEach((el) => revealObserver.observe(el));

// Autoplay section video only while it's actually on screen (saves battery/bandwidth,
// and mirrors the "video wakes up as you scroll to it" feel of product pages).
const sectionVideos = document.querySelectorAll(".section-video");

const videoObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      const video = entry.target;
      if (entry.isIntersecting) {
        video.play().catch(() => {
          /* autoplay can be blocked before user interaction; ignore */
        });
      } else {
        video.pause();
      }
    }
  },
  { threshold: 0.4 }
);

sectionVideos.forEach((video) => videoObserver.observe(video));
