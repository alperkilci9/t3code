import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { formatWorkingDurationLabel } from "@t3tools/client-runtime/state/models";
import {
  fullAccessOverrideExplanation,
  type ThreadPendingApproval,
} from "@t3tools/client-runtime/state/thread-requests";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { AuthOrchestrationOperateScope } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useChatLayoutStore } from "../../../chatLayoutStore";
import { useNowMinute } from "../../../hooks/useNowMinute";
import { useNowSecond } from "../../../hooks/useNowSecond";
import { cn } from "../../../lib/utils";
import { formatRelativeTimeLabel } from "../../../timestampFormat";
import { useQuietThreadProjection } from "../../../state/entities";
import { useEnvironmentScope } from "../../../state/session";
import { environmentThreadDetails, threadEnvironment } from "../../../state/threads";
import { useAtomCommand } from "../../../state/use-atom-command";
import { buildThreadRouteParams } from "../../../threadRoutes";
import {
  resolveSidebarThreadStatus,
  resolveThreadStatusPill,
  resolveWorkingStartedAt,
} from "../../Sidebar.logic";
import { Button } from "../../ui/button";
import { ComposerPendingApprovalActions } from "../ComposerPendingApprovalActions";

export function openThread(
  navigate: ReturnType<typeof useNavigate>,
  shell: EnvironmentThreadShell,
) {
  return navigate({
    to: "/$environmentId/$threadId",
    params: buildThreadRouteParams(scopeThreadRef(shell.environmentId, shell.id)),
    replace: true,
  });
}

function byUpdatedDesc(a: EnvironmentThreadShell, b: EnvironmentThreadShell): number {
  return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
}

export function partitionVerticalShells(shells: ReadonlyArray<EnvironmentThreadShell>): {
  needsYou: EnvironmentThreadShell[];
  working: EnvironmentThreadShell[];
} {
  const needsYou: EnvironmentThreadShell[] = [];
  const working: EnvironmentThreadShell[] = [];
  for (const shell of shells) {
    const status = resolveSidebarThreadStatus(shell);
    if (status === "approval" || status === "input" || status === "request") needsYou.push(shell);
    else if (status === "working") working.push(shell);
  }
  needsYou.sort(byUpdatedDesc);
  working.sort(byUpdatedDesc);
  return { needsYou, working };
}

function compactSidebarTimeLabel(label: string): string {
  if (label === "just now") return "now";
  return label.endsWith(" ago") ? label.slice(0, -4) : label;
}

function RelativeAge({ timestamp }: { timestamp: string }) {
  const nowMinute = useNowMinute();
  return (
    <span className="shrink-0 tabular-nums text-muted-foreground">
      {compactSidebarTimeLabel(
        formatRelativeTimeLabel(timestamp, Date.parse(`${nowMinute}:00.000Z`)),
      )}
    </span>
  );
}

function WorkingDuration({ startedAt }: { startedAt: string | null }) {
  const startedMs = startedAt !== null ? Date.parse(startedAt) : Number.NaN;
  const nowMs = useNowSecond();
  if (Number.isNaN(startedMs)) return null;
  return <span className="tabular-nums">{formatWorkingDurationLabel(nowMs - startedMs)}</span>;
}

function ApprovalActions({
  shell,
  approval,
}: {
  shell: EnvironmentThreadShell;
  approval: ThreadPendingApproval;
}) {
  const canRespond = useEnvironmentScope(shell.environmentId, AuthOrchestrationOperateScope);
  const respond = useAtomCommand(threadEnvironment.respondToApproval, { reportFailure: false });
  const [responding, setResponding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <div className="mt-2 flex flex-wrap gap-2">
        <ComposerPendingApprovalActions
          presentation="inline"
          requestId={approval.requestId}
          isResponding={responding}
          canRespond={approval.responseCapability === "live"}
          disabled={!canRespond}
          options={approval.options}
          onRespondToApproval={async (requestId, decision) => {
            if (!canRespond || responding) return;
            setResponding(true);
            setError(null);
            const result = await respond({
              environmentId: shell.environmentId,
              input: { threadId: shell.id, requestId, decision },
            });
            if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
              const failure = squashAtomCommandFailure(result);
              setError(
                failure instanceof Error ? failure.message : "Failed to submit approval decision.",
              );
            }
            setResponding(false);
            return result;
          }}
        />
      </div>
      {error !== null ? (
        <p role="alert" className="mt-2 text-destructive">
          {error}
        </p>
      ) : null}
    </>
  );
}

