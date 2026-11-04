import { useStableCallback } from "../../../hooks/useStableCallback";
import { ThreadContextUsage } from "../ThreadContextUsage";
import { useThreadCompletionStore } from "../../../threadCompletionStore";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { XIcon } from "lucide-react";
import type { ChatPane as Pane, PaneId } from "../../../chatLayout";
import { targetKey } from "../../../chatLayout";
import { useChatLayoutStore } from "../../../chatLayoutStore";
import { ComposerHandleContext, type ComposerHandleRef } from "../../../composerHandleContext";
import { useQuietThreadShell } from "../../../state/entities";
import type { ThreadRouteTarget } from "../../../threadRoutes";
import { resolveSidebarThreadStatus } from "../../Sidebar.logic";
import { ThreadRouteView } from "../../ThreadRouteView";
import { Button } from "../../ui/button";
import { ChatPaneContext, type ChatPanePresentation } from "./ChatPaneContext";

export function ChatPane({
  pane,
  background,
  presentation,
  composerRef,
  onFocus,
  onClose,
}: {
  pane: Pane;
  background: boolean;
  presentation: ChatPanePresentation;
  composerRef: ComposerHandleRef;
  onFocus: (id: PaneId) => void;
  onClose: (id: PaneId) => void;
}) {
  const focused = useChatLayoutStore((state) => state.layout.focusedPaneId === pane.id);
  const shell = useQuietThreadShell(pane.target.kind === "server" ? pane.target.threadRef : null);
  const title = shell?.title ?? (pane.target.kind === "draft" ? "New chat" : "Loading chat");
  const status = shell ? resolveSidebarThreadStatus(shell) : null;
  const label =
    status === "approval" || status === "input"
      ? "needs you"
      : status === "working"
        ? "working"
        : status === "ready" && shell?.latestRun
          ? "done"
          : status === "failed"
            ? "failed"
            : null;
  const onRedirect = useStableCallback((target: ThreadRouteTarget | null) => {
    if (target === null) {
      onClose(pane.id);
      return;
    }
    const layout = useChatLayoutStore.getState().layout;
    const current = layout.panes.find((p) => p.id === pane.id);
    if (!current || targetKey(current.target) === targetKey(target)) return;
    useChatLayoutStore
      .getState()
      .dispatch({ type: "replace", paneId: pane.id, target, focus: false });
    const focused = useChatLayoutStore.getState().layout.focusedPaneId;
    if (layout.focusedPaneId === pane.id && focused) onFocus(focused);
  });
  return (
    <section
      role="region"
      aria-label={`Chat pane ${title}`}
      data-chat-pane={pane.id}
      data-chat-pane-focused={focused ? "true" : "false"}
      inert={background}
      data-workspace-area={`pane:${pane.id}`}
      data-workspace-order={1}
      tabIndex={-1}
      onPointerDownCapture={() => {
        if (pane.target.kind === "server")
          useThreadCompletionStore.getState().acknowledge(scopedThreadKey(pane.target.threadRef));
        onFocus(pane.id);
      }}
      onFocusCapture={() => {
        if (pane.target.kind === "server")
          useThreadCompletionStore.getState().acknowledge(scopedThreadKey(pane.target.threadRef));
        onFocus(pane.id);
      }}
      className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-md border-2 border-border data-[chat-pane-focused=true]:border-info/70"
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-2 text-xs">
        <span tabIndex={-1} data-workspace-focus-default className="min-w-0 flex-1 truncate">
          {title}
        </span>
        <ThreadContextUsage
          threadRef={pane.target.kind === "server" ? pane.target.threadRef : null}
        />
        <span className="shrink-0 text-muted-foreground">{label}</span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Close chat ${title}`}
          onClick={(event) => {
            event.stopPropagation();
            onClose(pane.id);
          }}
        >
          <XIcon />
        </Button>
      </div>
      <ComposerHandleContext value={composerRef}>
        <ChatPaneContext value={presentation}>
          {presentation.visible || focused ? (
            <ThreadRouteView
              target={pane.target}
              background={background}
              paneHost={{ onRedirect }}
            />
          ) : null}
        </ChatPaneContext>
      </ComposerHandleContext>
    </section>
  );
}
