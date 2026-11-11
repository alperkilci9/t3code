import {
  ANTIGRAVITY_DEFAULT_MODEL,
  DEFAULT_TEXT_GENERATION_MODEL_BY_PROVIDER,
  type EnvironmentId,
  type ModelSelection,
  type ProjectId,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderOptionSelection,
  type ResolvedKeybindingsConfig,
  type ScopedThreadRef,
  type ServerProvider,
  type SidekickConfiguration,
} from "@t3tools/contracts";
import type { EffortDisplay, UnifiedSettings } from "@t3tools/contracts/settings";
import { createModelSelection } from "@t3tools/shared/model";
import { ArrowDownIcon, ArrowRightIcon, BotIcon, WaypointsIcon } from "lucide-react";
import { useState } from "react";

import {
  type DraftId,
  useComposerDraftModelState,
  useComposerDraftStore,
} from "../../composerDraftStore";
import { getAppModelOptionsForInstance, type AppModelOption } from "../../modelSelection";
import {
  isProviderInstancePickerReady,
  shouldShowInstanceBadge,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { Switch } from "../ui/switch";
import { cn } from "~/lib/utils";
import type { ComposerControlSize } from "./ComposerControl";
import { ComposerControl, ComposerControlIcon } from "./ComposerControl";
import {
  ComposerEffortColumn,
  ComposerSpeedFooter,
  describeComposerEffort,
} from "./ComposerModelEffort";
import { getComposerPromptInjectionState, getComposerProviderState } from "./composerProviderState";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
import { ProviderModelPicker } from "./ProviderModelPicker";
import { getDisplayModelName, getTriggerDisplayModelName } from "./providerIconUtils";
import type { TraitsSelectionInput } from "./TraitsPicker";
import { useComposerProviderModel } from "./useComposerProviderModel";

function resolveSelectionModel(
  selection: ModelSelection,
  entries: ReadonlyArray<ProviderInstanceEntry>,
  options: ReadonlyMap<ProviderInstanceId, ReadonlyArray<AppModelOption>>,
) {
  const entry = entries.find((candidate) => candidate.instanceId === selection.instanceId);
  const model =
    options.get(selection.instanceId)?.find((candidate) => candidate.slug === selection.model) ??
    entry?.models.find((candidate) => candidate.slug === selection.model);
  return { entry, model };
}

function modelLabel(
  selection: ModelSelection,
  entries: ReadonlyArray<ProviderInstanceEntry>,
  options: ReadonlyMap<ProviderInstanceId, ReadonlyArray<AppModelOption>>,
) {
  const { model } = resolveSelectionModel(selection, entries, options);
  return model ? getDisplayModelName(model) : selection.model;
}

export function triggerSidekickModelLabel(
  selection: ModelSelection,
  leadSelection: ModelSelection,
  entries: ReadonlyArray<ProviderInstanceEntry>,
  options: ReadonlyMap<ProviderInstanceId, ReadonlyArray<AppModelOption>>,
): string {
  const { entry, model } = resolveSelectionModel(selection, entries, options);
  const baseLabel = model ? getTriggerDisplayModelName(model, entry?.driverKind) : selection.model;
  if (!entry || selection.instanceId === leadSelection.instanceId) {
    return baseLabel;
  }
  const { entry: leadEntry, model: leadModel } = resolveSelectionModel(
    leadSelection,
    entries,
    options,
  );
  const leadTriggerLabel = leadModel
    ? getTriggerDisplayModelName(leadModel, leadEntry?.driverKind)
    : leadSelection.model;
  if (
    selection.model === leadSelection.model ||
    baseLabel.toLowerCase() === leadTriggerLabel.toLowerCase()
  ) {
    return `${baseLabel} · ${entry.displayName}`;
  }
  return baseLabel;
}

function normalizeSidekickSelection(
  instanceId: ProviderInstanceId,
  model: string,
  rawOptions: ReadonlyArray<ProviderOptionSelection> | undefined,
  entries: ReadonlyArray<ProviderInstanceEntry>,
): ModelSelection {
  const entry = entries.find((candidate) => candidate.instanceId === instanceId);
  if (!entry) return createModelSelection(instanceId, model, rawOptions);
  const dispatchOptions = getComposerProviderState({
    provider: entry.driverKind,
    model,
    models: entry.models,
    modelOptions: rawOptions,
    planModeEnabled: false,
  }).modelOptionsForDispatch;
  return createModelSelection(instanceId, model, dispatchOptions);
}

const VIRTUAL_DEFAULT_DRIVERS = new Set<string>([
  "cursor",
  "muse",
  "acpRegistry",
  "fx",
  "kiro",
  "pi",
]);

function isSelectableDefaultCandidate(entry: ProviderInstanceEntry, slug: string): boolean {
  if (entry.driverKind === "antigravity" && slug === ANTIGRAVITY_DEFAULT_MODEL) {
    return false;
  }
  if (
    VIRTUAL_DEFAULT_DRIVERS.has(entry.driverKind) &&
    slug === "default" &&
    entry.models.length > 1
  ) {
    return false;
  }
  if (entry.driverKind === "grok" && slug === "grok-build" && entry.models.length > 1) {
    return false;
  }
  return true;
}

function defaultSidekickSelection(
  entries: ReadonlyArray<ProviderInstanceEntry>,
  leadSelection: ModelSelection,
): ModelSelection | null {
  let fallback: ModelSelection | null = null;
  for (const entry of entries) {
    if (!isProviderInstancePickerReady(entry)) continue;
    const selectable = entry.models.filter((candidate) =>
      isSelectableDefaultCandidate(entry, candidate.slug),
    );
    const available = selectable.length > 0 ? selectable : entry.models;
    if (available.length === 0) continue;
    const preferred = DEFAULT_TEXT_GENERATION_MODEL_BY_PROVIDER[entry.driverKind];
    const candidates = [
      available.find((candidate) => candidate.slug === preferred),
      available.find((candidate) => candidate.isDefault),
      ...available,
    ].filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== undefined);
    const distinct = candidates.find(
      (candidate) =>
        entry.instanceId !== leadSelection.instanceId || candidate.slug !== leadSelection.model,
    );
    const chosen = distinct ?? candidates[0];
    if (!chosen) continue;
    const normalized = normalizeSidekickSelection(
      entry.instanceId,
      chosen.slug,
      undefined,
      entries,
    );
    if (distinct) return normalized;
    fallback ??= normalized;
  }
  return fallback;
}

