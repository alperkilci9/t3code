import { createMemoryHistory } from "@tanstack/react-router";
import { ThreadId } from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { AppRoot } from "~/AppRoot";
// The route loads ChatView lazily, and its first transform (React Compiler over ~4k lines)
// takes 6-11s; importing it here keeps that out of the test's timeout.
import "~/components/ChatView";
import { useChatLayoutStore } from "~/chatLayoutStore";
import { selectThreadRightPanelState, useRightPanelStore } from "~/rightPanelStore";
import { DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { initialChatLayout } from "~/chatLayout";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import {
  ENVIRONMENT_ID,
  PROJECT_ID,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../../../test/fakeEnvironment";
import { render } from "../../../../test/render";

// The socket is the only fake layer; see test/appScenarios.renders.tsx.
vi.mock(
  "../../../../../../packages/client-runtime/src/connection/driver.ts",
  async (importOriginal) => {
    const [actual, { fakeDriver }, Layer] = await Promise.all([
      importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
      import("../../../../test/fakeEnvironment"),
      import("effect/Layer"),
    ]);
    return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
  },
);

vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()),
  trackRpcRequestSent: () => {},
}));

it("keeps real chat composers independent when switching pane focus", async () => {
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  await page.viewport(1440, 900);
  await using _viewport = {
    [Symbol.asyncDispose]: () => page.viewport(viewport.width, viewport.height),
  };
  using environment = installFakeEnvironment([
    { ...threadWithHistory("pane-a", 1), contextTokens: { usedTokens: 24600, maxTokens: 128000 } },
    { ...threadWithHistory("pane-b", 1), contextTokens: { usedTokens: 64000, maxTokens: 256000 } },
  ]);
  const previous = useChatLayoutStore.getState().layout;
  using _restore = { [Symbol.dispose]: () => useChatLayoutStore.setState({ layout: previous }) };
  useChatLayoutStore.setState({ layout: { ...initialChatLayout(), mode: "grid" } });
  for (const id of ["pane-a", "pane-b"])
    useChatLayoutStore.getState().dispatch({
      type: "open",
      pane: {
        id,
        target: { kind: "server", threadRef: scopeThreadRef(ENVIRONMENT_ID, ThreadId.make(id)) },
      },
      placement: { kind: "append" },
    });
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  const router = getRouter(createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/pane-a`] }));
  await router.load();
  await using _screen = await render(<AppRoot router={router} />, { router: false }); // AppRoot owns routing.
  await expect.element(page.getByTestId("composer-editor").first()).toBeVisible();
  expect(document.querySelector('[aria-label="Chat view mode"]')).not.toBeNull();
  await vi.waitFor(() =>
    expect(document.querySelectorAll('[data-testid="composer-editor"]')).toHaveLength(2),
  );
  expect(document.querySelector('button[aria-label="Panel"]')).not.toBeNull();
  const a = page.getByRole("region", { name: "Chat pane Thread pane-a", exact: true });
  const b = page.getByRole("region", { name: "Chat pane Thread pane-b", exact: true });
  await expect.element(a.getByText("Context 19% · 24.6k / 128k", { exact: true })).toBeVisible();
  await expect.element(b.getByText("Context 25% · 64k / 256k", { exact: true })).toBeVisible();
  await vi.waitFor(() =>
    expect(
      [...document.querySelectorAll("[data-sidebar-row]")].find((row) =>
        row.textContent?.includes("Thread pane-a"),
      )?.textContent,
    ).toContain("Context 19% · 24.6k / 128k"),
  );
  const panel = page.getByRole("button", { name: "Panel", exact: true });
  await expect.element(panel).toHaveAttribute("aria-pressed", "false");
  await userEvent.click(panel);
  await expect.element(panel).toHaveAttribute("aria-pressed", "true");
  await userEvent.click(page.getByRole("button", { name: "Close panel", exact: true }));
  await userEvent.click(page.getByRole("button", { name: "Single", exact: true }));
  await vi.waitFor(() =>
    expect(document.querySelectorAll('[data-testid="composer-editor"]')).toHaveLength(1),
  );
  expect(
    selectThreadRightPanelState(
      useRightPanelStore.getState().byThreadKey,
      scopeThreadRef(ENVIRONMENT_ID, ThreadId.make("pane-a")),
    ).isOpen,
  ).toBe(false);
  await userEvent.click(page.getByRole("button", { name: "Grid", exact: true }));
  await vi.waitFor(() =>
    expect(document.querySelectorAll('[data-testid="composer-editor"]')).toHaveLength(2),
  );
  useRightPanelStore
    .getState()
    .open(scopeThreadRef(ENVIRONMENT_ID, ThreadId.make("pane-a")), "files");
  await expect.element(panel).toHaveAttribute("aria-pressed", "false");
  await userEvent.click(b.getByTestId("composer-editor"));
  await userEvent.keyboard("message for B");
  await expect.element(b.getByTestId("composer-editor")).toHaveTextContent("message for B");
  await expect.element(a.getByTestId("composer-editor")).not.toHaveTextContent("message for B");
  const savedTree = useChatLayoutStore.getState().layout.grid;
  await page.viewport(980, 900);
  await vi.waitFor(() =>
    expect(document.querySelectorAll('[data-testid="composer-editor"]')).toHaveLength(1),
  );
  expect(useChatLayoutStore.getState().layout.mode).toBe("grid");
  await page.viewport(1440, 900);
  await vi.waitFor(() =>
    expect(document.querySelectorAll('[data-testid="composer-editor"]')).toHaveLength(2),
  );
  expect(useChatLayoutStore.getState().layout.grid).toEqual(savedTree);
  await userEvent.click(b.getByTestId("composer-editor"));
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() =>
    expect(environment.requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          input: expect.objectContaining({
            type: "message.dispatch",
            threadId: "pane-b",
            text: "message for B",
          }),
        }),
      ]),
    ),
  );
  expect(
    environment.requests.filter(
      (request) =>
        JSON.stringify(request.input).includes("message.dispatch") &&
        JSON.stringify(request.input).includes("pane-a"),
    ),
  ).toEqual([]);

  const draftId = DraftId.make("background-pane-a");
  {
    useComposerDraftStore
      .getState()
      .setProjectDraftThreadId(scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID), draftId, {
        threadId: ThreadId.make("pane-a"),
      });
    useChatLayoutStore
      .getState()
      .dispatch({ type: "replace", paneId: "pane-a", target: { kind: "draft", draftId } });
    useChatLayoutStore.getState().dispatch({ type: "focus", paneId: "pane-b" });
  }
  await expect
    .element(page.getByRole("region", { name: "Chat pane New chat", exact: true }))
    .toBeVisible();
  useComposerDraftStore
    .getState()
    .markDraftThreadPromoting(draftId, scopeThreadRef(ENVIRONMENT_ID, ThreadId.make("pane-a")));
  useComposerDraftStore.getState().finalizePromotedDraftThread(draftId);
  await vi.waitFor(() =>
    expect(
      useChatLayoutStore.getState().layout.panes.find((pane) => pane.id === "pane-a")?.target.kind,
    ).toBe("server"),
  );
  expect(useChatLayoutStore.getState().layout.focusedPaneId).toBe("pane-b");
  expect(router.state.location.pathname).toBe(`/${ENVIRONMENT_ID}/pane-b`);
});
