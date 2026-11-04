import { createMemoryHistory } from "@tanstack/react-router";
import { ThreadId } from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { AppRoot } from "~/AppRoot";
// The route loads ChatView lazily, and its first transform (React Compiler over ~4k lines)
// takes 6-11s; importing it here keeps that out of the test's timeout.
import "~/components/ChatView";
import { useChatLayoutStore } from "~/chatLayoutStore";
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
import { act, render } from "../../../../test/render";

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

it("drags a sidebar thread to a pane edge and cancels a later drag", async () => {
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  await page.viewport(1440, 900);
  await using _viewport = {
    [Symbol.asyncDispose]: () => page.viewport(viewport.width, viewport.height),
  };
  using _environment = installFakeEnvironment([
    threadWithHistory("drag-a", 1),
    threadWithHistory("drag-b", 1),
    threadWithHistory("drag-c", 1),
    threadWithHistory("drag-d", 1),
    threadWithHistory("drag-e", 1),
  ]);
  const previous = useChatLayoutStore.getState().layout;
  using _restore = { [Symbol.dispose]: () => useChatLayoutStore.setState({ layout: previous }) };
  useChatLayoutStore.setState({ layout: { ...initialChatLayout(), mode: "grid" } });
  useChatLayoutStore.getState().dispatch({
    type: "open",
    pane: {
      id: "A",
      target: {
        kind: "server",
        threadRef: scopeThreadRef(ENVIRONMENT_ID, ThreadId.make("drag-a")),
      },
    },
    placement: { kind: "append" },
  });
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  const router = getRouter(createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/drag-a`] }));
  await router.load();
  await using _screen = await render(<AppRoot router={router} />, { router: false }); // AppRoot owns routing.
  await expect.element(page.getByTestId("composer-editor").first()).toBeVisible();
  const source = [...document.querySelectorAll<HTMLElement>("[data-sidebar-row]")].find((element) =>
    element.textContent?.includes("Thread drag-b"),
  );
  expect(source).toBeDefined();
  const box = source!.getBoundingClientRect();
  const pane = document
    .querySelector<HTMLElement>('[data-pane-drop-id="A"]')!
    .getBoundingClientRect();
  const x = pane.right - 8,
    y = pane.top + pane.height / 2;
  const pointer = (type: string, clientX: number, clientY: number, buttons = 1) =>
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      isPrimary: true,
      button: 0,
      buttons,
      clientX,
      clientY,
    });
  await act(() => {
    source!.dispatchEvent(pointer("pointerdown", box.left + 40, box.top + box.height / 2));
    document.dispatchEvent(pointer("pointermove", box.left + 50, box.top + box.height / 2));
  });
  await act(() => document.dispatchEvent(pointer("pointermove", x, y)));
  await vi.waitFor(() =>
    expect(
      document
        .elementFromPoint(x, y)
        ?.closest("[data-thread-context-drop]")
        ?.classList.contains("fixed"),
    ).toBe(true),
  );
  await act(() => document.dispatchEvent(pointer("pointerup", x, y, 0)));
  expect(useChatLayoutStore.getState().layout.panes).toHaveLength(2);
  expect(useChatLayoutStore.getState().layout.grid).toMatchObject({
    kind: "split",
    axis: "horizontal",
    first: { paneId: "A" },
  });
  const sourceC = [...document.querySelectorAll<HTMLElement>("[data-sidebar-row]")].find(
    (element) => element.textContent?.includes("Thread drag-c"),
  )!;
  const c = sourceC.getBoundingClientRect();
  await act(() => {
    sourceC.dispatchEvent(pointer("pointerdown", c.left + 40, c.top + c.height / 2));
    document.dispatchEvent(pointer("pointermove", x, y));
  });
  await act(() =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(useChatLayoutStore.getState().layout.panes).toHaveLength(2);
  expect(document.querySelector(".fixed[data-thread-context-drop]")).toBeNull();
  await userEvent.click(page.getByRole("button", { name: "Columns", exact: true }));
  for (const id of ["drag-c", "drag-d", "drag-e"]) {
    const row = [...document.querySelectorAll<HTMLElement>("[data-sidebar-row]")].find((element) =>
      element.textContent?.includes(`Thread ${id}`),
    )!;
    row.scrollIntoView({ block: "nearest" });
    const from = row.getBoundingClientRect();
    const toolbar = document
      .querySelector<HTMLElement>('[aria-label="Chat view mode"]')!
      .parentElement!.getBoundingClientRect();
    const appendX = toolbar.left + 30,
      appendY = toolbar.top + 14;
    await act(() => {
      row.dispatchEvent(pointer("pointerdown", from.left + 40, from.top + from.height / 2));
      document.dispatchEvent(pointer("pointermove", from.left + 50, from.top + from.height / 2));
    });
    await act(() => document.dispatchEvent(pointer("pointermove", appendX, appendY)));
    await vi.waitFor(() =>
      expect(
        document
          .elementFromPoint(appendX, appendY)
          ?.closest("[data-thread-context-drop]")
          ?.classList.contains("fixed"),
      ).toBe(true),
    );
    await act(() => document.dispatchEvent(pointer("pointerup", appendX, appendY, 0)));
  }
  expect(useChatLayoutStore.getState().layout.panes).toHaveLength(5);
  expect(document.querySelectorAll("[data-chat-pane]")).toHaveLength(5);
  await vi.waitFor(() => {
    const canvas = document
      .querySelector<HTMLElement>("[data-chat-pane-canvas]")!
      .getBoundingClientRect();
    const focused = document
      .querySelector<HTMLElement>('[data-chat-pane-focused="true"]')!
      .getBoundingClientRect();
    expect(focused.left).toBeGreaterThanOrEqual(canvas.left);
    expect(focused.right).toBeLessThanOrEqual(canvas.right);
  });
  document.querySelector<HTMLElement>("[data-chat-pane-canvas]")!.scrollLeft = 0;
  const lastRow = [...document.querySelectorAll<HTMLElement>("[data-sidebar-row]")].find(
    (element) => element.textContent?.includes("Thread drag-e"),
  )!;
  await userEvent.click(lastRow);
  await vi.waitFor(() => {
    const canvas = document
      .querySelector<HTMLElement>("[data-chat-pane-canvas]")!
      .getBoundingClientRect();
    const focused = document
      .querySelector<HTMLElement>('[data-chat-pane-focused="true"]')!
      .getBoundingClientRect();
    expect(focused.left).toBeGreaterThanOrEqual(canvas.left);
    expect(focused.right).toBeLessThanOrEqual(canvas.right);
  });
  await userEvent.click(page.getByRole("button", { name: "Grid", exact: true }));
  await vi.waitFor(() => expect(document.querySelectorAll("[data-chat-pane]")).toHaveLength(4));
  const savedGrid = useChatLayoutStore.getState().layout.grid;
  const separator = document.querySelector<HTMLElement>(
    '[role="separator"][aria-label="Resize chat panes"]',
  )!;
  await act(() =>
    separator.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
    ),
  );
  expect(useChatLayoutStore.getState().layout.grid).not.toEqual(savedGrid);
  await act(() => separator.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
  expect(useChatLayoutStore.getState().layout.grid).toEqual(savedGrid);
  await userEvent.click(page.getByRole("button", { name: "Single", exact: true }));
  await vi.waitFor(() =>
    expect(document.querySelectorAll('[data-testid="composer-editor"]')).toHaveLength(1),
  );
  await userEvent.click(page.getByRole("button", { name: "Grid", exact: true }));
  await vi.waitFor(() => expect(document.querySelectorAll("[data-chat-pane]")).toHaveLength(4));
  expect(useChatLayoutStore.getState().layout.grid).toEqual(savedGrid);
  await userEvent.click(page.getByRole("button", { name: "Columns", exact: true }));
  await vi.waitFor(() => expect(document.querySelectorAll("[data-chat-pane]")).toHaveLength(5));
  expect(useChatLayoutStore.getState().layout.panes).toHaveLength(5);
});
