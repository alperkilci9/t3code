import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { DraftId } from "./composerDraftStore";
import type { ThreadRouteTarget } from "./threadRoutes";

export type ChatViewMode = "single" | "grid" | "columns" | "vertical";
export type VerticalView = "queue" | "split" | "focus";
export type PaneId = string;
export type ChatPane = { id: PaneId; target: ThreadRouteTarget };
export type ChatSplit =
  | { kind: "leaf"; paneId: PaneId }
  | {
      kind: "split";
      id: string;
      axis: "horizontal" | "vertical";
      ratio: number;
      first: ChatSplit;
      second: ChatSplit;
    };
export type ChatLayout = {
  mode: ChatViewMode;
  panes: ChatPane[];
  focusedPaneId: PaneId | null;
  recentPaneIds: PaneId[];
  grid: ChatSplit | null;
  columnWidths: Record<PaneId, number>;
  splitPanelOpen: boolean;
  stackRatio: number;
  verticalView: VerticalView;
};
export type ChatPanePlacement =
  | { kind: "append" }
  | { kind: "edge"; paneId: PaneId; edge: "left" | "right" | "top" | "bottom" }
  | { kind: "before-column"; paneId: PaneId };
export type ChatLayoutAction =
  | { type: "set-mode"; mode: ChatViewMode }
  | { type: "focus"; paneId: PaneId }
  | { type: "open"; pane: ChatPane; placement: ChatPanePlacement }
  | { type: "replace"; paneId: PaneId; target: ThreadRouteTarget; focus?: boolean }
  | { type: "close"; paneId: PaneId }
  | { type: "resize-split"; splitId: string; ratio: number; extent: number }
  | { type: "resize-column"; paneId: PaneId; width: number }
  | { type: "resize-stack"; ratio: number }
  | { type: "set-vertical-view"; view: VerticalView }
  | { type: "set-panel-open"; open: boolean };

export const CHAT_PANE_MIN_WIDTH = 320;
const CHAT_PANE_MIN_HEIGHT = 220;
export const CHAT_PANE_HANDLE_SIZE = 6;
const STACK_RATIO_DEFAULT = 0.3;
const STACK_RATIO_MIN = 0.12;
const STACK_RATIO_MAX = 0.7;
const clampStackRatio = (ratio: number): number =>
  Number.isFinite(ratio)
    ? Math.max(STACK_RATIO_MIN, Math.min(STACK_RATIO_MAX, ratio))
    : STACK_RATIO_DEFAULT;
export const initialChatLayout = (): ChatLayout => ({
  mode: "single",
  panes: [],
  focusedPaneId: null,
  recentPaneIds: [],
  grid: null,
  columnWidths: {},
  splitPanelOpen: false,
  stackRatio: STACK_RATIO_DEFAULT,
  verticalView: "split",
});
// Vertical keeps only the focused pane on screen, so it stays useful on a
// narrower portrait window than the Grid/Columns threshold.
export function isChatSplitActive(mode: ChatViewMode, width: number): boolean {
  return mode === "vertical" ? width > 520 : mode !== "single" && width > 980;
}
export const targetKey = (target: ThreadRouteTarget): string =>
  target.kind === "server"
    ? `server:${scopedThreadKey(target.threadRef)}`
    : `draft:${target.draftId}`;
export const selectGridPaneIds = (layout: ChatLayout): PaneId[] =>
  [...new Set([...layout.recentPaneIds, ...layout.panes.map((p) => p.id)])]
    .filter((id) => layout.panes.some((p) => p.id === id))
    .slice(0, 4);
