import { createContext } from "react";
import type { PaneId } from "../../../chatLayout";
import { useChatLayoutStore } from "../../../chatLayoutStore";

export interface ChatPanePresentation {
  paneId: PaneId;
  visible: boolean;
  panelHost: HTMLElement | null;
  controlsHost: HTMLElement | null;
  workspaceElement: HTMLElement | null;
  requestPanel: (open: boolean) => void;
}
export const ChatPaneContext = createContext<ChatPanePresentation | null>(null);

export function isChatPaneEventOwner(
  paneId: PaneId | null | undefined,
  target: EventTarget | null,
): boolean {
  if (paneId == null) return true;
  const pane = target instanceof Element ? target.closest<HTMLElement>("[data-chat-pane]") : null;
  if (pane && pane.dataset.chatPane !== paneId) return false;
  return useChatLayoutStore.getState().layout.focusedPaneId === paneId;
}
