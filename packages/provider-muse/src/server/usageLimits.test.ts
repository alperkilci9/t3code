import { describe, expect, it } from "@effect/vitest";

import type { MuseSubscriptionUsage } from "./protocol.ts";
import { isMuseUsageLimitFailure, museUsageLimitResetAt, museUsageWindows } from "./usageLimits.ts";

const usage = {
  observedAtMs: 1791447762610,
  tier: "tier-1",
  window: { usedPercent: 0, windowDurationMins: 300, resetsAtMs: 1791465557000 },
  weekly: { usedPercent: 5, resetsAtMs: 1791763200000 },
} satisfies MuseSubscriptionUsage;
const nowMs = usage.observedAtMs;
const realRefusal =
  "API error 429: All credentials for model muse-wonder-1.0-contributor are cooling down (last error: rate_limit_exceeded: Subscription quota exhausted. Your usage window resets at 2026-10-13T10:45:52Z.) (after 10 provider attempts)";

describe("Muse usage limit failures", () => {
  it("recognizes Meta's quota refusal and no other failure", () => {
    expect(
      isMuseUsageLimitFailure(
        "API error 429: Subscription quota exhausted. Your usage window resets soon. (rate_limit_error)",
      ),
    ).toBe(true);
    expect(isMuseUsageLimitFailure(realRefusal)).toBe(true);
    expect(isMuseUsageLimitFailure("API error 429: Rate limit exceeded. (rate_limit_error)")).toBe(
      false,
    );
    expect(isMuseUsageLimitFailure("Subscription quota exhausted.")).toBe(false);
    expect(isMuseUsageLimitFailure(undefined)).toBe(false);
  });

  it("resumes once every exhausted window has reset", () => {
    const sessionOut = { ...usage, window: { ...usage.window, usedPercent: 103 } };
    expect(museUsageLimitResetAt(sessionOut, nowMs)).toBe("2026-10-08T13:19:17.000Z");
    const bothOut = { ...sessionOut, weekly: { ...usage.weekly, usedPercent: 100 } };
    expect(museUsageLimitResetAt(bothOut, nowMs)).toBe("2026-10-12T00:00:00.000Z");
  });

  it("takes the reset a refusal names or types when no report has one", () => {
    expect(museUsageLimitResetAt(undefined, nowMs, { message: realRefusal })).toBe(
      "2026-10-13T10:45:52.000Z",
    );
    const quota = { resetsAtMs: usage.window.resetsAtMs };
    expect(museUsageLimitResetAt(usage, nowMs, { quota })).toBe("2026-10-08T13:19:17.000Z");
    const weeklyOut = { ...usage, weekly: { ...usage.weekly, usedPercent: 100 } };
    expect(museUsageLimitResetAt(weeklyOut, nowMs, { quota })).toBe("2026-10-12T00:00:00.000Z");
  });

  it("has no reset time unless a report shows a used-up window that resets later", () => {
    expect(museUsageLimitResetAt(undefined, nowMs)).toBeNull();
    expect(museUsageLimitResetAt(usage, nowMs)).toBeNull();
    const sessionOut = { ...usage, window: { ...usage.window, usedPercent: 100 } };
    expect(museUsageLimitResetAt(sessionOut, usage.window.resetsAtMs)).toBeNull();
    const afterNamedReset = Date.parse("2026-10-14T00:00:00Z");
    expect(museUsageLimitResetAt(undefined, afterNamedReset, { message: realRefusal })).toBeNull();
  });
});

describe("museUsageWindows", () => {
  it("maps the session and weekly windows with ISO resets", () => {
    expect(museUsageWindows(usage)).toEqual([
      {
        id: "session",
        kind: "session",
        label: "Session",
        usedPercent: 0,
        resetsAt: "2026-10-08T13:19:17.000Z",
        windowDurationMins: 300,
      },
      {
        id: "weekly",
        kind: "weekly",
        label: "Weekly",
        usedPercent: 5,
        resetsAt: "2026-10-12T00:00:00.000Z",
      },
    ]);
  });

  it("clamps over-100 percents and drops unusable resets and durations", () => {
    const windows = museUsageWindows({
      window: { usedPercent: 140, resetsAtMs: 1e16, windowDurationMins: Number.NaN },
      weekly: { usedPercent: -3, resetsAtMs: 0 },
    });
    expect(windows[0]).toMatchObject({ usedPercent: 100 });
    expect(windows[0]).not.toHaveProperty("resetsAt");
    expect(windows[0]).not.toHaveProperty("windowDurationMins");
    expect(windows[1]).toMatchObject({ usedPercent: 0 });
    expect(windows[1]).not.toHaveProperty("resetsAt");
  });
});
