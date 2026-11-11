import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  EnvironmentId,
  type ModelSelection,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type SidekickConfiguration,
  ThreadId,
} from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { createModelCapabilities } from "@t3tools/shared/model";
import { useState } from "react";
import { expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render } from "../../../test/render";
import { useComposerDraftStore } from "../../composerDraftStore";
import type { AppModelOption } from "../../modelSelection";
import { deriveProviderInstanceEntries } from "../../providerInstances";
import { ComposerControlsBar } from "./ComposerControlsBar";
import { runtimeModeConfig } from "./runtimeModeConfig";
import { ChatHeaderSidekickBar, SidekickControl } from "./SidekickControl";

const antigravityInstanceId = ProviderInstanceId.make("antigravity");
const cursorInstanceId = ProviderInstanceId.make("cursor");
const codexInstanceId = ProviderInstanceId.make("codex");

const providerStatuses: ReadonlyArray<ServerProvider> = [
  {
    instanceId: antigravityInstanceId,
    driver: ProviderDriverKind.make("antigravity"),
    displayName: "Antigravity",
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-01-01T00:00:00.000Z",
    models: [
      {
        slug: "gemini-4-carbon",
        name: "Gemini 4 Carbon",
        isCustom: false,
        capabilities: createModelCapabilities({
          optionDescriptors: [
            {
              id: "thinking_level",
              label: "Thinking",
              type: "select",
              currentValue: "high",
              options: [
                { id: "low", label: "Low" },
                { id: "high", label: "High", isDefault: true },
              ],
            },
          ],
        }),
      },
    ],
    slashCommands: [],
    skills: [],
  },
  {
    instanceId: cursorInstanceId,
    driver: ProviderDriverKind.make("cursor"),
    displayName: "Cursor",
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-01-01T00:00:00.000Z",
    models: [
      {
        slug: "default",
        name: "Auto",
        isCustom: false,
        capabilities: createModelCapabilities({ optionDescriptors: [] }),
      },
      {
        slug: "grok-4.7",
        name: "Grok 4.7",
        isCustom: false,
        capabilities: createModelCapabilities({
          optionDescriptors: [
            {
              id: "reasoning_effort",
              label: "Reasoning",
              type: "select",
              currentValue: "medium",
              options: [
                { id: "low", label: "Low" },
                { id: "medium", label: "Medium", isDefault: true },
                { id: "high", label: "High" },
              ],
            },
            {
              id: "fastMode",
              label: "Fast mode",
              type: "boolean",
              currentValue: false,
            },
          ],
        }),
      },
    ],
    slashCommands: [],
    skills: [],
  },
  {
    instanceId: codexInstanceId,
    driver: ProviderDriverKind.make("codex"),
    displayName: "Codex",
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-01-01T00:00:00.000Z",
    models: ["gpt-6-luna", "gpt-6-astra"].map((slug) => ({
      slug,
      name: slug === "gpt-6-luna" ? "GPT-6 Luna" : "GPT-6 Astra",
      isCustom: false,
      capabilities: createModelCapabilities({
        optionDescriptors: [
          {
            id: "reasoningEffort",
            label: "Reasoning",
            type: "select",
            currentValue: "low",
            options: [
              { id: "low", label: "Low", isDefault: true },
              { id: "high", label: "High" },
            ],
          },
        ],
      }),
    })),
    slashCommands: [],
    skills: [],
  },
];
const entries = deriveProviderInstanceEntries(providerStatuses);
const modelOptionsByInstance = new Map<ProviderInstanceId, ReadonlyArray<AppModelOption>>(
  entries.map((entry) => [
    entry.instanceId,
    entry.models.map((model) => ({
      slug: model.slug,
      name: model.name,
      isCustom: model.isCustom,
    })),
  ]),
);
const leadSelection = {
  instanceId: antigravityInstanceId,
  model: "gemini-4-carbon",
  options: [{ id: "thinking_level", value: "high" }],
};

function Harness() {
  const [sidekick, setSidekick] = useState<SidekickConfiguration | undefined>();
  const [leadPickerOpen, setLeadPickerOpen] = useState(false);
  return (
    <>
      <SidekickControl
        environmentId={null}
        leadSelection={leadSelection}
        leadEffortDetail="High"
        sidekick={sidekick}
        instanceEntries={entries}
        modelOptionsByInstance={modelOptionsByInstance}
        effortDisplay="label"
        size="sm"
        disabled={false}
        terminalOpen={false}
        onChange={setSidekick}
        onOpenLeadPicker={() => setLeadPickerOpen(true)}
        onOpenProviderSetup={() => {}}
      />
      <output data-testid="sidekick-enabled">{String(sidekick?.enabled ?? false)}</output>
      <output data-testid="sidekick-provider">{sidekick?.selection.instanceId ?? ""}</output>
      <output data-testid="sidekick-model">{sidekick?.selection.model ?? ""}</output>
      <output data-testid="sidekick-effort">
        {String(
          sidekick?.selection.options?.find(
            (option) => option.id === "reasoning_effort" || option.id === "reasoningEffort",
          )?.value ?? "default",
        )}
      </output>
      <output data-testid="sidekick-fast">
        {String(
          sidekick?.selection.options?.find((option) => option.id === "fastMode")?.value ?? "unset",
        )}
      </output>
      {leadPickerOpen ? <div role="status">Lead picker opened</div> : null}
    </>
  );
}

