import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";

export interface ThreadContextSummary {
  usedTokens: number;
  maxTokens: number | null;
  updatedAt: string;
}
// oxlint-disable-next-line t3code/no-em-dash-copy -- This symbol denotes an unknown numeric measurement, not sentence punctuation.
const UNKNOWN_CONTEXT_VALUE = "—";
const compactTokens = (value: number) =>
  value < 1000 ? String(Math.round(value)) : `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
export function formatThreadContext(usage: ThreadContextSummary | null | undefined): string {
  if (!usage || !Number.isFinite(usage.usedTokens) || usage.usedTokens < 0)
    return UNKNOWN_CONTEXT_VALUE;
  const maximum =
    usage.maxTokens !== null && Number.isFinite(usage.maxTokens) && usage.maxTokens > 0
      ? usage.maxTokens
      : null;
  const percentage =
    maximum === null
      ? UNKNOWN_CONTEXT_VALUE
      : String(Math.round(Math.min(100, (usage.usedTokens / maximum) * 100)));
  return `${percentage}% · ${compactTokens(usage.usedTokens)} / ${maximum === null ? UNKNOWN_CONTEXT_VALUE : compactTokens(maximum)}`;
}
export const useThreadContextStore = create<{
  byThreadKey: Record<string, ThreadContextSummary>;
  record: (ref: ScopedThreadRef, usage: ThreadContextSummary | null) => void;
}>()((set) => ({
  byThreadKey: {},
  record: (ref, usage) =>
    set((state) => {
      const key = scopedThreadKey(ref),
        previous = state.byThreadKey[key];
      if (
        usage === null
          ? previous === undefined
          : previous?.usedTokens === usage.usedTokens &&
            previous.maxTokens === usage.maxTokens &&
            previous.updatedAt === usage.updatedAt
      )
        return state;
      const next = { ...state.byThreadKey };
      if (usage) next[key] = usage;
      else delete next[key];
      const keys = Object.keys(next);
      if (keys.length > 512) delete next[keys[0]!];
      return { byThreadKey: next };
    }),
}));
