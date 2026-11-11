import type { ScopedThreadRef } from "@t3tools/contracts";

import { isChatSplitActive } from "../chatLayout";
import { selectThreadRightPanelState, useRightPanelStore } from "../rightPanelStore";
import { useTerminalUiStateStore } from "../terminalUiStateStore";
import { focusTerminalOnNavigation } from "./terminalFocus";
import { useChatLayoutStore } from "../chatLayoutStore";

export function revealThreadTerminal(threadRef: ScopedThreadRef, terminalId: string) {
  const panels = useRightPanelStore.getState();
  const layout = useChatLayoutStore.getState().layout;
  const pane = layout.panes.find(
    (entry) =>
      entry.target.kind === "server" &&
      entry.target.threadRef.environmentId === threadRef.environmentId &&
      entry.target.threadRef.threadId === threadRef.threadId,
  );
  if (
    isChatSplitActive(
      layout.mode,
      typeof window === "undefined" ? Number.POSITIVE_INFINITY : window.innerWidth,
    )
  ) {
    panels.openTerminal(threadRef, terminalId);
    useTerminalUiStateStore.getState().closeTerminal(threadRef, terminalId);
    if (pane) useChatLayoutStore.getState().dispatch({ type: "focus", paneId: pane.id });
    useChatLayoutStore.getState().dispatch({ type: "set-panel-open", open: true });
    focusTerminalOnNavigation(threadRef, terminalId);
    return;
  }
  const surface = selectThreadRightPanelState(panels.byThreadKey, threadRef).surfaces.find(
    (surface) => surface.kind === "terminal" && surface.terminalIds.includes(terminalId),
  );
  if (surface) {
    panels.activateTerminal(threadRef, surface.id, terminalId);
    panels.activateSurface(threadRef, surface.id);
    focusTerminalOnNavigation(threadRef, terminalId);
    return;
  }
  useTerminalUiStateStore.getState().ensureTerminal(threadRef, terminalId, {
    open: true,
    active: true,
  });
  focusTerminalOnNavigation(threadRef, terminalId);
}
