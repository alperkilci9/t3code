import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useEffect } from "react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ContextWindowSnapshot } from "../../lib/contextWindow";
import { formatThreadContext, useThreadContextStore } from "../../threadContextStore";

export function ThreadContextUsage({ threadRef }: { threadRef: ScopedThreadRef | null }) {
  const usage = useThreadContextStore((state) =>
    threadRef ? state.byThreadKey[scopedThreadKey(threadRef)] : undefined,
  );
  const title = usage
    ? `Latest reported context: ${usage.usedTokens.toLocaleString("en-US")} / ${usage.maxTokens?.toLocaleString("en-US") ?? "unknown"} tokens. Reported ${usage.updatedAt}.`
    : "Context usage has not been reported for this thread.";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className="block shrink-0 whitespace-nowrap text-3xs text-muted-foreground tabular-nums"
            aria-label={`Context ${formatThreadContext(usage)}`}
          >
            Context {formatThreadContext(usage)}
          </span>
        }
      />
      <TooltipPopup side="bottom">{title}</TooltipPopup>
    </Tooltip>
  );
}
export function ThreadContextUsagePublisher({
  threadRef,
  usage,
  enabled,
}: {
  threadRef: ScopedThreadRef;
  usage: ContextWindowSnapshot | null;
  enabled: boolean;
}) {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- publishes provider context telemetry to lightweight sidebar summaries without subscribing every sidebar row to full thread history
  useEffect(() => {
    if (enabled)
      useThreadContextStore.getState().record(
        threadRef,
        usage
          ? {
              usedTokens: usage.usedTokens,
              maxTokens: usage.maxTokens ?? null,
              updatedAt: usage.updatedAt,
            }
          : null,
      );
  }, [threadRef, usage, enabled]);
  return null;
}
