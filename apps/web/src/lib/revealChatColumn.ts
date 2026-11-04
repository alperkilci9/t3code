import type { PaneId } from "../chatLayout";

export function revealChatColumn(paneId: PaneId, root: ParentNode = document) {
  const column = [...root.querySelectorAll<HTMLElement>("[data-pane-viewport]")].find(
    (element) => element.dataset.paneViewport === paneId,
  );
  const canvas = column?.closest<HTMLElement>("[data-chat-pane-canvas]");
  if (!canvas || !column) return;
  const bounds = canvas.getBoundingClientRect();
  const rect = column.getBoundingClientRect();
  if (rect.left < bounds.left) canvas.scrollLeft -= bounds.left - rect.left;
  else if (rect.right > bounds.right) canvas.scrollLeft += rect.right - bounds.right;
}