function NeedsCard({ shell, compact }: { shell: EnvironmentThreadShell; compact: boolean }) {
  const navigate = useNavigate();
  const verticalView = useChatLayoutStore((state) => state.layout.verticalView);
  const status = resolveSidebarThreadStatus(shell);
  const pill = resolveThreadStatusPill({ thread: shell });
  const threadRef = { environmentId: shell.environmentId, threadId: shell.id };
  const pending = useAtomValue(environmentThreadDetails.pendingRequestsAtom(threadRef));
  const guestProjection = useQuietThreadProjection(status === "request" ? threadRef : null);
  const pendingGuestText =
    guestProjection?.projection.thread.guestShare?.messages.find(
      (message) => message.status === "pending",
    )?.text ?? null;
  const open = () => {
    if (verticalView === "queue") {
      useChatLayoutStore.getState().dispatch({ type: "set-vertical-view", view: "split" });
    }
    void openThread(navigate, shell);
  };
  const approvals = pending?.approvals ?? [];
  const firstQuestion = pending?.userInputs[0]?.questions[0]?.question ?? null;
  return (
    <article className="rounded-lg border border-border/60 bg-card p-3 text-xs">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium">{shell.title}</span>
        {pill ? (
          <span className={cn("inline-flex shrink-0 items-center gap-1", pill.colorClass)}>
            <span className={cn("size-1.5 rounded-full", pill.dotClass)} aria-hidden />
            {pill.label}
          </span>
        ) : (
          <span className="shrink-0 text-muted-foreground">needs you</span>
        )}
        <RelativeAge timestamp={shell.latestUserMessageAt ?? shell.updatedAt} />
        <Button variant="ghost" size="sm" onClick={open}>
          Open
        </Button>
      </div>
      {status === "approval" && approvals.length > 0 ? (
        <div className="mt-2 flex flex-col gap-2">
          {approvals.map((approval) => (
            <div key={approval.requestId}>
              <pre
                className={
                  compact
                    ? "line-clamp-2 overflow-hidden font-mono whitespace-pre-wrap break-words"
                    : "max-h-40 overflow-auto font-mono whitespace-pre-wrap break-words"
                }
              >
                {approval.detail || approval.requestKind}
              </pre>
              {approval.appName ? (
                <p className="mt-1 text-muted-foreground">{approval.appName}</p>
              ) : null}
              {approval.responseCapability !== "live" ? (
                <p className="mt-1 text-warning">
                  Provider process is gone. Interrupt or restart the thread to respond.
                </p>
              ) : null}
              {approval.reason ? (
                <p className="mt-1 text-muted-foreground">{approval.reason}</p>
              ) : null}
              {approval.fullAccessOverride ? (
                <p className="mt-1 text-muted-foreground">
                  {fullAccessOverrideExplanation(approval.fullAccessOverride)}
                </p>
              ) : null}
              <ApprovalActions shell={shell} approval={approval} />
            </div>
          ))}
        </div>
      ) : status === "input" ? (
        <div className="mt-2">
          <p className={compact ? "line-clamp-2" : "line-clamp-3"}>
            {firstQuestion ?? "Waiting on your answer"}
          </p>
          <div className="mt-2">
            <Button variant="default" size="sm" onClick={open}>
              Answer
            </Button>
          </div>
        </div>
      ) : status === "request" ? (
        <div className="mt-2">
          <p className={compact ? "line-clamp-2" : "line-clamp-3"}>
            {pendingGuestText && pendingGuestText.trim()
              ? pendingGuestText
              : "Guest message waiting"}
          </p>
          <div className="mt-2">
            <Button variant="default" size="sm" onClick={open}>
              Answer
            </Button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function WorkingRow({ shell }: { shell: EnvironmentThreadShell }) {
  const navigate = useNavigate();
  const verticalView = useChatLayoutStore((state) => state.layout.verticalView);
  return (
    <button
      type="button"
      onClick={() => {
        if (verticalView === "queue") {
          useChatLayoutStore.getState().dispatch({ type: "set-vertical-view", view: "split" });
        }
        void openThread(navigate, shell);
      }}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <span className="min-w-0 flex-1 truncate">{shell.title}</span>
      <span className="shrink-0 text-muted-foreground">working</span>
      <WorkingDuration startedAt={resolveWorkingStartedAt(shell)} />
    </button>
  );
}

export function VerticalQueue({
  compact,
  needsYou,
  working,
}: {
  compact: boolean;
  needsYou: ReadonlyArray<EnvironmentThreadShell>;
  working: ReadonlyArray<EnvironmentThreadShell>;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-muted/20">
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
        <p className="px-1 pt-1.5 pb-1 text-xs font-medium text-muted-foreground">Needs you</p>
        <div className="flex flex-col gap-1.5">
          {needsYou.map((shell) => (
            <NeedsCard
              key={scopedThreadKey(scopeThreadRef(shell.environmentId, shell.id))}
              shell={shell}
              compact={compact}
            />
          ))}
        </div>
        {needsYou.length === 0 ? (
          <p className="px-1 py-1 text-xs text-muted-foreground">Nothing needs you</p>
        ) : null}
        {working.length > 0 ? (
          <>
            <p className="px-1 pt-1.5 pb-1 text-xs font-medium text-muted-foreground">Working</p>
            {working.map((shell) => (
              <WorkingRow
                key={scopedThreadKey(scopeThreadRef(shell.environmentId, shell.id))}
                shell={shell}
              />
            ))}
          </>
        ) : null}
      </div>
    </div>
  );
}