it("pairs cross-family models (Gemini 4 Carbon lead + Grok 4.7 sidekick) with effort and speed", async () => {
  await using screen = await render(<Harness />);
  await userEvent.click(screen.getByRole("button", { name: "Sidekick: Off" }));

  // Can pick Grok 4.7 directly while Sidekick starts Off — automatically enables it
  await userEvent.click(page.getByRole("button", { name: /Choose sidekick model and effort/ }));
  await userEvent.click(page.getByRole("option", { name: /Grok 4\.7/ }));
  await expect.element(screen.getByTestId("sidekick-enabled")).toHaveTextContent("true");
  await expect.element(screen.getByTestId("sidekick-provider")).toHaveTextContent("cursor");
  await expect.element(screen.getByTestId("sidekick-model")).toHaveTextContent("grok-4.7");
  // Implicit Cursor fastMode=false default is preserved right away
  await expect.element(screen.getByTestId("sidekick-fast")).toHaveTextContent("false");

  // Set Grok 4.7 reasoning effort to High and toggle Fast mode in the speed footer
  await userEvent.click(page.getByRole("radio", { name: "High", exact: true }));
  await userEvent.click(page.getByRole("radio", { name: "Fast", exact: true }));
  await expect.element(screen.getByTestId("sidekick-effort")).toHaveTextContent("high");
  await expect.element(screen.getByTestId("sidekick-fast")).toHaveTextContent("true");

  // Switch across provider families (Cursor -> Codex -> Cursor) — Grok's effort & Fast stay remembered
  await userEvent.click(page.getByRole("button", { name: "Codex", exact: true }));
  await userEvent.click(page.getByRole("option", { name: /GPT-6 Luna/ }));
  await expect.element(screen.getByTestId("sidekick-provider")).toHaveTextContent("codex");
  await expect.element(screen.getByTestId("sidekick-model")).toHaveTextContent("gpt-6-luna");
  await userEvent.click(page.getByRole("button", { name: "Cursor", exact: true }));
  await userEvent.click(page.getByRole("option", { name: /Grok 4\.7/ }));
  await expect.element(screen.getByTestId("sidekick-provider")).toHaveTextContent("cursor");
  await expect.element(screen.getByTestId("sidekick-effort")).toHaveTextContent("high");
  await expect.element(screen.getByTestId("sidekick-fast")).toHaveTextContent("true");
  await userEvent.keyboard("{Escape}");

  // Toggling Sidekick off and back on preserves the full cross-family pairing
  await userEvent.click(page.getByRole("switch", { name: "Enable Sidekick" }));
  await expect.element(screen.getByTestId("sidekick-enabled")).toHaveTextContent("false");
  await userEvent.click(page.getByRole("switch", { name: "Enable Sidekick" }));
  await expect.element(screen.getByTestId("sidekick-enabled")).toHaveTextContent("true");
  await expect.element(screen.getByTestId("sidekick-provider")).toHaveTextContent("cursor");
  await expect.element(screen.getByTestId("sidekick-model")).toHaveTextContent("grok-4.7");
  await expect.element(screen.getByTestId("sidekick-effort")).toHaveTextContent("high");

  await userEvent.click(page.getByRole("button", { name: "Change", exact: true }));
  await expect.element(page.getByText("Lead picker opened", { exact: true })).toBeInTheDocument();
});

