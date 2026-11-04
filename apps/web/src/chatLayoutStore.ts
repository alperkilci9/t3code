import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  initialChatLayout,
  normalizeChatLayout,
  reduceChatLayout,
  type ChatLayout,
  type ChatLayoutAction,
} from "./chatLayout";
import { resolveStorage, type StateStorage } from "./lib/storage";

export function createChatLayoutStore(storage?: StateStorage) {
  return create<{ layout: ChatLayout; dispatch: (action: ChatLayoutAction) => void }>()(
    persist(
      (set) => ({
        layout: initialChatLayout(),
        dispatch: (action) => set((state) => ({ layout: reduceChatLayout(state.layout, action) })),
      }),
      {
        name: "t3code:chat-layout:v1",
        version: 1,
        storage: createJSONStorage(() => resolveStorage(storage)),
        partialize: (state) => ({ layout: state.layout }),
        merge: (persisted, current) => ({
          ...current,
          layout: normalizeChatLayout(
            persisted && typeof persisted === "object" && "layout" in persisted
              ? persisted.layout
              : null,
          ),
        }),
        migrate: () => ({ layout: initialChatLayout() }),
      },
    ),
  );
}
export const useChatLayoutStore = createChatLayoutStore(
  typeof window !== "undefined" ? window.localStorage : undefined,
);
