import { expect, it, vi } from "vite-plus/test";

import { ComposerSurface } from "./components/chat/ComposerSurface";
import { installGhostTurbo } from "./ghostLook";
import { fakeTimers, render } from "../test/render";

it("keeps typing updates on the active lights and clears them when focus leaves", async () => {
  await using screen = await render(
    <>
      <div data-ghost-backdrop="" />
      <ComposerSurface.Shell>
        <textarea aria-label="First prompt" />
      </ComposerSurface.Shell>
      <ComposerSurface.Shell>
        <textarea aria-label="Second prompt" />
      </ComposerSurface.Shell>
    </>,
    { router: false }, // The light controller only observes native input and focus events.
  );
  using _timers = fakeTimers();
  using _turbo = { [Symbol.dispose]: installGhostTurbo() };
  const first = screen.getByRole("textbox", { name: "First prompt" }).element() as HTMLElement;
  first.focus();
  for (let i = 0; i < 12; i++) {
    first.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, data: "a" }));
    vi.advanceTimersByTime(80);
  }
  const shells = screen.container.querySelectorAll<HTMLElement>('[data-slot="composer-shell"]');
  const activeLight = shells[0]!.querySelector<HTMLElement>("[data-ghost-rev]")!;
  expect(Number(activeLight.style.getPropertyValue("--turbo"))).toBeGreaterThan(0.85);
  expect(document.documentElement.style.getPropertyValue("--ghost-turbo")).toBe("");
  expect(shells[0]!.style.getPropertyValue("--turbo")).toBe("");
  expect(shells[1]!.querySelector("[data-ghost-rev]")!.getAttribute("style")).toBeNull();
  const backdrop = screen.container.querySelector<HTMLElement>("[data-ghost-backdrop]")!;
  expect(Number(backdrop.style.getPropertyValue("--ghost-turbo"))).toBeGreaterThan(0.85);
  (screen.getByRole("textbox", { name: "Second prompt" }).element() as HTMLElement).focus();
  expect(activeLight.style.getPropertyValue("--turbo")).toBe("");
  expect(backdrop.style.getPropertyValue("--ghost-turbo")).toBe("");
  expect(vi.getTimerCount()).toBe(0);
});
