import { useRef } from "react";
import { createPortal } from "react-dom";
import type { EnvironmentId } from "@t3tools/contracts";
import { useChatLayoutStore } from "../../../chatLayoutStore";
import { useComposerDraftStore } from "../../../composerDraftStore";
import { randomUUID } from "../../../lib/utils";
import { toastManager } from "../../ui/toast";
import {
  threadContextDropTargetProps,
  useThreadContextDragGhost,
  useThreadContextDrop,
} from "../threadContextDrag";
import {
  canApplyChatPaneDrop,
  resolveChatPaneDrop,
  type ChatPaneDropGeometry,
  type ChatPaneDrop,
  type DropRect,
} from "./chatPaneDrop";

function DropZone({
  rect,
  drop,
  environmentId,
  onFocus,
}: {
  rect: DropRect;
  drop: ChatPaneDrop;
  environmentId: EnvironmentId;
  onFocus: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useThreadContextDrop(ref, environmentId, JSON.stringify(drop), (refs) => {
    if (refs.length !== 1) {
      toastManager.add({ type: "info", title: "Drag one thread to open a pane." });
      return;
    }
    const state = useChatLayoutStore.getState();
    if (!canApplyChatPaneDrop(state.layout, drop)) return;
    const target = { kind: "server" as const, threadRef: refs[0]! };
    state.dispatch(
      drop.kind === "replace"
        ? { type: "replace", paneId: drop.paneId, target }
        : { type: "open", pane: { id: randomUUID(), target }, placement: drop },
    );
    const focused = useChatLayoutStore.getState().layout.focusedPaneId;
    if (focused) onFocus(focused);
  });
  return (
    <div
      ref={ref}
      {...threadContextDropTargetProps()}
      className="fixed z-[90] border border-transparent data-[thread-context-over=true]:border-info data-[thread-context-over=true]:bg-info/20"
      style={{
        left: rect.left,
        top: rect.top,
        width: Math.max(0, rect.right - rect.left),
        height: Math.max(0, rect.bottom - rect.top),
      }}
    >
      {drop.kind === "append" ? (
        <span className="pointer-events-none px-2 text-xs">Add chat</span>
      ) : null}
    </div>
  );
}
export function ChatPaneDropTargets({
  root,
  onFocus,
}: {
  root: HTMLElement | null;
  onFocus: (id: string) => void;
}) {
  const ghost = useThreadContextDragGhost();
  const layout = useChatLayoutStore((state) => state.layout);
  const focused = layout.panes.find((p) => p.id === layout.focusedPaneId)?.target;
  const draft = useComposerDraftStore((state) =>
    focused?.kind === "draft" ? state.getDraftSession(focused.draftId) : null,
  );
  const environmentId =
    focused?.kind === "server" ? focused.threadRef.environmentId : draft?.environmentId;
  if (!ghost || !root || !environmentId || layout.mode === "single") return null;
  const zones: { rect: DropRect; drop: ChatPaneDrop }[] = [];
  if (canApplyChatPaneDrop(layout, { kind: "append" })) {
    const rect = root.getBoundingClientRect();
    zones.push({
      rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.top + 28 },
      drop: { kind: "append" },
    });
  }
  for (const element of root.querySelectorAll<HTMLElement>("[data-pane-drop-id]")) {
    const paneId = element.dataset.paneDropId!,
      rect = element.getBoundingClientRect();
    if (
      layout.mode === "grid" &&
      canApplyChatPaneDrop(layout, { kind: "edge", paneId, edge: "left" })
    ) {
      zones.push({
        drop: { kind: "edge", paneId, edge: "left" },
        rect: { ...rect.toJSON(), right: rect.left + 24 },
      });
      zones.push({
        drop: { kind: "edge", paneId, edge: "right" },
        rect: { ...rect.toJSON(), left: rect.right - 24 },
      });
      zones.push({
        drop: { kind: "edge", paneId, edge: "top" },
        rect: {
          left: rect.left + 24,
          right: rect.right - 24,
          top: rect.top,
          bottom: rect.top + 24,
        },
      });
      zones.push({
        drop: { kind: "edge", paneId, edge: "bottom" },
        rect: {
          left: rect.left + 24,
          right: rect.right - 24,
          top: rect.bottom - 24,
          bottom: rect.bottom,
        },
      });
      zones.push({
        drop: { kind: "replace", paneId },
        rect: {
          left: rect.left + 24,
          right: rect.right - 24,
          top: rect.top + 24,
          bottom: rect.bottom - 24,
        },
      });
    } else {
      zones.push({ drop: { kind: "replace", paneId }, rect });
    }
    if (layout.mode === "columns")
      zones.push({
        drop: { kind: "before-column", paneId },
        rect: { left: rect.left - 6, right: rect.left + 6, top: rect.top, bottom: rect.bottom },
      });
  }
  const canvas = root.querySelector("[data-chat-pane-canvas]")?.getBoundingClientRect();
  if (layout.mode === "columns" && canvas) {
    const lastColumn = [...root.querySelectorAll("[data-pane-viewport]")]
      .at(-1)
      ?.getBoundingClientRect();
    zones.push({
      drop: { kind: "append" },
      rect: {
        left: Math.max(canvas.left, lastColumn?.right ?? canvas.left),
        right: canvas.right,
        top: canvas.top,
        bottom: canvas.bottom,
      },
    });
  }
  const geometry: ChatPaneDropGeometry = {
    mode: layout.mode,
    append: zones.find((zone) => zone.drop.kind === "append")?.rect ?? null,
    panes: [...root.querySelectorAll<HTMLElement>("[data-pane-drop-id]")].map((element) => ({
      paneId: element.dataset.paneDropId!,
      rect: element.getBoundingClientRect(),
    })),
    insertBefore: zones.flatMap((zone) =>
      zone.drop.kind === "before-column" ? [{ paneId: zone.drop.paneId, rect: zone.rect }] : [],
    ),
  };
  // Viewport coordinates must stay outside the Ghost glass's fixed-position containing block.
  return createPortal(
    zones.map((zone) => {
      const bounds = zone.drop.kind === "append" ? root.getBoundingClientRect() : canvas;
      if (!bounds) return null;
      const rect = {
        left: Math.max(zone.rect.left, bounds.left, 0),
        right: Math.min(zone.rect.right, bounds.right, window.innerWidth),
        top: Math.max(zone.rect.top, bounds.top, 0),
        bottom: Math.min(zone.rect.bottom, bounds.bottom, window.innerHeight),
      };
      if (rect.left >= rect.right || rect.top >= rect.bottom) return null;
      const resolved = resolveChatPaneDrop(
        { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 },
        geometry,
      );
      const drop = resolved && canApplyChatPaneDrop(layout, resolved) ? resolved : zone.drop;
      return (
        <DropZone
          key={`${JSON.stringify(zone.drop)}:${zone.rect.left}:${zone.rect.top}`}
          rect={rect}
          drop={drop}
          environmentId={environmentId}
          onFocus={onFocus}
        />
      );
    }),
    document.body,
  );
}
