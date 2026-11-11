import type { ServerProviderUsageWindow } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { clampPercent } from "@t3tools/provider-core/server/usageLimits";
import { LATEST_DATE_MS, type MuseSubscriptionUsage } from "./protocol.ts";

/** Credential proxies may omit error.quota from 429 refusals; inspect text too. */
export function isMuseUsageLimitFailure(message: string | undefined): boolean {
  return message !== undefined && /\b429\b/.test(message) && /quota|usage limit/i.test(message);
}

const NAMED_RESET =
  /\bresets at (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))/i;

/** Resume only after all exhausted windows reset; use the latest future reset from quota, refusal, or usage. */
export function museUsageLimitResetAt(
  usage: MuseSubscriptionUsage | undefined,
  nowMs: number,
  refusal?: {
    readonly quota?: { readonly resetsAtMs: number } | undefined;
    readonly message?: string | undefined;
  },
): string | null {
  const named = refusal?.message?.match(NAMED_RESET)?.[1];
  const resets = [
    ...[usage?.window, usage?.weekly].map((window) =>
      window && window.usedPercent >= 100 ? window.resetsAtMs : undefined,
    ),
    refusal?.quota?.resetsAtMs,
    named === undefined ? undefined : Date.parse(named),
  ].filter(
    (ms): ms is number =>
      ms !== undefined && Number.isFinite(ms) && ms > nowMs && ms <= LATEST_DATE_MS,
  );
  return resets.length > 0 ? DateTime.formatIso(DateTime.makeUnsafe(Math.max(...resets))) : null;
}

const usageWindow = (
  id: string,
  kind: ServerProviderUsageWindow["kind"],
  label: string,
  usedPercent: number,
  resetsAtMs: number,
  windowDurationMins?: number,
): ServerProviderUsageWindow => ({
  id,
  kind,
  label,
  // Muse percentages may exceed 100; the contract caps displayed bars at 100.
  usedPercent: clampPercent(usedPercent),
  ...(Number.isFinite(resetsAtMs) && resetsAtMs > 0 && resetsAtMs <= LATEST_DATE_MS
    ? { resetsAt: DateTime.formatIso(DateTime.makeUnsafe(resetsAtMs)) }
    : {}),
  ...(windowDurationMins !== undefined &&
  Number.isFinite(windowDurationMins) &&
  windowDurationMins > 0
    ? { windowDurationMins: Math.trunc(windowDurationMins) }
    : {}),
});

/** Maps both the `muse usage --json` allowance and the MSP `usage/changed` payload. */
export function museUsageWindows(usage: {
  readonly window: {
    readonly usedPercent: number;
    readonly resetsAtMs: number;
    readonly windowDurationMins?: number;
  };
  readonly weekly: { readonly usedPercent: number; readonly resetsAtMs: number };
}): ReadonlyArray<ServerProviderUsageWindow> {
  return [
    usageWindow(
      "session",
      "session",
      "Session",
      usage.window.usedPercent,
      usage.window.resetsAtMs,
      usage.window.windowDurationMins,
    ),
    usageWindow("weekly", "weekly", "Weekly", usage.weekly.usedPercent, usage.weekly.resetsAtMs),
  ];
}