const leaf = (paneId: PaneId): ChatSplit => ({ kind: "leaf", paneId });
function split(
  first: ChatSplit,
  second: ChatSplit,
  axis: "horizontal" | "vertical",
  id: string,
): ChatSplit {
  return { kind: "split", id, axis, ratio: 0.5, first, second };
}
function defaultGrid(ids: PaneId[]): ChatSplit | null {
  const [a, b, c, d] = ids;
  if (!a) return null;
  if (!b) return leaf(a);
  if (!c) return split(leaf(a), leaf(b), "horizontal", `split:${b}`);
  const bottom = split(leaf(c), leaf(d ?? b), "horizontal", `split:${d ?? c}`);
  return c && d
    ? split(split(leaf(a), leaf(b), "horizontal", `split:${b}`), bottom, "vertical", `split:${a}`)
    : split(leaf(a), split(leaf(b), leaf(c), "horizontal", `split:${c}`), "vertical", `split:${a}`);
}
function prune(tree: ChatSplit | null, ids: Set<string>): ChatSplit | null {
  if (!tree) return null;
  if (tree.kind === "leaf") return ids.has(tree.paneId) ? tree : null;
  const first = prune(tree.first, ids),
    second = prune(tree.second, ids);
  return first && second
    ? first === tree.first && second === tree.second
      ? tree
      : { ...tree, first, second }
    : (first ?? second);
}
const treeIds = (tree: ChatSplit | null): string[] =>
  !tree
    ? []
    : tree.kind === "leaf"
      ? [tree.paneId]
      : [...treeIds(tree.first), ...treeIds(tree.second)];
