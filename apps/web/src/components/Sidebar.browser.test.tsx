import { presentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  DEFAULT_CLIENT_SETTINGS,
  type DesktopBridge,
  EnvironmentId,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { openCommandPalette } from "../commandPaletteBus";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { __setClientSettingsForTests, getClientSettings } from "../hooks/useSettings";
import { __setWindowPresenceForTests, setWindowHideOtherThreads } from "../lib/windowPresence";
import { useProjects, useQuietThreadShells, useThreadShell } from "../state/entities";
import { makeThreadFixture } from "../test-fixtures";
import type { Project } from "../types";
import Sidebar from "./Sidebar";
import { SidebarProvider } from "./ui/sidebar";

vi.mock("../state/entities", { spy: true });
vi.mock("../hooks/useHandleNewThread", { spy: true });
vi.mock("../commandPaletteBus", () => ({
  openCommandPalette: vi.fn(),
  isCommandPaletteOpen: () => false,
}));
vi.mock("./sidebar/SidebarChrome", () => ({
  SidebarChromeHeader: () => null,
  SidebarChromeFooter: () => null,
}));

function project(id: string): Project {
  return {
    id: ProjectId.make(id),
    environmentId: EnvironmentId.make("local"),
    title: id,
    workspaceRoot: `/projects/${id}`,
    repositoryIdentity: null,
    defaultModelSelection: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    scripts: [],
  };
}

describe("sidebar header new thread", () => {
  it.each([
    { mode: "normal", count: 2, shift: false, picker: true },
    { mode: "boring", count: 2, shift: false, picker: true },
    { mode: "boring", count: 2, shift: true, picker: false },
    { mode: "boring", count: 1, shift: false, picker: false },
    { mode: "legacy", count: 2, shift: false, picker: false },
  ] as const)("$mode sidebar, $count projects, shift=$shift: picker=$picker", async (scenario) => {
    using stack = new DisposableStack();
    const previousSettings = getClientSettings();
    stack.defer(() => __setClientSettingsForTests(previousSettings));
    __setClientSettingsForTests({
      ...DEFAULT_CLIENT_SETTINGS,
      boringSidebarEnabled: scenario.mode === "boring",
      legacySidebarEnabled: scenario.mode === "legacy",
    });
    const projects = [project("active"), project("idle")].slice(0, scenario.count);
    const currentProjectRef = {
      environmentId: projects[0]!.environmentId,
      projectId: projects[0]!.id,
    };
    const startThread = vi.fn().mockResolvedValue(null);
    vi.mocked(useProjects).mockReturnValue(projects);
    vi.mocked(useHandleNewThread).mockReturnValue({
      activeDraftThread: null,
      activeThread: null,
      defaultProjectRef: currentProjectRef,
      handleNewThread: startThread,
      routeDraftId: null,
      routeThreadRef: null,
    });
    vi.mocked(openCommandPalette).mockClear();
    await using screen = await render(
      <SidebarProvider>
        <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
      </SidebarProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "New thread", exact: true }), {
      modifiers: scenario.shift ? ["Shift"] : [],
    });

    if (scenario.picker) {
      expect(openCommandPalette).toHaveBeenCalledExactlyOnceWith({ open: "new-thread-in" });
      expect(startThread).not.toHaveBeenCalled();
    } else {
      expect(openCommandPalette).not.toHaveBeenCalled();
      expect(startThread).toHaveBeenCalledExactlyOnceWith(currentProjectRef);
    }
  });
});

