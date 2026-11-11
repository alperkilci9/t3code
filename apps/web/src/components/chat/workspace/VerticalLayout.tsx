import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useState, type ReactNode } from "react";
import {
  reduceChatLayout,
  type ChatLayout,
  type ChatPane,
  type VerticalView,
} from "../../../chatLayout";
import { useChatLayoutStore } from "../../../chatLayoutStore";
import { useVisibleThreadShells } from "../../../state/entities";
import { Toggle, ToggleGroup } from "../../ui/toggle-group";
import { ChatPaneResizeHandle } from "./ChatPaneResizeHandle";
import { VerticalQueue, partitionVerticalShells } from "./VerticalQueue";
import { VerticalRail } from "./VerticalRail";

const VERTICAL_VIEWS: ReadonlyArray<{ value: VerticalView; label: string }> = [
  { value: "queue", label: "Queue" },
  { value: "split", label: "Split" },
  { value: "focus", label: "Focus" },
];

export function VerticalLayout({
  layout,
  renderPane,
}: {
  layout: ChatLayout;
  renderPane: (pane: ChatPane, visible: boolean) => ReactNode;
}) {
  const [preview, setPreview] = useState<{ ratio: number; original: number } | null>(null);
  const shells = useVisibleThreadShells();
  const { needsYou, working } = partitionVerticalShells(shells);
  const focused = layout.panes.find((p) => p.id === layout.focusedPaneId);
  const focusedKey =
    focused?.target.kind === "server" ? scopedThreadKey(focused.target.threadRef) : null;
  const focusedShell =
    focusedKey !== null
      ? (shells.find(
          (shell) => scopedThreadKey(scopeThreadRef(shell.environmentId, shell.id)) === focusedKey,
        ) ?? null)
      : null;
  const ratio = preview?.original === layout.stackRatio ? preview.ratio : layout.stackRatio;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-chat-pane-canvas>
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/60 bg-muted/20 px-2 text-xs">
        <span className="min-w-0 flex-1 truncate">
          Threads · {needsYou.length} {needsYou.length === 1 ? "needs" : "need"} you ·{" "}
          {working.length} working
        </span>
        <ToggleGroup
          aria-label="Vertical view"
          value={[layout.verticalView]}
          onValueChange={(values) => {
            const next = values[0];
            if (next === "queue" || next === "split" || next === "focus")
              useChatLayoutStore.getState().dispatch({ type: "set-vertical-view", view: next });
          }}
        >
          {VERTICAL_VIEWS.map((item) => (
            <Toggle key={item.value} value={item.value} aria-label={item.label}>
              {item.label}
            </Toggle>
          ))}
        </ToggleGroup>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1">
        <VerticalRail needsYou={needsYou} working={working} focusedShell={focusedShell} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {layout.verticalView === "queue" ? (
            <VerticalQueue compact={false} needsYou={needsYou} working={working} />
          ) : layout.verticalView === "split" ? (
            <div
              className="grid min-h-0 min-w-0 flex-1"
              style={{ gridTemplateRows: `${ratio}fr 6px ${1 - ratio}fr` }}
            >
              <VerticalQueue compact needsYou={needsYou} working={working} />
              <ChatPaneResizeHandle
                axis="vertical"
                value={layout.stackRatio}
                onChange={(next) => {
                  const clamped = reduceChatLayout(layout, {
                    type: "resize-stack",
                    ratio: next,
                  }).stackRatio;
                  setPreview({ ratio: clamped, original: layout.stackRatio });
                }}
                onCommit={(next) => {
                  setPreview(null);
                  useChatLayoutStore.getState().dispatch({ type: "resize-stack", ratio: next });
                }}
              />
              <div className="min-h-0 min-w-0" data-pane-drop-id={focused?.id}>
                {focused ? renderPane(focused, true) : null}
              </div>
            </div>
          ) : (
            <div className="min-h-0 min-w-0 flex-1" data-pane-drop-id={focused?.id}>
              {focused ? renderPane(focused, true) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