function resolveNormalizedSidekickConfiguration(
  rawSidekick: SidekickConfiguration | undefined,
  entries: ReadonlyArray<ProviderInstanceEntry>,
): SidekickConfiguration | undefined {
  if (!rawSidekick) return undefined;
  return {
    enabled: rawSidekick.enabled,
    selection: normalizeSidekickSelection(
      rawSidekick.selection.instanceId,
      rawSidekick.selection.model,
      rawSidekick.selection.options,
      entries,
    ),
  };
}

export function SidekickControl(props: {
  readonly environmentId: EnvironmentId | null;
  readonly leadSelection: ModelSelection;
  readonly leadEffortDetail: string | null;
  readonly sidekick: SidekickConfiguration | undefined;
  readonly instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<AppModelOption>>;
  readonly keybindings?: ResolvedKeybindingsConfig | undefined;
  readonly effortDisplay: EffortDisplay;
  readonly size: ComposerControlSize;
  readonly disabled: boolean;
  readonly terminalOpen: boolean;
  readonly open?: boolean | undefined;
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
  readonly popupSide?: "top" | "bottom" | undefined;
  readonly popupAlign?: "start" | "end" | undefined;
  readonly triggerClassName?: string | undefined;
  readonly onChange: (configuration: SidekickConfiguration) => void;
  readonly onOpenLeadPicker: () => void;
  readonly onOpenProviderSetup: (instanceId: ProviderInstanceId) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = props.open ?? uncontrolledOpen;
  const setOpen = (nextOpen: boolean) => {
    setUncontrolledOpen(nextOpen);
    props.onOpenChange?.(nextOpen);
  };
  const [rememberedOptions, setRememberedOptions] = useState<
    Readonly<Record<string, ReadonlyArray<ProviderOptionSelection>>>
  >({});
  const enabled = props.sidekick?.enabled === true;
  const selection =
    props.sidekick?.selection ??
    defaultSidekickSelection(props.instanceEntries, props.leadSelection);
  const leadEntry = props.instanceEntries.find(
    (entry) => entry.instanceId === props.leadSelection.instanceId,
  );
  const sidekickEntry = selection
    ? props.instanceEntries.find((entry) => entry.instanceId === selection.instanceId)
    : undefined;
  const sidekickProviderState =
    selection && sidekickEntry
      ? getComposerProviderState({
          provider: sidekickEntry.driverKind,
          model: selection.model,
          models: sidekickEntry.models,
          modelOptions: selection.options,
          planModeEnabled: false,
        })
      : null;
  const sidekickTraits: TraitsSelectionInput | null =
    selection && sidekickEntry && sidekickProviderState
      ? {
          provider: sidekickEntry.driverKind,
          instanceId: selection.instanceId,
          model: selection.model,
          models: sidekickEntry.models,
          modelOptions: selection.options,
          allowPromptInjectedEffort: false,
          planModeEnabled: false,
          onModelOptionsChange: (nextOptions) => {
            const normalized = normalizeSidekickSelection(
              selection.instanceId,
              selection.model,
              nextOptions,
              props.instanceEntries,
            );
            setRememberedOptions((current) => ({
              ...current,
              [`${selection.instanceId}:${selection.model}`]:
                normalized.options ?? nextOptions ?? [],
            }));
            props.onChange({
              enabled: true,
              selection: normalized,
            });
          },
        }
      : null;
  const sidekickEffort = describeComposerEffort(
    sidekickTraits,
    props.effortDisplay,
    props.size === "xs" ? "xs" : "sm",
  );
  const sidekickShortLabel = selection
    ? triggerSidekickModelLabel(
        selection,
        props.leadSelection,
        props.instanceEntries,
        props.modelOptionsByInstance,
      )
    : "Sidekick";
  const leadLabel = modelLabel(
    props.leadSelection,
    props.instanceEntries,
    props.modelOptionsByInstance,
  );
  const showSidekickBadge =
    sidekickEntry !== undefined && shouldShowInstanceBadge(sidekickEntry, props.instanceEntries);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <ComposerControl
            type="button"
            size={props.size}
            aria-pressed={enabled}
            disabled={props.disabled}
            aria-label={
              enabled
                ? [
                    `Sidekick: ${sidekickShortLabel}`,
                    sidekickEntry ? sidekickEntry.displayName : null,
                    sidekickEffort.detail,
                  ]
                    .filter(Boolean)
                    .join(", ")
                : "Sidekick: Off"
            }
            data-chat-sidekick-control="true"
            data-sidekick-enabled={enabled ? "true" : "false"}
            className={cn(
              "max-w-52 shrink-0",
              enabled && "ring-1 ring-inset ring-primary/25",
              props.triggerClassName,
            )}
          />
        }
      >
        {enabled && sidekickEntry ? (
          <ProviderInstanceIcon
            driverKind={sidekickEntry.driverKind}
            displayName={sidekickEntry.displayName}
            accentColor={sidekickEntry.accentColor}
            acpRegistryAgentId={sidekickEntry.acpRegistryAgentId}
            acpRegistryIconUrl={sidekickEntry.acpRegistryIconUrl}
            showBadge={showSidekickBadge}
            className="size-3.5 shrink-0"
            iconClassName="size-3.5"
            indicatorBackground="var(--contrast-input)"
          />
        ) : (
          <ComposerControlIcon icon={WaypointsIcon} />
        )}
        <span data-composer-control-label className="min-w-0 truncate">
          {enabled ? sidekickShortLabel : "Sidekick"}
        </span>
        {enabled ? sidekickEffort.suffix : null}
      </PopoverTrigger>
      <PopoverPopup
        side={props.popupSide ?? "top"}
        align={props.popupAlign ?? "end"}
        padding="none"
        width="lg"
        touchBackdrop
        className="overflow-visible"
      >
        <div className="flex flex-col">
          <div className="flex items-start gap-3 px-4 pt-4 pb-3">
            <div className="min-w-0 flex-1">
              <PopoverTitle>Sidekick</PopoverTitle>
              <p className="mt-1.5 text-muted-foreground text-xs leading-4">
                Lead plans and reviews. Sidekick implements and verifies in the same workspace,
                across any enabled provider or model family.
              </p>
            </div>
            <Switch
              size="sm"
              checked={enabled}
              disabled={props.disabled || selection === null}
              onCheckedChange={(checked) => {
                if (props.sidekick) {
                  props.onChange({
                    enabled: checked,
                    selection: normalizeSidekickSelection(
                      props.sidekick.selection.instanceId,
                      props.sidekick.selection.model,
                      props.sidekick.selection.options,
                      props.instanceEntries,
                    ),
                  });
                } else if (selection) {
                  props.onChange({
                    enabled: checked,
                    selection: normalizeSidekickSelection(
                      selection.instanceId,
                      selection.model,
                      selection.options,
                      props.instanceEntries,
                    ),
                  });
                }
              }}
              aria-label="Enable Sidekick"
            />
          </div>

          <div className="border-t border-border/70 px-3 py-3">
            <div className="rounded-lg border border-border/70 bg-muted/30 p-2.5">
              <div className="flex items-center gap-2.5">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground shadow-sm/5">
                  {leadEntry ? (
                    <ProviderInstanceIcon
                      driverKind={leadEntry.driverKind}
                      displayName={leadEntry.displayName}
                      accentColor={leadEntry.accentColor}
                      acpRegistryAgentId={leadEntry.acpRegistryAgentId}
                      acpRegistryIconUrl={leadEntry.acpRegistryIconUrl}
                      showBadge={shouldShowInstanceBadge(leadEntry, props.instanceEntries)}
                      className="size-4"
                      iconClassName="size-4"
                      indicatorBackground="var(--background)"
                    />
                  ) : (
                    <BotIcon aria-hidden="true" className="size-3.5" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-muted-foreground text-2xs font-medium uppercase tracking-wide">
                    {leadEntry ? `Lead · ${leadEntry.displayName}` : "Lead"}
                  </div>
                  <div className="truncate text-sm">{leadLabel}</div>
                  {props.leadEffortDetail ? (
                    <div className="truncate text-muted-foreground text-xs">
                      {props.leadEffortDetail}
                    </div>
                  ) : null}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setOpen(false);
                    props.onOpenLeadPicker();
                  }}
                >
                  Change
                </Button>
              </div>

              <div className="flex h-6 items-center ps-3.5 text-muted-foreground/60">
                <ArrowDownIcon aria-hidden="true" className="size-3.5" />
              </div>

              <div className="flex items-center gap-2.5">
                <span
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-md bg-background shadow-sm/5",
                    enabled ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  {sidekickEntry ? (
                    <ProviderInstanceIcon
                      driverKind={sidekickEntry.driverKind}
                      displayName={sidekickEntry.displayName}
                      accentColor={sidekickEntry.accentColor}
                      acpRegistryAgentId={sidekickEntry.acpRegistryAgentId}
                      acpRegistryIconUrl={sidekickEntry.acpRegistryIconUrl}
                      showBadge={showSidekickBadge}
                      className="size-4"
                      iconClassName="size-4"
                      indicatorBackground="var(--background)"
                    />
                  ) : (
                    <WaypointsIcon aria-hidden="true" className="size-3.5" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-muted-foreground text-2xs font-medium uppercase tracking-wide">
                    {sidekickEntry ? `Sidekick · ${sidekickEntry.displayName}` : "Sidekick"}
                  </div>
                  {selection ? (
                    <ProviderModelPicker
                      environmentId={props.environmentId}
                      activeInstanceId={selection.instanceId}
                      model={selection.model}
                      lockedProvider={null}
                      instanceEntries={props.instanceEntries}
                      {...(props.keybindings ? { keybindings: props.keybindings } : {})}
                      modelOptionsByInstance={props.modelOptionsByInstance}
                      size="sm"
                      compact
                      isComposerOwned
                      disabled={props.disabled}
                      terminalOpen={props.terminalOpen}
                      triggerAriaLabel="Choose sidekick model and effort"
                      triggerClassName="w-full max-w-none justify-start px-1.5"
                      triggerDetail={sidekickEffort.detail}
                      triggerSuffix={sidekickEffort.suffix}
                      effortColumn={<ComposerEffortColumn traits={sidekickTraits} />}
                      footer={<ComposerSpeedFooter traits={sidekickTraits} />}
                      onInstanceModelChange={(instanceId, model) => {
                        const previousKey = `${selection.instanceId}:${selection.model}`;
                        if (selection.options && selection.options.length > 0) {
                          const savedOptions = selection.options;
                          setRememberedOptions((current) => ({
                            ...current,
                            [previousKey]: savedOptions,
                          }));
                        }
                        const key = `${instanceId}:${model}`;
                        const remembered =
                          (instanceId === selection.instanceId && model === selection.model
                            ? selection.options
                            : undefined) ??
                          rememberedOptions[key] ??
                          useComposerDraftStore.getState().stickyOptionsByModelByProvider[
                            instanceId
                          ]?.[model];
                        props.onChange({
                          enabled: true,
                          selection: normalizeSidekickSelection(
                            instanceId,
                            model,
                            remembered,
                            props.instanceEntries,
                          ),
                        });
                      }}
                      onOpenProviderSetup={props.onOpenProviderSetup}
                    />
                  ) : (
                    <div className="text-muted-foreground text-sm">No provider available</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-border/70 bg-muted/40 px-4 py-2.5 text-muted-foreground text-xs">
            Applies to the next message. Any provider or model family can pair together.
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}

/**
 * Compact Lead + Sidekick pairing bar displayed directly under the chat header so users can
 * inspect, toggle, and reconfigure Lead and Sidekick models/efforts without scrolling.
 */
export function ChatHeaderSidekickBar(props: {
  readonly environmentId: EnvironmentId;
  readonly composerDraftTarget: ScopedThreadRef | DraftId;
  readonly providerStatuses: ReadonlyArray<ServerProvider>;
  readonly settings: UnifiedSettings;
  readonly activeProjectId: ProjectId | null;
  readonly activeRuntimeProviderInstanceId: ProviderInstanceId | null | undefined;
  readonly threadModelSelection: ModelSelection | null | undefined;
  readonly projectModelSelection: ModelSelection | null | undefined;
  readonly lockedProvider: ProviderDriverKind | null;
  readonly keybindings?: ResolvedKeybindingsConfig | undefined;
  readonly terminalOpen: boolean;
  readonly disabled: boolean;
  readonly onOpenLeadPicker: () => void;
  readonly onFocusComposer: () => void;
  readonly onOpenProviderSetup: (instanceId: ProviderInstanceId) => void;
}) {
  const draftModelState = useComposerDraftModelState(props.composerDraftTarget);
  const {
    providerInstanceEntries,
    selectedProviderEntry,
    selectedInstanceId,
    selectedProvider,
    selectedProviderModels,
    composerModelOptions,
    selectedModel,
    composerProviderState,
  } = useComposerProviderModel({
    providerStatuses: props.providerStatuses,
    settings: props.settings,
    activeProjectId: props.activeProjectId,
    threadRef: props.composerDraftTarget,
    threadModelSelection: props.threadModelSelection,
    projectModelSelection: props.projectModelSelection,
    promptInjectionState: getComposerPromptInjectionState(""),
    candidateInstanceIds: [
      draftModelState.activeProvider ?? null,
      props.activeRuntimeProviderInstanceId,
      props.threadModelSelection?.instanceId,
      props.projectModelSelection?.instanceId,
    ],
    lockedProvider: props.lockedProvider,
    lockedInstanceId:
      props.activeRuntimeProviderInstanceId ?? props.threadModelSelection?.instanceId,
  });

  if (!selectedProviderEntry) {
    return null;
  }

  const draftSidekick =
    draftModelState.modelSelectionByProvider[selectedInstanceId]?.sidekick ??
    (draftModelState.activeProvider
      ? draftModelState.modelSelectionByProvider[draftModelState.activeProvider]?.sidekick
      : undefined);
  const rawSidekick =
    draftSidekick ?? props.threadModelSelection?.sidekick ?? props.projectModelSelection?.sidekick;
  const resolvedSidekick = resolveNormalizedSidekickConfiguration(
    rawSidekick,
    providerInstanceEntries,
  );
  const leadSelection = createModelSelection(
    selectedInstanceId,
    selectedModel,
    composerProviderState.modelOptionsForDispatch,
    resolvedSidekick,
  );

  const modelOptionsByInstance = new Map<ProviderInstanceId, ReadonlyArray<AppModelOption>>();
  for (const entry of providerInstanceEntries) {
    const activeForEntry =
      entry.instanceId === selectedInstanceId
        ? selectedModel
        : entry.instanceId === resolvedSidekick?.selection.instanceId
          ? resolvedSidekick.selection.model
          : null;
    modelOptionsByInstance.set(
      entry.instanceId,
      getAppModelOptionsForInstance(props.settings, entry, activeForEntry),
    );
  }

  const leadTraits: TraitsSelectionInput = {
    provider: selectedProvider,
    instanceId: selectedInstanceId,
    model: selectedModel,
    models: selectedProviderModels,
    modelOptions: composerModelOptions?.[selectedInstanceId],
    allowPromptInjectedEffort: false,
    planModeEnabled: props.settings.planModeEnabled,
    onModelOptionsChange: () => {
      props.onOpenLeadPicker();
    },
  };
  const leadEffort = describeComposerEffort(leadTraits, props.settings.effortDisplay, "xs");
  const leadCatalogModel =
    modelOptionsByInstance.get(selectedInstanceId)?.find((m) => m.slug === selectedModel) ??
    selectedProviderEntry.models.find((m) => m.slug === selectedModel);
  const leadShortLabel = leadCatalogModel
    ? getTriggerDisplayModelName(leadCatalogModel, selectedProviderEntry.driverKind)
    : selectedModel;
  const showLeadBadge = shouldShowInstanceBadge(selectedProviderEntry, providerInstanceEntries);

  const enabled = resolvedSidekick?.enabled === true;
  const effectiveSidekickSelection =
    resolvedSidekick?.selection ?? defaultSidekickSelection(providerInstanceEntries, leadSelection);

  const applySidekickConfiguration = (configuration: SidekickConfiguration) => {
    const nextSelection: ModelSelection = {
      ...leadSelection,
      sidekick: configuration,
    };
    const draftStore = useComposerDraftStore.getState();
    draftStore.setModelSelection(props.composerDraftTarget, nextSelection, {
      explicit: true,
      replaceOptions: true,
    });
    draftStore.setStickyModelSelection(nextSelection);
    props.onFocusComposer();
  };

  return (
    <div
      data-chat-header-sidekick-bar="true"
      className="flex min-h-8 shrink-0 flex-wrap items-center gap-1.5 border-b border-border/50 bg-muted/20 px-3 py-1 sm:px-5 [-webkit-app-region:no-drag]"
    >
      <ComposerControl
        type="button"
        size="xs"
        disabled={props.disabled}
        onClick={props.onOpenLeadPicker}
        aria-label={[
          `Lead model: ${leadShortLabel}`,
          selectedProviderEntry.displayName,
          leadEffort.detail,
        ]
          .filter(Boolean)
          .join(", ")}
        data-chat-header-lead-trigger="true"
        className="max-w-52 shrink-0"
      >
        <ProviderInstanceIcon
          driverKind={selectedProviderEntry.driverKind}
          displayName={selectedProviderEntry.displayName}
          accentColor={selectedProviderEntry.accentColor}
          acpRegistryAgentId={selectedProviderEntry.acpRegistryAgentId}
          acpRegistryIconUrl={selectedProviderEntry.acpRegistryIconUrl}
          showBadge={showLeadBadge}
          className="size-3.5 shrink-0"
          iconClassName="size-3.5"
          indicatorBackground="var(--contrast-input)"
        />
        <span className="truncate text-muted-foreground text-3xs font-medium uppercase tracking-wide">
          Lead
        </span>
        <span className="min-w-0 truncate">{leadShortLabel}</span>
        {leadEffort.suffix}
      </ComposerControl>

      <ArrowRightIcon
        aria-hidden="true"
        className={cn(
          "size-3 shrink-0 transition-colors",
          enabled ? "text-primary/80" : "text-muted-foreground/45",
        )}
      />

      <SidekickControl
        environmentId={props.environmentId}
        leadSelection={leadSelection}
        leadEffortDetail={leadEffort.detail}
        sidekick={resolvedSidekick}
        instanceEntries={providerInstanceEntries}
        modelOptionsByInstance={modelOptionsByInstance}
        {...(props.keybindings ? { keybindings: props.keybindings } : {})}
        effortDisplay={props.settings.effortDisplay}
        size="xs"
        disabled={props.disabled}
        terminalOpen={props.terminalOpen}
        popupSide="bottom"
        popupAlign="start"
        onChange={applySidekickConfiguration}
        onOpenLeadPicker={props.onOpenLeadPicker}
        onOpenProviderSetup={props.onOpenProviderSetup}
      />

      <label className="ms-1 inline-flex cursor-pointer items-center gap-1.5 text-muted-foreground text-xs select-none hover:text-foreground">
        <Switch
          size="sm"
          checked={enabled}
          disabled={props.disabled || effectiveSidekickSelection === null}
          onCheckedChange={(checked) => {
            if (!effectiveSidekickSelection) return;
            applySidekickConfiguration({
              enabled: checked,
              selection: normalizeSidekickSelection(
                effectiveSidekickSelection.instanceId,
                effectiveSidekickSelection.model,
                effectiveSidekickSelection.options,
                providerInstanceEntries,
              ),
            });
          }}
          aria-label="Toggle Sidekick in header"
        />
        <span className="hidden text-2xs sm:inline">
          {enabled ? "Sidekick On" : "Sidekick Off"}
        </span>
      </label>
    </div>
  );
}
