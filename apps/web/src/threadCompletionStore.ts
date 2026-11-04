import { create } from "zustand";

export const useThreadCompletionStore = create<{
  pending: Record<string, number>;
  mark: (key: string, completedAt: number) => void;
  acknowledge: (key: string) => void;
}>()((set) => ({
  pending: {},
  mark: (key, completedAt) =>
    set((state) => ({ pending: { ...state.pending, [key]: completedAt } })),
  acknowledge: (key) =>
    set((state) => {
      if (!(key in state.pending)) return state;
      const pending = { ...state.pending };
      delete pending[key];
      return { pending };
    }),
}));
