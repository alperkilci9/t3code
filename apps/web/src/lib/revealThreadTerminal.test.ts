import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, expect, it } from "vite-plus/test";

import { initialChatLayout } from "../chatLayout";
import { useChatLayoutStore } from "../chatLayoutStore";
import { selectThreadRightPanelState, useRightPanelStore } from "../rightPanelStore";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { revealThreadTerminal } from "./revealThreadTerminal";

const threadRef = scopeThreadRef(EnvironmentId.make("local"), ThreadId.make("settled-thread"));
const remoteRef = scopeThreadRef(EnvironmentId.make("remote"), threadRef.threadId);

beforeEach(() => {
  useChatLayoutStore.setState({ layout: initialChatLayout() });
  useTerminalUiStateStore.setState({
    terminalUiStateByThreadKey: {},
    suppressedTerminalIdsByThreadKey: {},
  });
  useRightPanelStore.setState({ byThreadKey: {} });
});

it("reopens the existing panel and selects a running terminal in its split", () => {
  const panels = useRightPanelStore.getState();
  panels.openTerminal(threadRef, "terminal-1");
  const surfaceId = selectThreadRightPanelState(
    useRightPanelStore.getState().byThreadKey,
    threadRef,
  ).activeSurfaceId!;
  panels.splitTerminal(threadRef, surfaceId, "setup-install");
  panels.activateTerminal(threadRef, surfaceId, "terminal-1");
  panels.close(threadRef);

  revealThreadTerminal(threadRef, "setup-install");
  expect(
    selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, threadRef),
  ).toMatchObject({
    isOpen: true,
    activeSurfaceId: surfaceId,
    surfaces: [
      {
        terminalIds: ["terminal-1", "setup-install"],
        activeTerminalId: "setup-install",
      },
    ],
  });
  expect(
    selectThreadTerminalUiState(
      useTerminalUiStateStore.getState().terminalUiStateByThreadKey,
      threadRef,
    ).terminalIds,
  ).toEqual([]);
});

it("reveals terminals in their own environment without changing another environment's drawer", () => {
  revealThreadTerminal(threadRef, "default");
  revealThreadTerminal(remoteRef, "setup-install");
  const state = useTerminalUiStateStore.getState().terminalUiStateByThreadKey;
  expect(selectThreadTerminalUiState(state, threadRef).terminalIds).toEqual(["default"]);
  expect(selectThreadTerminalUiState(state, remoteRef).terminalIds).toEqual(["setup-install"]);
});

it("reveals a terminal in the shared split panel instead of an invisible drawer", () => {
  useChatLayoutStore.setState({
    layout: {
      ...initialChatLayout(),
      mode: "grid",
      panes: [{ id: "pane", target: { kind: "server", threadRef } }],
      focusedPaneId: "pane",
    },
  });
  revealThreadTerminal(threadRef, "from-status");
  expect(useChatLayoutStore.getState().layout.splitPanelOpen).toBe(true);
  expect(
    selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, threadRef).surfaces,
  ).toEqual([expect.objectContaining({ kind: "terminal", activeTerminalId: "from-status" })]);
  expect(
    selectThreadTerminalUiState(
      useTerminalUiStateStore.getState().terminalUiStateByThreadKey,
      threadRef,
    ).terminalOpen,
  ).toBe(false);

  useChatLayoutStore.getState().dispatch({ type: "set-panel-open", open: false });
  revealThreadTerminal(remoteRef, "not-open-yet");
  expect(useChatLayoutStore.getState().layout.splitPanelOpen).toBe(true);
  expect(
    selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, remoteRef).surfaces,
  ).toEqual([expect.objectContaining({ kind: "terminal", activeTerminalId: "not-open-yet" })]);
  expect(
    selectThreadTerminalUiState(
      useTerminalUiStateStore.getState().terminalUiStateByThreadKey,
      remoteRef,
    ).terminalOpen,
  ).toBe(false);
  expect(useChatLayoutStore.getState().layout.focusedPaneId).toBe("pane");
});
