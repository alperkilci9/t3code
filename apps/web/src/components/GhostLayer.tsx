import { useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { flashClass, installGhostTurbo, readGhostLook, subscribeGhostLook } from "../ghostLook";
import { useThreadCompletionStore } from "../threadCompletionStore";

const readServerLook = () => "standard" as const;

/**
 * The Ghost look's lights behind and over the app: the backdrop (dot field, engine glow,
 * horizon) and the sweep that crosses the window when an agent finishes. Mounted once with
 * the app shell; renders nothing in the standard look.
 */
export function GhostLayer() {
  const look = useSyncExternalStore(subscribeGhostLook, readGhostLook, readServerLook);
  const lapRef = useRef<HTMLDivElement | null>(null);
  const previousLook = useRef(look);
  const ghost = look === "ghost";

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- installs the keystroke listener and animation loop only while the Ghost look is on
  useEffect(() => {
    if (!ghost) {
      previousLook.current = look;
      return;
    }
    const uninstall = installGhostTurbo();
    // Switching the look on revs it once; a reload with Ghost already on stays quiet.
    if (previousLook.current !== "ghost") {
      flashClass(document.documentElement, "ghost-ignite", 1100);
    }
    previousLook.current = look;
    const unsubscribe = useThreadCompletionStore.subscribe((state, previous) => {
      const finished = Object.keys(state.pending).some(
        (key) => state.pending[key] !== previous.pending[key],
      );
      if (finished) flashClass(lapRef.current, "is-lap", 950);
    });
    return () => {
      uninstall();
      unsubscribe();
    };
  }, [ghost, look]);

  if (!ghost || typeof document === "undefined") return null;
  return createPortal(
    <>
      <div data-ghost-backdrop="" aria-hidden="true">
        <div data-ghost-dots="" />
        <div data-ghost-orb="" />
        <div data-ghost-horizon="" />
      </div>
      <div ref={lapRef} data-ghost-lap="" aria-hidden="true" />
    </>,
    document.body,
  );
}