it("disambiguates same-slug models across distinct providers (Devin muse-ember + Muse muse-ember)", async () => {
  const devinId = ProviderInstanceId.make("acpRegistry_devin");
  const museId = ProviderInstanceId.make("muse");
  const pairEntries = deriveProviderInstanceEntries([
    {
      instanceId: devinId,
      driver: ProviderDriverKind.make("acpRegistry"),
      displayName: "Devin",
      enabled: true,
      installed: true,
      version: null,
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-01-01T00:00:00.000Z",
      models: [{ slug: "muse-ember", name: "Muse Ember", isCustom: false, capabilities: null }],
      slashCommands: [],
      skills: [],
    },
    {
      instanceId: museId,
      driver: ProviderDriverKind.make("muse"),
      displayName: "Muse",
      enabled: true,
      installed: true,
      version: null,
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-01-01T00:00:00.000Z",
      models: [{ slug: "muse-ember", name: "Muse Ember", isCustom: false, capabilities: null }],
      slashCommands: [],
      skills: [],
    },
  ]);
  const pairOptions = new Map(
    pairEntries.map((entry) => [
      entry.instanceId,
      entry.models.map((m) => ({ slug: m.slug, name: m.name, isCustom: m.isCustom })),
    ]),
  );
  await using screen = await render(
    <SidekickControl
      environmentId={null}
      leadSelection={{ instanceId: devinId, model: "muse-ember" }}
      leadEffortDetail={null}
      sidekick={{
        enabled: true,
        selection: { instanceId: museId, model: "muse-ember" },
      }}
      instanceEntries={pairEntries}
      modelOptionsByInstance={pairOptions}
      effortDisplay="label"
      size="sm"
      disabled={false}
      terminalOpen={false}
      onChange={() => {}}
      onOpenLeadPicker={() => {}}
      onOpenProviderSetup={() => {}}
    />,
  );
  await expect.element(screen.getByText("Ember · Muse")).toBeInTheDocument();
});

it("toggles and configures Sidekick from ChatHeaderSidekickBar and opens Lead picker", async () => {
  const envId = EnvironmentId.make("local");
  const targetRef = scopeThreadRef(envId, ThreadId.make("thread-header-sidekick"));

  function HeaderHarness() {
    const [leadPickerOpenCount, setLeadPickerOpenCount] = useState(0);
    const [focusCount, setFocusCount] = useState(0);
    return (
      <div>
        <ChatHeaderSidekickBar
          environmentId={envId}
          composerDraftTarget={targetRef}
          providerStatuses={providerStatuses}
          settings={{
            ...DEFAULT_UNIFIED_SETTINGS,
            providerInstances: Object.fromEntries(
              providerStatuses.map((provider) => [
                provider.instanceId,
                {
                  driver: provider.driver,
                  enabled: provider.enabled,
                  config: { customModels: [] },
                },
              ]),
            ),
          }}
          activeProjectId={null}
          activeRuntimeProviderInstanceId={antigravityInstanceId}
          threadModelSelection={leadSelection}
          projectModelSelection={null}
          lockedProvider={null}
          keybindings={DEFAULT_RESOLVED_KEYBINDINGS}
          terminalOpen={false}
          disabled={false}
          onOpenLeadPicker={() => setLeadPickerOpenCount((count) => count + 1)}
          onFocusComposer={() => setFocusCount((count) => count + 1)}
          onOpenProviderSetup={() => {}}
        />
        <output data-testid="header-lead-open-count">{String(leadPickerOpenCount)}</output>
        <output data-testid="header-focus-count">{String(focusCount)}</output>
      </div>
    );
  }

  await using screen = await render(<HeaderHarness />);

  // Clicking the Lead button in the header bar opens the Lead model picker
  await userEvent.click(screen.getByRole("button", { name: /Lead model:.*Carbon/ }));
  await expect.element(screen.getByTestId("header-lead-open-count")).toHaveTextContent("1");

  // Toggle Sidekick On directly from the header bar switch
  const headerToggle = screen.getByRole("switch", { name: "Toggle Sidekick in header" });
  await expect.element(headerToggle).toHaveAttribute("aria-checked", "false");
  await userEvent.click(headerToggle);
  await expect.element(headerToggle).toHaveAttribute("aria-checked", "true");
  expect(
    useComposerDraftStore.getState().getComposerDraft(targetRef)?.modelSelectionByProvider[
      antigravityInstanceId
    ]?.sidekick?.enabled,
  ).toBe(true);

  // Open the Sidekick configuration popover directly from the header bar and switch to Codex GPT-6 Astra (High)
  await userEvent.click(screen.getByRole("button", { name: /Sidekick:/ }));
  await userEvent.click(page.getByRole("button", { name: /Choose sidekick model and effort/ }));
  await userEvent.click(page.getByRole("button", { name: "Codex", exact: true }));
  await userEvent.click(page.getByRole("option", { name: /GPT-6 Astra/ }));
  await userEvent.click(page.getByRole("radio", { name: "High", exact: true }));
  await userEvent.keyboard("{Escape}");
  await userEvent.keyboard("{Escape}");

  const savedSidekick = useComposerDraftStore.getState().getComposerDraft(targetRef)
    ?.modelSelectionByProvider[antigravityInstanceId]?.sidekick;
  expect(savedSidekick).toEqual({
    enabled: true,
    selection: {
      instanceId: codexInstanceId,
      model: "gpt-6-astra",
      options: [{ id: "reasoningEffort", value: "high" }],
    },
  });

  // Toggle Sidekick Off from the header switch — selection stays retained while enabled flips false
  await userEvent.click(headerToggle);
  await expect.element(headerToggle).toHaveAttribute("aria-checked", "false");
  expect(
    useComposerDraftStore.getState().getComposerDraft(targetRef)?.modelSelectionByProvider[
      antigravityInstanceId
    ]?.sidekick,
  ).toEqual({
    enabled: false,
    selection: {
      instanceId: codexInstanceId,
      model: "gpt-6-astra",
      options: [{ id: "reasoningEffort", value: "high" }],
    },
  });
});

