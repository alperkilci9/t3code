import { expect, it } from "vite-plus/test";
import { createMemoryStorage } from "./lib/storage";
import { createChatLayoutStore } from "./chatLayoutStore";

it("persists only layout state and restores explicit panel visibility", () => {
  const storage = createMemoryStorage();
  const first = createChatLayoutStore(storage);
  first.getState().dispatch({ type: "set-mode", mode: "columns" });
  first.getState().dispatch({ type: "set-panel-open", open: true });
  const restored = createChatLayoutStore(storage);
  expect(restored.getState().layout).toEqual(first.getState().layout);
  expect(restored.getState().layout.splitPanelOpen).toBe(true);
  expect(Object.keys(JSON.parse(storage.getItem("t3code:chat-layout:v1") as string).state)).toEqual(
    ["layout"],
  );
});
