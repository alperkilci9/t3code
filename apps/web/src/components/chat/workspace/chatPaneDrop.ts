import type { ChatLayout, ChatPanePlacement, ChatViewMode, PaneId } from "../../../chatLayout";
export type ChatPaneDrop = ChatPanePlacement | { kind: "replace"; paneId: PaneId };
export type DropPoint = { x: number; y: number };
export type DropRect = { left: number; top: number; right: number; bottom: number };
export type ChatPaneDropGeometry = {
  mode: ChatViewMode;
  append: DropRect | null;
  panes: { paneId: PaneId; rect: DropRect }[];
  insertBefore: { paneId: PaneId; rect: DropRect }[];
};
const contains = (point: DropPoint, rect: DropRect) =>
  point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
export function resolveChatPaneDrop(
  point: DropPoint,
  geometry: ChatPaneDropGeometry,
): ChatPaneDrop | null {
  if (geometry.append && contains(point, geometry.append)) return { kind: "append" };
  const gap = geometry.insertBefore.find((item) => contains(point, item.rect));
  if (gap) return { kind: "before-column", paneId: gap.paneId };
  const pane = geometry.panes.find((item) => contains(point, item.rect));
  if (!pane) return null;
  if (geometry.mode === "grid") {
    const edges = [
      { edge: "left" as const, distance: point.x - pane.rect.left },
      { edge: "right" as const, distance: pane.rect.right - point.x },
      { edge: "top" as const, distance: point.y - pane.rect.top },
      { edge: "bottom" as const, distance: pane.rect.bottom - point.y },
    ];
    edges.sort((a, b) => a.distance - b.distance);
    if (edges[0]!.distance < 24) return { kind: "edge", paneId: pane.paneId, edge: edges[0]!.edge };
  }
  return { kind: "replace", paneId: pane.paneId };
}
export function canApplyChatPaneDrop(layout: ChatLayout, drop: ChatPaneDrop): boolean {
  if (drop.kind === "replace") return layout.panes.some((p) => p.id === drop.paneId);
  return layout.mode !== "grid" || layout.panes.length < 4;
}