describe("multi-window sidebar presence and filtering", () => {
  it("renders W1 badge with click-to-focus and hides other-window threads on demand", async () => {
    using stack = new DisposableStack();
    const previousSettings = getClientSettings();
    const previousBridge = window.desktopBridge;
    stack.defer(() => {
      __setWindowPresenceForTests(null);
      setWindowHideOtherThreads(false);
      __setClientSettingsForTests(previousSettings);
      if (previousBridge) {
        window.desktopBridge = previousBridge;
      } else {
        delete window.desktopBridge;
      }
    });

    const focusWindow = vi.fn().mockResolvedValue(true);
    const openNewWindow = vi.fn().mockResolvedValue(undefined);
    window.desktopBridge = {
      ...previousBridge,
      focusWindow,
      openNewWindow,
      getLocalEnvironmentEnabled: () => false,
      getLocalEnvironmentBootstraps: () => [],
    } as unknown as DesktopBridge;

    __setClientSettingsForTests({
      ...DEFAULT_CLIENT_SETTINGS,
      boringSidebarEnabled: false,
      legacySidebarEnabled: false,
    });

    const envId = EnvironmentId.make("local");
    const proj = project("active");
    const shellA = presentThreadShell(
      envId,
      makeThreadFixture({
        id: ThreadId.make("thread-a"),
        projectId: proj.id,
        title: "Monitor One Thread",
      }).source,
    );
    const shellB = presentThreadShell(
      envId,
      makeThreadFixture({
        id: ThreadId.make("thread-b"),
        projectId: proj.id,
        title: "Monitor Two Thread",
      }).source,
    );

    vi.mocked(useProjects).mockReturnValue([proj]);
    vi.mocked(useQuietThreadShells).mockReturnValue([shellA, shellB]);
    vi.mocked(useThreadShell).mockImplementation((ref) => {
      if (ref?.threadId === shellA.id) return shellA;
      if (ref?.threadId === shellB.id) return shellB;
      return null;
    });
    vi.mocked(useHandleNewThread).mockReturnValue({
      activeDraftThread: null,
      activeThread: null,
      defaultProjectRef: { environmentId: envId, projectId: proj.id },
      handleNewThread: vi.fn().mockResolvedValue(null),
      routeDraftId: null,
      routeThreadRef: null,
    });

    __setWindowPresenceForTests({
      selfInstanceId: "win-2",
      selfWindowNumber: 2,
      selfWindowLabel: "W2",
      openWindowCount: 2,
      otherWindowBadgesByThreadKey: new Map([
        [
          "local:thread-a",
          [
            {
              instanceId: "win-1",
              electronWindowId: 1,
              windowNumber: 1,
              label: "W1",
            },
          ],
        ],
      ]),
      otherWindowThreadKeys: new Set(["local:thread-a"]),
    });

    await using screen = await render(
      <SidebarProvider>
        <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
      </SidebarProvider>,
    );

    await expect
      .element(screen.getByRole("button", { name: /Monitor One Thread/ }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: /Monitor Two Thread/ }))
      .toBeInTheDocument();

    const w1Badge = screen.getByTestId("sidebar-window-badge-thread-a-W1");
    await expect.element(w1Badge).toHaveTextContent("W1");
    await userEvent.click(w1Badge);
    expect(focusWindow).toHaveBeenCalledExactlyOnceWith(1);

    const w2ScopeTrigger = screen.getByTestId("sidebar-window-scope-trigger");
    await expect.element(w2ScopeTrigger).toHaveTextContent("W2");
    await userEvent.click(w2ScopeTrigger);

    await userEvent.click(
      page.getByRole("menuitemcheckbox", { name: "Hide threads open in other windows" }),
    );
    await expect
      .element(screen.getByRole("button", { name: /Monitor One Thread/ }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: /Monitor Two Thread/ }))
      .toBeInTheDocument();

    // Base UI MenuCheckboxItem keeps the menu open so users can toggle filters quickly;
    // select "All threads" directly to restore full cross-window thread visibility.
    await userEvent.click(page.getByRole("menuitemcheckbox", { name: "All threads" }));
    await expect
      .element(screen.getByRole("button", { name: /Monitor One Thread/ }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: /Monitor Two Thread/ }))
      .toBeInTheDocument();
  });
});
