import { describe, expect, it } from "vite-plus/test";

import { createThrottle, parseGhostLook } from "./ghostLook";

function typeAt(throttle: ReturnType<typeof createThrottle>, cps: number, ms: number, from = 0) {
  const step = 1000 / cps;
  let now = from;
  for (; now <= from + ms; now += step) {
    throttle.hit(now);
    throttle.sample(now);
  }
  return now;
}

describe("Ghost look throttle", () => {
  it("stays shut below the floor speed", () => {
    const throttle = createThrottle();
    const end = typeAt(throttle, 0.8, 4000);
    expect(throttle.sample(end).level).toBe(0);
  });

  it("opens fully on a quick burst of typing", () => {
    const throttle = createThrottle();
    const end = typeAt(throttle, 12, 1500);
    expect(throttle.sample(end).level).toBeGreaterThan(0.9);
  });

  it("falls back to exactly zero after the keys stop, so the loop can stop", () => {
    const throttle = createThrottle();
    const end = typeAt(throttle, 12, 1500);
    let level = 1;
    for (let now = end; now < end + 4000; now += 16) level = throttle.sample(now).level;
    expect(level).toBe(0);
  });
});

describe("Ghost look preference", () => {
  it("reads only the exact stored value as Ghost", () => {
    expect(parseGhostLook("ghost")).toBe("ghost");
    expect(parseGhostLook(null)).toBe("standard");
    expect(parseGhostLook("Ghost")).toBe("standard");
  });
});
