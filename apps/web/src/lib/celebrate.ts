import confetti from "canvas-confetti";

/** Short dual-side blast when a crew run ships a live URL. */
export function celebrateShip() {
  const prefersReduced =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (prefersReduced) return;

  const colors = ["#22c55e", "#38bdf8", "#fbbf24", "#f472b6", "#a78bfa"];
  const base = { colors, disableForReducedMotion: true, zIndex: 80 };

  confetti({
    ...base,
    particleCount: 70,
    spread: 62,
    startVelocity: 38,
    origin: { x: 0.15, y: 0.7 },
  });
  confetti({
    ...base,
    particleCount: 70,
    spread: 62,
    startVelocity: 38,
    origin: { x: 0.85, y: 0.7 },
  });
  window.setTimeout(() => {
    confetti({
      ...base,
      particleCount: 90,
      spread: 88,
      startVelocity: 32,
      origin: { x: 0.5, y: 0.55 },
    });
  }, 220);
}
