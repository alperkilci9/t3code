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
import { useRightPanelStore } from "~/rightPanelStore";
import { initialChatLayout } from "~/chatLayout";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import {
  ENVIRONMENT_ID,
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
    threadWithHistory("pane-a", 1),
    threadWithHistory("pane-b", 1),
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
  const panel = page.getByRole("button", { name: "Panel", exact: true });
  await expect.element(panel).toHaveAttribute("aria-pressed", "false");
  await userEvent.click(panel);
  await expect.element(panel).toHaveAttribute("aria-pressed", "true");
  await userEvent.click(page.getByRole("button", { name: "Close panel", exact: true }));
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
  await vi
    .waitFor(() =>
      expect(
        environment.requests.some(
          (request) =>
            JSON.stringify(request.input).includes("message.dispatch") &&
            JSON.stringify(request.input).includes("pane-b"),
        ),
      ).toBe(true),
    )
    .catch((error) => {
      console.log("SEND REQUESTS AT FAILURE", JSON.stringify(environment.requests));
      throw error;
    });
  expect(
    environment.requests.filter(
      (request) =>
        JSON.stringify(request.input).includes("message.dispatch") &&
        JSON.stringify(request.input).includes("pane-a"),
    ),
  ).toEqual([]);
});
