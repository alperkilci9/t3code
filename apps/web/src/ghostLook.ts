// Ghost look, ported from the site's assets/js/cs/ghost-turbo.js: typing in a composer drives
// its edge light and halo and the backdrop glow, in the selected theme's colours. The site's
// caret light and sparks are deliberately left out.

export type GhostLook = "standard" | "ghost";

const GHOST_LOOK_STORAGE_KEY = "studyworkspace-lab:look";
const LOOK_ATTRIBUTE = "data-look";
const COMPOSER_SELECTOR = '[data-slot="composer-shell"]';
const BACKDROP_TURBO = "--ghost-turbo";

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export type ThrottleSample = {
  readonly level: number;
  readonly cps: number;
  readonly active: boolean;
};

/**
 * Characters per second, smoothed. Below floorCps the throttle stays shut; at fullCps it is
 * open. It holds while keys keep coming (holdMs between keys) and falls back over releaseMs.
 */
export function createThrottle({
  floorCps = 1,
  fullCps = 6.5,
  holdMs = 650,
  gapMs = 1500,
  attackMs = 90,
  releaseMs = 500,
} = {}) {
  let last = -Infinity;
  let cps = 0;
  let level = 0;
  let at: number | null = null;
  return {
    hit(now: number) {
      const dt = now - last;
      if (!(dt <= gapMs)) cps = 0;
      else {
        const instant = Math.min(30, 1000 / Math.max(dt, 1));
        cps = cps === 0 ? instant * 0.6 : cps * 0.7 + instant * 0.3;
      }
      last = now;
    },
    sample(now: number): ThrottleSample {
      const idleFor = now - last;
      const target = idleFor > holdMs ? 0 : clamp01((cps - floorCps) / (fullCps - floorCps));
      const dt = at === null ? 0 : Math.max(0, now - at);
      at = now;
      level += (target - level) * (1 - Math.exp(-dt / (target > level ? attackMs : releaseMs)));
      // Falling, the last invisible percent is dropped so the animation loop can stop.
      if (level < (target === 0 ? 0.01 : 0.001)) level = 0;
      return { level, cps: idleFor <= gapMs ? cps : 0, active: idleFor <= holdMs };
    },
  };
}

export function parseGhostLook(value: unknown): GhostLook {
  return value === "ghost" ? "ghost" : "standard";
}

export function readGhostLook(): GhostLook {
  try {
    return parseGhostLook(window.localStorage.getItem(GHOST_LOOK_STORAGE_KEY));
  } catch {
    return "standard";
  }
}

const lookListeners = new Set<() => void>();

export function subscribeGhostLook(listener: () => void): () => void {
  lookListeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== GHOST_LOOK_STORAGE_KEY) return;
    applyGhostLookAttribute(readGhostLook());
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    lookListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function applyGhostLookAttribute(look: GhostLook) {
  const root = document.documentElement;
  if (look === "ghost") root.setAttribute(LOOK_ATTRIBUTE, "ghost");
  else root.removeAttribute(LOOK_ATTRIBUTE);
}

export function setGhostLook(look: GhostLook): void {
  try {
    if (look === "ghost") window.localStorage.setItem(GHOST_LOOK_STORAGE_KEY, "ghost");
    else window.localStorage.removeItem(GHOST_LOOK_STORAGE_KEY);
  } catch (error) {
    console.error("Could not store the Ghost look preference.", error);
  }
  applyGhostLookAttribute(look);
  for (const listener of lookListeners) listener();
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** Restarts a one-shot CSS animation class on an element. */
export function flashClass(element: Element | null, className: string, durationMs = 1000) {
  if (!element) return;
  element.classList.remove(className);
  // Reading layout restarts the animation when the class comes back.
  void (element as HTMLElement).offsetWidth;
  element.classList.add(className);
  window.setTimeout(() => element.classList.remove(className), durationMs);
}

/**
 * Drives --turbo from keystrokes in any composer. The composer that was typed in carries its
 * own --turbo (its rev line and halo); the root carries the same value as --ghost-turbo for
 * the backdrop. The
 * loop runs only while the throttle is open or falling, and stops at rest.
 */
export function installGhostTurbo(): () => void {
  const root = document.documentElement;
  const throttle = createThrottle();
  let target: HTMLElement | null = null;
  let frame = 0;

  // The composer's own --turbo; the root's is a separate name so it does not reach every
  // composer through inheritance.
  const write = (element: HTMLElement | null, level: number, name = "--turbo") => {
    if (!element) return;
    if (level === 0) element.style.removeProperty(name);
    else element.style.setProperty(name, level.toFixed(3));
  };

  const tick = () => {
    frame = 0;
    const { level } = throttle.sample(performance.now());
    write(root, level, BACKDROP_TURBO);
    write(target, level);
    target?.toggleAttribute("data-ghost-redline", level > 0.85);
    if (level > 0) frame = window.requestAnimationFrame(tick);
  };

  const onInput = (event: Event) => {
    if (!(event.target instanceof Element)) return;
    const shell = event.target.closest<HTMLElement>(COMPOSER_SELECTOR);
    if (!shell) return;
    if (target !== shell) {
      write(target, 0);
      target?.removeAttribute("data-ghost-redline");
      target = shell;
    }
    // Reduced motion: the look stays, its lights stay still.
    if (prefersReducedMotion()) return;
    throttle.hit(performance.now());
    if (!frame) frame = window.requestAnimationFrame(tick);
  };

  window.addEventListener("beforeinput", onInput, true);
  return () => {
    window.removeEventListener("beforeinput", onInput, true);
    if (frame) window.cancelAnimationFrame(frame);
    write(root, 0, BACKDROP_TURBO);
    write(target, 0);
    target?.removeAttribute("data-ghost-redline");
    target = null;
  };
}