it("opens Sidekick configuration from ComposerPickerFooter Sidekick slot inside the Lead model picker", async () => {
  const envId = EnvironmentId.make("local");
  const targetRef = scopeThreadRef(envId, ThreadId.make("thread-picker-footer-sidekick"));

  function ControlsHarness() {
    const [modelPickerOpen, setModelPickerOpen] = useState(true);
    const [selection, setSelection] = useState<ModelSelection>(leadSelection);
    return (
      <div>
        <ComposerControlsBar
          environmentId={envId}
          routeKind="server"
          routeThreadRef={targetRef}
          draftId={null}
          selectedProvider={ProviderDriverKind.make("antigravity")}
          selectedInstanceId={antigravityInstanceId}
          selectedModel="gemini-4-carbon"
          selectedProviderModels={providerStatuses[0]!.models}
          composerModelOptions={{
            [antigravityInstanceId]: [{ id: "thinking_level", value: "high" }],
          }}
          reportedModelSelection={null}
          promptUltrathink="none"
          onPromptEdit={() => {}}
          planModeEnabled={false}
          planModeUiEnabled={true}
          effortDisplay="label"
          permissionsShownInStrip={false}
          interactionMode="default"
          compatibleRuntimeMode="full-access"
          defaultRuntimeMode="full-access"
          compatibleRuntimeModeOptions={[
            { mode: "full-access", ...runtimeModeConfig["full-access"] },
          ]}
          toggleInteractionMode={() => {}}
          handleRuntimeModeChange={() => {}}
          composerControlsCollapsed={false}
          composerControlsHidden={false}
          restingHiddenBlockCount={0}
          iconOnlyBlockCount={0}
          showProviderUnavailable={false}
          providerSetupInstanceId={undefined}
          onOpenProviderSetup={() => {}}
          providerCatalogPending={false}
          isSendBusy={false}
          multipleModelsEnabled={false}
          multipleModelSelections={null}
          onMultipleModelSelectionsChange={() => {}}
          selectedModelSelection={selection}
          onSidekickChange={(sidekick) => setSelection((prev) => ({ ...prev, sidekick }))}
          onProviderModelSelect={(instanceId, model) =>
            setSelection((prev) => ({
              instanceId,
              model,
              ...(prev.sidekick ? { sidekick: prev.sidekick } : {}),
            }))
          }
          activeThreadModelSelection={leadSelection}
          selectedModelForPickerWithCustomFallback="gemini-4-carbon"
          lockedProvider={null}
          lockedContinuationGroupKey={null}
          providerInstanceEntries={entries}
          keybindings={DEFAULT_RESOLVED_KEYBINDINGS}
          modelOptionsByInstance={modelOptionsByInstance}
          terminalOpen={false}
          modelPickerOpen={modelPickerOpen}
          onModelPickerOpenChange={setModelPickerOpen}
          modelPickerIconClassName={undefined}
          getModelDisabledReason={() => null}
        />
        <output data-testid="lead-picker-open">{String(modelPickerOpen)}</output>
        <output data-testid="footer-sidekick-model">
          {selection.sidekick?.selection.model ?? "none"}
        </output>
      </div>
    );
  }

  await using screen = await render(<ControlsHarness />);

  const footerSidekickBtn = page.getByRole("button", { name: "Sidekick: Off" }).first();
  await expect.element(page.getByText("Sidekick · Off")).toBeVisible();
  await userEvent.click(page.getByText("Sidekick · Off"));

  // Lead model picker closes and Sidekick configuration popover opens
  await expect.element(screen.getByTestId("lead-picker-open")).toHaveTextContent("false");
  await expect.element(page.getByRole("switch", { name: "Enable Sidekick" })).toBeVisible();

  await userEvent.click(page.getByRole("button", { name: /Choose sidekick model and effort/ }));
  await userEvent.click(page.getByRole("option", { name: /Grok 4\.7/ }));
  await expect.element(screen.getByTestId("footer-sidekick-model")).toHaveTextContent("grok-4.7");
  void footerSidekickBtn;
});
