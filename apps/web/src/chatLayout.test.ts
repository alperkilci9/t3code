import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import {
  initialChatLayout,
  normalizeChatLayout,
  reduceChatLayout,
  selectGridPaneIds,
  targetKey,
  type ChatLayout,
  type ChatPane,
  type ChatSplit,
} from "./chatLayout";

function pane(id: string, environment = "local"): ChatPane {
  return {
    id,
    target: {
      kind: "server",
      threadRef: scopeThreadRef(EnvironmentId.make(environment), ThreadId.make(id)),
    },
  };
}
function open(ids: string[], mode: ChatLayout["mode"] = "columns") {
  return ids.reduce(
    (state, id) =>
      reduceChatLayout(state, { type: "open", pane: pane(id), placement: { kind: "append" } }),
    { ...initialChatLayout(), mode },
  );
}
function leaves(tree: ChatSplit | null): string[] {
  return !tree
    ? []
    : tree.kind === "leaf"
      ? [tree.paneId]
      : [...leaves(tree.first), ...leaves(tree.second)];
}
it("keeps five columns and their widths through Grid and Single", () => {
  let state = open(["A", "B", "C", "D", "E"]);
  state = reduceChatLayout(state, { type: "resize-column", paneId: "A", width: 570 });
  state = reduceChatLayout(state, { type: "set-mode", mode: "grid" });
  expect(selectGridPaneIds(state)).toEqual(["E", "D", "C", "B"]);
  const tree = state.grid;
  state = reduceChatLayout(state, { type: "set-mode", mode: "single" });
  state = reduceChatLayout(state, { type: "set-mode", mode: "grid" });
  expect(state.grid).toEqual(tree);
  state = reduceChatLayout(state, { type: "set-mode", mode: "columns" });
  expect(state.panes.map((p) => p.id)).toEqual(["A", "B", "C", "D", "E"]);
  expect(state.columnWidths.A).toBe(570);
});
it("does not reshuffle a grid when focus changes among its leaves", () => {
  const before = open(["A", "B", "C"], "grid");
  const after = reduceChatLayout(before, { type: "focus", paneId: "A" });
  expect(after.grid).toEqual(before.grid);
  expect(selectGridPaneIds(after)[0]).toBe("A");
});
it("caps Grid additions but permits replacement without deleting threads", () => {
  const before = open(["A", "B", "C", "D"], "grid");
  expect(
    reduceChatLayout(before, { type: "open", pane: pane("E"), placement: { kind: "append" } }),
  ).toBe(before);
  const after = reduceChatLayout(before, {
    type: "replace",
    paneId: "B",
    target: pane("E").target,
  });
  expect(after.panes.map((p) => targetKey(p.target))).toContain(targetKey(pane("E").target));
  expect(leaves(after.grid)).toEqual(leaves(before.grid));
});
it("splits the requested leaf and collapses its sibling when closed", () => {
  let state = open(["A", "B"], "grid");
  state = reduceChatLayout(state, {
    type: "open",
    pane: pane("C"),
    placement: { kind: "edge", paneId: "B", edge: "bottom" },
  });
  expect(state.grid).toMatchObject({
    kind: "split",
    axis: "horizontal",
    second: { kind: "split", axis: "vertical", first: { paneId: "B" }, second: { paneId: "C" } },
  });
  state = reduceChatLayout(state, { type: "close", paneId: "C" });
  expect(state.grid).toEqual(open(["A", "B"], "grid").grid);
  expect(state.focusedPaneId).toBe("B");
});
it("inserts columns and focuses duplicates without opening another copy", () => {
  let state = open(["A", "C"]);
  state = reduceChatLayout(state, {
    type: "open",
    pane: pane("B"),
    placement: { kind: "before-column", paneId: "C" },
  });
  expect(state.panes.map((p) => p.id)).toEqual(["A", "B", "C"]);
  state = reduceChatLayout(state, {
    type: "open",
    pane: { ...pane("B"), id: "duplicate" },
    placement: { kind: "append" },
  });
  expect(state.panes).toHaveLength(3);
  expect(state.focusedPaneId).toBe("B");
  expect(targetKey(pane("B").target)).not.toBe(targetKey(pane("B", "remote").target));
});
it("clamps resizing to descendant minimums and ignores non-finite values", () => {
  const state = open(["A", "B"], "grid");
  if (state.grid?.kind !== "split") throw new Error("expected split");
  const after = reduceChatLayout(state, {
    type: "resize-split",
    splitId: state.grid.id,
    ratio: 0.99,
    extent: 1006,
  });
  expect(after.grid?.kind === "split" ? after.grid.ratio : 0).toBeCloseTo(0.68);
  expect(reduceChatLayout(state, { type: "resize-column", paneId: "A", width: NaN })).toBe(state);
});
it("normalizes corrupt saved layouts while preserving valid panes", () => {
  const valid = open(["A", "B"]);
  const state = normalizeChatLayout({
    ...valid,
    focusedPaneId: "missing",
    panes: [...valid.panes, valid.panes[0], { id: "bad", target: {} }],
    columnWidths: { A: Infinity, B: -20 },
    grid: { kind: "leaf", paneId: "missing" },
  });
  expect(state.panes).toHaveLength(2);
  expect(state.columnWidths).toEqual({ A: 480, B: 320 });
  expect(state.focusedPaneId).toBe("B");
  expect(leaves(state.grid).sort()).toEqual(["A", "B"]);
  expect(normalizeChatLayout(null)).toEqual(initialChatLayout());
});
