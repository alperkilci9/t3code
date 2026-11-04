import { expect, it } from "vite-plus/test";
import { initialChatLayout } from "../../../chatLayout";
import {
  canApplyChatPaneDrop,
  resolveChatPaneDrop,
  type ChatPaneDropGeometry,
} from "./chatPaneDrop";

const geometry: ChatPaneDropGeometry = {
  mode: "grid",
  append: { left: 0, top: -30, right: 1000, bottom: 0 },
  panes: [{ paneId: "A", rect: { left: 0, top: 0, right: 1000, bottom: 600 } }],
  insertBefore: [],
};
it.each([
  [500, -15, { kind: "append" }],
  [500, 300, { kind: "replace", paneId: "A" }],
  [5, 300, { kind: "edge", paneId: "A", edge: "left" }],
  [995, 300, { kind: "edge", paneId: "A", edge: "right" }],
  [500, 5, { kind: "edge", paneId: "A", edge: "top" }],
  [500, 595, { kind: "edge", paneId: "A", edge: "bottom" }],
  [1100, 700, null],
])("resolves drop at %s,%s", (x, y, expected) => {
  expect(resolveChatPaneDrop({ x: x as number, y: y as number }, geometry)).toEqual(expected);
});
it("prioritizes the insertion gap between columns", () => {
  expect(
    resolveChatPaneDrop(
      { x: 500, y: 300 },
      {
        ...geometry,
        mode: "columns",
        insertBefore: [{ paneId: "B", rect: { left: 494, top: 0, right: 506, bottom: 600 } }],
      },
    ),
  ).toEqual({ kind: "before-column", paneId: "B" });
});
it("offers only replacement when Grid is full", () => {
  const state = {
    ...initialChatLayout(),
    mode: "grid" as const,
    panes: Array.from({ length: 4 }, (_, i) => ({ id: String(i), target: geometry as never })),
  };
  expect(canApplyChatPaneDrop(state, { kind: "append" })).toBe(false);
  expect(canApplyChatPaneDrop(state, { kind: "edge", paneId: "0", edge: "left" })).toBe(false);
  expect(canApplyChatPaneDrop(state, { kind: "replace", paneId: "0" })).toBe(true);
});
