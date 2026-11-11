import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { useNavigate } from "@tanstack/react-router";
import { cn } from "../../../lib/utils";
import { resolveSidebarThreadStatus } from "../../Sidebar.logic";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { openThread } from "./VerticalQueue";

function initials(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "??";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

function statusText(shell: EnvironmentThreadShell): string | null {
  const status = resolveSidebarThreadStatus(shell);
  if (status === "approval" || status === "input" || status === "request") return "needs you";
  if (status === "working") return "working";
  return null;
}

function RailToken({ shell, focused }: { shell: EnvironmentThreadShell; focused: boolean }) {
  const navigate = useNavigate();
  const status = resolveSidebarThreadStatus(shell);
  const needsYou = status === "approval" || status === "input" || status === "request";
  const statusLabel = statusText(shell);
  const trigger = (
    <button
      type="button"
      aria-label={shell.title}
      onClick={() => void openThread(navigate, shell)}
      className={cn(
        "size-10 shrink-0 rounded-full border text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        focused
          ? "border-border bg-accent text-accent-foreground"
          : cn("border-border bg-card text-muted-foreground hover:text-foreground"),
        needsYou && "ring-2 ring-inset ring-warning-foreground",
        status === "working" && "ring-2 ring-inset ring-info-foreground",
      )}
    >
      {initials(shell.title)}
    </button>
  );
  return (
    <Tooltip>
      <TooltipTrigger render={trigger} />
      <TooltipPopup side="right" align="center">
        <span className="block max-w-60 truncate font-medium">{shell.title}</span>
        {statusLabel ? <span className="block text-muted-foreground">{statusLabel}</span> : null}
      </TooltipPopup>
    </Tooltip>
  );
}

export function VerticalRail({
  needsYou,
  working,
  focusedShell,
}: {
  needsYou: ReadonlyArray<EnvironmentThreadShell>;
  working: ReadonlyArray<EnvironmentThreadShell>;
  focusedShell: EnvironmentThreadShell | null;
}) {
  const listed = new Set(
    [...needsYou, ...working].map((shell) =>
      scopedThreadKey(scopeThreadRef(shell.environmentId, shell.id)),
    ),
  );
  const extra =
    focusedShell !== null &&
    !listed.has(scopedThreadKey(scopeThreadRef(focusedShell.environmentId, focusedShell.id)))
      ? [focusedShell]
      : [];
  return (
    <div className="flex w-14 shrink-0 flex-col items-center gap-1.5 overflow-y-auto border-r border-border/60 bg-muted/20 px-1.5 py-2 scrollbar-gutter-both">
      {[...needsYou, ...working, ...extra].map((shell) => {
        const key = scopedThreadKey(scopeThreadRef(shell.environmentId, shell.id));
        const focused =
          focusedShell !== null &&
          scopedThreadKey(scopeThreadRef(focusedShell.environmentId, focusedShell.id)) === key;
        return <RailToken key={key} shell={shell} focused={focused} />;
      })}
    </div>
  );
}
