import { useRef } from "react";
import { CHAT_PANE_HANDLE_SIZE } from "../../../chatLayout";

export function ChatPaneResizeHandle({
  axis,
  value,
  ratio = true,
  onChange,
  onCommit,
}: {
  axis: "horizontal" | "vertical";
  value: number;
  ratio?: boolean;
  onChange: (value: number, extent: number) => void;
  onCommit: (value: number, extent: number) => void;
}) {
  const drag = useRef<{ start: number; value: number; extent: number; next: number } | null>(null);
  return (
    <div
      role="separator"
      aria-label="Resize chat panes"
      aria-orientation={axis === "horizontal" ? "vertical" : "horizontal"}
      tabIndex={0}
      className={
        axis === "horizontal"
          ? "w-1.5 shrink-0 cursor-col-resize touch-none hover:bg-info/30 focus-visible:bg-info/30"
          : "h-1.5 shrink-0 cursor-row-resize touch-none hover:bg-info/30 focus-visible:bg-info/30"
      }
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        const rect = event.currentTarget.parentElement!.getBoundingClientRect();
        const extent = axis === "horizontal" ? rect.width : rect.height;
        drag.current = {
          start: axis === "horizontal" ? event.clientX : event.clientY,
          value,
          extent,
          next: value,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (!current) return;
        const delta = (axis === "horizontal" ? event.clientX : event.clientY) - current.start;
        current.next =
          current.value + delta / (ratio ? Math.max(1, current.extent - CHAT_PANE_HANDLE_SIZE) : 1);
        onChange(current.next, current.extent);
      }}
      onPointerUp={(event) => {
        const current = drag.current;
        drag.current = null;
        if (current) {
          onCommit(current.next, current.extent);
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerCancel={() => {
        const current = drag.current;
        drag.current = null;
        if (current) onChange(current.value, current.extent);
      }}
      onDoubleClick={(event) => {
        const rect = event.currentTarget.parentElement!.getBoundingClientRect();
        const extent = axis === "horizontal" ? rect.width : rect.height;
        onCommit(ratio ? 0.5 : 480, extent);
      }}
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        const rect = event.currentTarget.parentElement!.getBoundingClientRect();
        onCommit(
          value + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1) * (ratio ? 0.02 : 20),
          axis === "horizontal" ? rect.width : rect.height,
        );
      }}
    />
  );
}
