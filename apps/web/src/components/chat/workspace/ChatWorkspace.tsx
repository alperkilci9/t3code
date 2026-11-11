import {
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "@tanstack/react-router";
import type { ChatComposerHandle } from "../ChatComposer";
import { useStableCallback } from "../../../hooks/useStableCallback";
import { requestWorkspaceFocus } from "../../../lib/workspaceFocus";
import { revealChatColumn } from "../../../lib/revealChatColumn";
import { randomUUID } from "../../../lib/utils";
import { isChatSplitActive, targetKey, type PaneId } from "../../../chatLayout";
import { useChatLayoutStore } from "../../../chatLayoutStore";
import { useRightPanelStore } from "../../../rightPanelStore";
import { useComposerHandleContext, type ComposerHandleRef } from "../../../composerHandleContext";
import { buildThreadRouteParams, type ThreadRouteTarget } from "../../../threadRoutes";
import { ThreadRouteView } from "../../ThreadRouteView";
import { SidebarInset } from "../../ui/sidebar";
import { ChatPaneDropTargets } from "./ChatPaneDropTargets";
import { ChatPaneLayouts } from "./ChatPaneLayouts";
import { ChatPane } from "./ChatPane";
import { ChatViewModeControl } from "./ChatViewModeControl";

const subscribeWidth = (changed: () => void) => {
  window.addEventListener("resize", changed);
  return () => window.removeEventListener("resize", changed);
};
export function ChatWorkspace({
  target,
  background,
}: {
  target: ThreadRouteTarget;
  background: boolean;
}) {
  const layout = useChatLayoutStore((state) => state.layout);
  const width = useSyncExternalStore(subscribeWidth, () => window.innerWidth);
  const split = isChatSplitActive(layout.mode, width);
  const navigate = useNavigate();
  const parentComposer = useComposerHandleContext();
  const [handles] = useState(() => new Map<PaneId, ComposerHandleRef>());
  const [panelHost, setPanelHost] = useState<HTMLDivElement | null>(null);
  const [controlsHost, setControlsHost] = useState<HTMLDivElement | null>(null);
  const [workspaceElement, setWorkspaceElement] = useState<HTMLDivElement | null>(null);
  const [toolbarHost, setToolbarHost] = useState<HTMLElement | null>(null);
  const attachWorkspace = useStableCallback((element: HTMLDivElement | null) => {
    setWorkspaceElement(element);
    setToolbarHost(
      element ? document.querySelector<HTMLElement>('[data-slot="sidebar-footer"]') : null,
    );
  });
  const lastRoute = useRef<string | null>(null);
  const routeKey = targetKey(target);
  const reveal = useStableCallback((id: PaneId | null) => {
    if (id && workspaceElement) revealChatColumn(id, workspaceElement);
  });
  const follow = useStableCallback((next: ThreadRouteTarget) => {
    void (next.kind === "server"
      ? navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(next.threadRef),
          replace: true,
        })
      : navigate({ to: "/draft/$draftId", params: { draftId: next.draftId }, replace: true }));
  });
  const focus = useStableCallback((id: PaneId) => {
    const state = useChatLayoutStore.getState();
    const pane = state.layout.panes.find((p) => p.id === id);
    if (!pane) return;
    reveal(id);
    if (state.layout.focusedPaneId === id) {
      if (lastRoute.current !== targetKey(pane.target)) {
        lastRoute.current = targetKey(pane.target);
        follow(pane.target);
      }
      return;
    }
    state.dispatch({ type: "focus", paneId: id });
    lastRoute.current = targetKey(pane.target);
    follow(pane.target);
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- split surfaces reuse the thread panel store while Single retains its independent visibility choice
  useLayoutEffect(() => {
    if (!split) return;
    let restoring = false;
    return useRightPanelStore.subscribe((next, previous) => {
      if (restoring) return;
      const changed = Object.entries(next.byThreadKey).filter(
        ([key, value]) => value.isOpen !== (previous.byThreadKey[key]?.isOpen ?? false),
      );
      if (!changed.length) return;
      const byThreadKey = { ...next.byThreadKey };
      for (const [key, value] of changed)
        byThreadKey[key] = { ...value, isOpen: previous.byThreadKey[key]?.isOpen ?? false };
      restoring = true;
      try {
        useRightPanelStore.setState({ byThreadKey });
      } catch (error) {
        restoring = false;
        throw error;
      }
      restoring = false;
    });
  }, [split]);
  const close = useStableCallback((id: PaneId) => {
    const state = useChatLayoutStore.getState();
    const wasFocused = state.layout.focusedPaneId === id;
    state.dispatch({ type: "close", paneId: id });
    handles.delete(id);
    if (!wasFocused) return;
    const next = useChatLayoutStore.getState().layout;
    const pane = next.panes.find((p) => p.id === next.focusedPaneId);
    if (pane) {
      lastRoute.current = targetKey(pane.target);
      follow(pane.target);
    } else void navigate({ to: "/", replace: true });
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reconciles external router navigation with the client-local pane list
  useLayoutEffect(() => {
    if (background || lastRoute.current === routeKey) return;
    lastRoute.current = routeKey;
    const state = useChatLayoutStore.getState();
    const existing = state.layout.panes.find((p) => targetKey(p.target) === routeKey);
    if (existing) state.dispatch({ type: "focus", paneId: existing.id });
    else if (state.layout.focusedPaneId)
      state.dispatch({ type: "replace", paneId: state.layout.focusedPaneId, target });
    else
      state.dispatch({
        type: "open",
        pane: { id: randomUUID(), target },
        placement: { kind: "append" },
      });
  }, [background, routeKey, target]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reveals the destination after route changes or newly mounted Columns panes without moving keyboard focus
  useLayoutEffect(() => {
    if (background || layout.mode !== "columns" || !workspaceElement) return;
    const pane = layout.panes.find((pane) => pane.id === layout.focusedPaneId);
    if (pane && targetKey(pane.target) === routeKey) revealChatColumn(pane.id, workspaceElement);
  }, [background, layout.focusedPaneId, layout.mode, layout.panes, routeKey, workspaceElement]);
  if (!split) return <ThreadRouteView target={target} background={background} />;
  return (
    <SidebarInset className="h-svh min-h-0 overflow-hidden md:h-dvh" inert={background}>
      <FocusedComposerBridge targetRef={parentComposer} handles={handles} />
      <div
        ref={attachWorkspace}
        data-chat-workspace
        className="flex min-h-0 flex-1 flex-col bg-background"
      >
        {!background && toolbarHost
          ? createPortal(
              <div className="flex flex-col items-center gap-1 border-t border-sidebar-border pt-2">
                <ChatViewModeControl />
                <div ref={setControlsHost} />
              </div>,
              toolbarHost,
            )
          : null}
        <ChatPaneDropTargets root={workspaceElement} onFocus={focus} />
        <div className="relative flex min-h-0 flex-1">
          <ChatPaneLayouts
            layout={layout}
            renderPane={(pane, visible) => {
              let composerRef = handles.get(pane.id);
              if (!composerRef) {
                composerRef = { current: null };
                handles.set(pane.id, composerRef);
              }
              return (
                <ChatPane
                  pane={pane}
                  background={background}
                  composerRef={composerRef}
                  onFocus={focus}
                  onClose={close}
                  presentation={{
                    paneId: pane.id,
                    visible,
                    panelHost,
                    controlsHost,
                    workspaceElement,
                    requestPanel: (open) => {
                      useChatLayoutStore.getState().dispatch({ type: "set-panel-open", open });
                      if (open) requestWorkspaceFocus({ area: "panel" });
                    },
                  }}
                />
              );
            }}
          />
          <div ref={setPanelHost} data-chat-shared-panel className="flex min-h-0 shrink-0" />
        </div>
      </div>
    </SidebarInset>
  );
}

function FocusedComposerBridge({
  targetRef,
  handles,
}: {
  targetRef: ComposerHandleRef | null;
  handles: Map<PaneId, ComposerHandleRef>;
}) {
  useImperativeHandle(
    targetRef,
    () =>
      new Proxy({} as ChatComposerHandle, {
        get(_target, property) {
          const handle = handles.get(
            useChatLayoutStore.getState().layout.focusedPaneId ?? "",
          )?.current;
          const value: unknown = handle ? Reflect.get(handle, property) : undefined;
          return typeof value === "function" ? value.bind(handle) : value;
        },
      }),
  );
  return null;
}
