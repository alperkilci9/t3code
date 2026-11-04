import { useEffect, useState, type ReactNode } from "react";
import {
  CHAT_PANE_MIN_WIDTH,
  minimumChatSplitSize,
  reduceChatLayout,
  type ChatLayout,
  type ChatPane,
  type ChatSplit,
} from "../../../chatLayout";
import { useChatLayoutStore } from "../../../chatLayoutStore";
import { ChatPaneResizeHandle } from "./ChatPaneResizeHandle";

function GridNode({
  node,
  layout,
  renderPane,
}: {
  node: ChatSplit;
  layout: ChatLayout;
  renderPane: (pane: ChatPane, visible: boolean) => ReactNode;
}) {
  const [preview, setPreview] = useState<{ ratio: number; original: number } | null>(null);
  if (node.kind === "leaf") {
    const pane = layout.panes.find((p) => p.id === node.paneId);
    return pane ? (
      <div className="min-h-0 min-w-0" data-pane-drop-id={pane.id}>
        {renderPane(pane, true)}
      </div>
    ) : null;
  }
  const ratio = preview?.original === node.ratio ? preview.ratio : node.ratio;
  const sizes = `${ratio}fr 6px ${1 - ratio}fr`;
  return (
    <div
      className="grid min-h-0 min-w-0"
      style={
        node.axis === "horizontal" ? { gridTemplateColumns: sizes } : { gridTemplateRows: sizes }
      }
    >
      <GridNode node={node.first} layout={layout} renderPane={renderPane} />
      <ChatPaneResizeHandle
        axis={node.axis}
        value={node.ratio}
        onChange={(next, extent) => {
          const result = reduceChatLayout(
            { ...layout, grid: node },
            { type: "resize-split", splitId: node.id, ratio: next, extent },
          ).grid;
          if (result?.kind === "split") setPreview({ ratio: result.ratio, original: node.ratio });
        }}
        onCommit={(next, extent) => {
          setPreview(null);
          useChatLayoutStore
            .getState()
            .dispatch({ type: "resize-split", splitId: node.id, ratio: next, extent });
        }}
      />
      <GridNode node={node.second} layout={layout} renderPane={renderPane} />
    </div>
  );
}
function Column({
  pane,
  width,
  visible,
  renderPane,
}: {
  pane: ChatPane;
  width: number;
  visible: boolean;
  renderPane: (pane: ChatPane, visible: boolean) => ReactNode;
}) {
  const [preview, setPreview] = useState<number | null>(null);
  return (
    <div
      className="flex h-full shrink-0"
      style={{ width: preview ?? width }}
      data-pane-viewport={pane.id}
    >
      <div className="min-w-0 flex-1" data-pane-drop-id={pane.id}>
        {renderPane(pane, visible)}
      </div>
      <ChatPaneResizeHandle
        axis="horizontal"
        value={width}
        ratio={false}
        onChange={(next) => setPreview(Math.max(CHAT_PANE_MIN_WIDTH, next))}
        onCommit={(next) => {
          setPreview(null);
          useChatLayoutStore
            .getState()
            .dispatch({ type: "resize-column", paneId: pane.id, width: next });
        }}
      />
    </div>
  );
}
export function ChatPaneLayouts({
  layout,
  renderPane,
}: {
  layout: ChatLayout;
  renderPane: (pane: ChatPane, visible: boolean) => ReactNode;
}) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState<Set<string>>(() => new Set());
  const paneKey = layout.panes.map((p) => p.id).join("\n");
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- observes actual column visibility for mounting expensive views and recording visits
  useEffect(() => {
    if (!root || layout.mode !== "columns" || paneKey.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) =>
        setVisible((previous) => {
          const next = new Set(previous);
          for (const entry of entries) {
            const id = (entry.target as HTMLElement).dataset.paneViewport!;
            if (entry.isIntersecting) next.add(id);
            else next.delete(id);
          }
          return next;
        }),
      { root },
    );
    root.querySelectorAll("[data-pane-viewport]").forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [root, layout.mode, paneKey]);
  if (layout.mode === "grid" && layout.grid) {
    const minimum = minimumChatSplitSize(layout.grid);
    return (
      <div className="min-h-0 min-w-0 flex-1 overflow-auto p-1" data-chat-pane-canvas>
        <div className="grid h-full" style={{ minWidth: minimum.width, minHeight: minimum.height }}>
          <GridNode node={layout.grid} layout={layout} renderPane={renderPane} />
        </div>
      </div>
    );
  }
  return (
    <div
      ref={setRoot}
      className="flex min-h-0 min-w-0 flex-1 gap-1 overflow-x-auto p-1"
      data-chat-pane-canvas
    >
      {layout.panes.map((pane) => (
        <Column
          key={pane.id}
          pane={pane}
          width={layout.columnWidths[pane.id] ?? 480}
          visible={visible.has(pane.id)}
          renderPane={renderPane}
        />
      ))}
    </div>
  );
}
