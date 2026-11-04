import {
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useNavigate } from "@tanstack/react-router";
import type { ChatComposerHandle } from "../ChatComposer";
import { useStableCallback } from "../../../hooks/useStableCallback";
import { requestWorkspaceFocus } from "../../../lib/workspaceFocus";
import { randomUUID } from "../../../lib/utils";
import { targetKey, type PaneId } from "../../../chatLayout";
import { useChatLayoutStore } from "../../../chatLayoutStore";
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
  const navigate = useNavigate();
  const parentComposer = useComposerHandleContext();
  const [handles] = useState(() => new Map<PaneId, ComposerHandleRef>());
  const [panelHost, setPanelHost] = useState<HTMLDivElement | null>(null);
  const [controlsHost, setControlsHost] = useState<HTMLDivElement | null>(null);
  const [workspaceElement, setWorkspaceElement] = useState<HTMLDivElement | null>(null);
  const lastRoute = useRef<string | null>(null);
  const routeKey = targetKey(target);
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
  if (layout.mode === "single" || width <= 980)
    return <ThreadRouteView target={target} background={background} />;
  return (
    <SidebarInset className="h-svh min-h-0 overflow-hidden md:h-dvh" inert={background}>
      <FocusedComposerBridge targetRef={parentComposer} handles={handles} />
      <div ref={setWorkspaceElement} className="flex min-h-0 flex-1 flex-col bg-background">
        <div className="flex h-[var(--workspace-topbar-height)] shrink-0 items-center justify-end gap-2 px-3">
          <ChatViewModeControl />
          <div ref={setControlsHost} />
        </div>
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