function reconcile(layout: ChatLayout): ChatLayout {
  const selected = new Set(selectGridPaneIds(layout));
  const previous = new Set(treeIds(layout.grid));
  const incoming = layout.panes.filter((pane) => selected.has(pane.id) && !previous.has(pane.id));
  let nextIncoming = 0;
  const filled = incoming.length
    ? mapSplit(layout.grid, (node) => {
        if (node.kind !== "leaf" || selected.has(node.paneId)) return node;
        const replacement = incoming[nextIncoming++];
        return replacement ? leaf(replacement.id) : node;
      })
    : layout.grid;
  const grid = prune(filled, selected);
  if (treeIds(grid).length === selected.size)
    return grid === layout.grid ? layout : { ...layout, grid };
  return {
    ...layout,
    grid: defaultGrid(layout.panes.filter((p) => selected.has(p.id)).map((p) => p.id)),
  };
}
export function minimumChatSplitSize(tree: ChatSplit): { width: number; height: number } {
  if (tree.kind === "leaf") return { width: CHAT_PANE_MIN_WIDTH, height: CHAT_PANE_MIN_HEIGHT };
  const a = minimumChatSplitSize(tree.first),
    b = minimumChatSplitSize(tree.second);
  return tree.axis === "horizontal"
    ? { width: a.width + b.width + CHAT_PANE_HANDLE_SIZE, height: Math.max(a.height, b.height) }
    : { width: Math.max(a.width, b.width), height: a.height + b.height + CHAT_PANE_HANDLE_SIZE };
}
function mapSplit(
  tree: ChatSplit | null,
  change: (node: ChatSplit) => ChatSplit,
): ChatSplit | null {
  if (!tree) return null;
  if (tree.kind === "leaf") return change(tree);
  return change({
    ...tree,
    first: mapSplit(tree.first, change)!,
    second: mapSplit(tree.second, change)!,
  });
}
export function reduceChatLayout(layout: ChatLayout, action: ChatLayoutAction): ChatLayout {
  switch (action.type) {
    case "set-mode":
      return reconcile({ ...layout, mode: action.mode });
    case "set-panel-open":
      return { ...layout, splitPanelOpen: action.open };
    case "focus":
      return !layout.panes.some((p) => p.id === action.paneId)
        ? layout
        : reconcile({
            ...layout,
            focusedPaneId: action.paneId,
            recentPaneIds: [
              action.paneId,
              ...layout.recentPaneIds.filter((id) => id !== action.paneId),
            ],
          });
    case "replace": {
      const existing = layout.panes.find((p) => targetKey(p.target) === targetKey(action.target));
      if (existing) {
        if (action.focus !== false)
          return reduceChatLayout(layout, { type: "focus", paneId: existing.id });
        if (existing.id === action.paneId) return layout;
        const closed = reduceChatLayout(layout, { type: "close", paneId: action.paneId });
        return layout.focusedPaneId === action.paneId
          ? reduceChatLayout(closed, { type: "focus", paneId: existing.id })
          : closed;
      }
      const replaced = {
        ...layout,
        panes: layout.panes.map((p) =>
          p.id === action.paneId ? { ...p, target: action.target } : p,
        ),
      };
      if (action.focus === false) return replaced;
      return reduceChatLayout(replaced, { type: "focus", paneId: action.paneId });
    }
    case "open": {
      const existing = layout.panes.find(
        (p) => targetKey(p.target) === targetKey(action.pane.target),
      );
      if (existing) return reduceChatLayout(layout, { type: "focus", paneId: existing.id });
      if (
        layout.panes.some((p) => p.id === action.pane.id) ||
        (layout.mode === "grid" && selectGridPaneIds(layout).length === 4)
      )
        return layout;
      const placement = action.placement;
      const position =
        placement.kind === "before-column"
          ? layout.panes.findIndex((p) => p.id === placement.paneId)
          : -1;
      const panes = [...layout.panes];
      panes.splice(position < 0 ? panes.length : position, 0, action.pane);
      let grid = layout.grid;
      if (action.placement.kind === "edge") {
        const placement = action.placement;
        grid = mapSplit(grid, (node) =>
          node.kind === "leaf" && node.paneId === placement.paneId
            ? ["left", "top"].includes(placement.edge)
              ? split(
                  leaf(action.pane.id),
                  node,
                  placement.edge === "left" ? "horizontal" : "vertical",
                  `split:${action.pane.id}`,
                )
              : split(
                  node,
                  leaf(action.pane.id),
                  placement.edge === "right" ? "horizontal" : "vertical",
                  `split:${action.pane.id}`,
                )
            : node,
        );
      } else if (treeIds(grid).length < 4) grid = null;
      return reduceChatLayout(
        { ...layout, panes, grid, columnWidths: { ...layout.columnWidths, [action.pane.id]: 480 } },
        { type: "focus", paneId: action.pane.id },
      );
    }
    case "close": {
      const panes = layout.panes.filter((p) => p.id !== action.paneId),
        recentPaneIds = layout.recentPaneIds.filter((id) => id !== action.paneId);
      const columnWidths = { ...layout.columnWidths };
      delete columnWidths[action.paneId];
      return reconcile({
        ...layout,
        panes,
        recentPaneIds,
        columnWidths,
        focusedPaneId:
          layout.focusedPaneId === action.paneId
            ? (recentPaneIds[0] ?? panes[0]?.id ?? null)
            : layout.focusedPaneId,
      });
    }
    case "resize-column":
      return !Number.isFinite(action.width)
        ? layout
        : {
            ...layout,
            columnWidths: {
              ...layout.columnWidths,
              [action.paneId]: Math.max(CHAT_PANE_MIN_WIDTH, action.width),
            },
          };
    case "resize-stack":
      return !Number.isFinite(action.ratio)
        ? layout
        : { ...layout, stackRatio: clampStackRatio(action.ratio) };
    case "set-vertical-view":
      return layout.verticalView === action.view
        ? layout
        : { ...layout, verticalView: action.view };
    case "resize-split": {
      if (
        !Number.isFinite(action.ratio) ||
        !Number.isFinite(action.extent) ||
        action.extent <= CHAT_PANE_HANDLE_SIZE
      )
        return layout;
      return {
        ...layout,
        grid: mapSplit(layout.grid, (node) => {
          if (node.kind !== "split" || node.id !== action.splitId) return node;
          const dimension = node.axis === "horizontal" ? "width" : "height",
            available = action.extent - CHAT_PANE_HANDLE_SIZE;
          const low = minimumChatSplitSize(node.first)[dimension] / available,
            high = 1 - minimumChatSplitSize(node.second)[dimension] / available;
          return { ...node, ratio: low > high ? 0.5 : Math.max(low, Math.min(high, action.ratio)) };
        }),
      };
    }
  }
}

