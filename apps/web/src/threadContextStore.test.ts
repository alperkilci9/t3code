import { expect, it } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { formatThreadContext, useThreadContextStore } from "./threadContextStore";

it("shows reported context tokens and percentage without inventing missing capacity", () => {
  expect(
    formatThreadContext({
      usedTokens: 24600,
      maxTokens: 128000,
      updatedAt: "2026-11-04T10:00:00Z",
    }),
  ).toBe("19% · 24.6k / 128k");
  expect(
    formatThreadContext({ usedTokens: 0, maxTokens: 128000, updatedAt: "2026-11-04T10:00:00Z" }),
  ).toBe("0% · 0 / 128k");
  expect(
    formatThreadContext({ usedTokens: 24600, maxTokens: null, updatedAt: "2026-11-04T10:00:00Z" }),
  ).toBe("—% · 24.6k / —");
  expect(formatThreadContext(null)).toBe("—");
});
it("keeps sidebar context isolated across environments", () => {
  const a = scopeThreadRef(EnvironmentId.make("context-a"), ThreadId.make("same"));
  const b = scopeThreadRef(EnvironmentId.make("context-b"), ThreadId.make("same"));
  const previous = useThreadContextStore.getState().byThreadKey;
  using _restore = {
    [Symbol.dispose]: () => useThreadContextStore.setState({ byThreadKey: previous }),
  };
  useThreadContextStore
    .getState()
    .record(a, { usedTokens: 100, maxTokens: 1000, updatedAt: "2026-11-04T10:00:00Z" });
  useThreadContextStore
    .getState()
    .record(b, { usedTokens: 200, maxTokens: 2000, updatedAt: "2026-11-04T10:00:00Z" });
  expect(useThreadContextStore.getState().byThreadKey[scopedThreadKey(a)]?.usedTokens).toBe(100);
  expect(useThreadContextStore.getState().byThreadKey[scopedThreadKey(b)]?.usedTokens).toBe(200);
});