function record(input: unknown): Record<string, unknown> {
  return input !== null && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}
export function normalizeChatLayout(input: unknown): ChatLayout {
  const data = record(input),
    panes: ChatPane[] = [],
    keys = new Set<string>();
  for (const item of Array.isArray(data.panes) ? data.panes : []) {
    const p = record(item),
      t = record(p.target),
      ref = record(t.threadRef);
    if (typeof p.id !== "string" || !p.id || panes.some((other) => other.id === p.id)) continue;
    const target: ThreadRouteTarget | null =
      t.kind === "server" &&
      typeof ref.environmentId === "string" &&
      ref.environmentId &&
      typeof ref.threadId === "string" &&
      ref.threadId
        ? {
            kind: "server",
            threadRef: scopeThreadRef(
              EnvironmentId.make(ref.environmentId),
              ThreadId.make(ref.threadId),
            ),
          }
        : t.kind === "draft" && typeof t.draftId === "string" && t.draftId
          ? { kind: "draft", draftId: DraftId.make(t.draftId) }
          : null;
    if (!target || keys.has(targetKey(target))) continue;
    panes.push({ id: p.id, target });
    keys.add(targetKey(target));
  }
  const ids = new Set(panes.map((p) => p.id)),
    used = new Set<string>(),
    splits = new Set<string>();
  function tree(inputTree: unknown, depth = 0): ChatSplit | null {
    if (depth > 8) return null;
    const node = record(inputTree);
    if (
      node.kind === "leaf" &&
      typeof node.paneId === "string" &&
      ids.has(node.paneId) &&
      !used.has(node.paneId)
    ) {
      used.add(node.paneId);
      return leaf(node.paneId);
    }
    if (
      node.kind !== "split" ||
      typeof node.id !== "string" ||
      splits.has(node.id) ||
      (node.axis !== "horizontal" && node.axis !== "vertical")
    )
      return null;
    splits.add(node.id);
    const a = tree(node.first, depth + 1),
      b = tree(node.second, depth + 1);
    return a && b
      ? {
          kind: "split",
          id: node.id,
          axis: node.axis,
          ratio:
            typeof node.ratio === "number" && Number.isFinite(node.ratio)
              ? Math.max(0.05, Math.min(0.95, node.ratio))
              : 0.5,
          first: a,
          second: b,
        }
      : (a ?? b);
  }
  const recentPaneIds = [
    ...new Set([
      ...(Array.isArray(data.recentPaneIds)
        ? data.recentPaneIds.filter((id): id is string => typeof id === "string" && ids.has(id))
        : []),
      ...panes.map((p) => p.id),
    ]),
  ];
  const widths = record(data.columnWidths);
  return reconcile({
    mode:
      data.mode === "grid"
        ? "grid"
        : data.mode === "columns"
          ? "columns"
          : data.mode === "vertical" || data.mode === "stack"
            ? "vertical"
            : "single",
    panes,
    recentPaneIds,
    focusedPaneId:
      typeof data.focusedPaneId === "string" && ids.has(data.focusedPaneId)
        ? data.focusedPaneId
        : (recentPaneIds[0] ?? null),
    grid: tree(data.grid),
    splitPanelOpen: data.splitPanelOpen === true,
    stackRatio: clampStackRatio(typeof data.stackRatio === "number" ? data.stackRatio : Number.NaN),
    verticalView:
      data.verticalView === "queue" ||
      data.verticalView === "split" ||
      data.verticalView === "focus"
        ? data.verticalView
        : "split",
    columnWidths: Object.fromEntries(
      panes.map((p) => [
        p.id,
        typeof widths[p.id] === "number" && Number.isFinite(widths[p.id])
          ? Math.max(320, widths[p.id] as number)
          : 480,
      ]),
    ),
  });
}
