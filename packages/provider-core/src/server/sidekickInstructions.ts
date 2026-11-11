import type { ModelSelection } from "@t3tools/contracts";

export function buildSidekickInstructions(
  configuration: ModelSelection["sidekick"] | undefined,
  options?: { readonly previouslyEnabled?: boolean },
): string | null {
  if (configuration?.enabled !== true) {
    if (options?.previouslyEnabled === true) {
      return `<t3_sidekick_mode>
Sidekick mode is now OFF for this turn. Ignore any earlier <t3_sidekick_mode> target in this thread and handle the request directly unless the user explicitly asks to delegate.
</t3_sidekick_mode>`;
    }
    return null;
  }
  const { instanceId, model, options: targetOptions } = configuration.selection;
  const target = JSON.stringify({
    providerInstanceId: instanceId,
    model,
    ...(targetOptions === undefined ? {} : { options: targetOptions }),
  });
  return `<t3_sidekick_mode>
You are the lead model in a lead + sidekick session. Active sidekick target for THIS turn (overrides any earlier <t3_sidekick_mode> in this thread): ${target}

- Own planning, difficult reasoning, design decisions, correctness-critical investigation, final review and the response to the user.
- Delegate mechanical implementation, routine edits, builds and tests to the sidekick with delegate_task (calling orchestrator_capabilities once per thread first if not yet called). Use the exact target above, role "implementation", isolation "shared", and mode "wait" when its result is needed.
- Give the sidekick a self-contained brief: relevant files, constraints, exact acceptance criteria, and what not to change. Do not ask it to make the lead's design decisions or perform the final review.
- Inspect the sidekick's diff and verify its report before finishing. Run any remaining checks yourself or delegate a focused follow-up to the same sidekick.
- For questions, explanations and tasks with no implementation work, answer directly without starting a sidekick. Small review findings may be fixed directly.
- Cross-provider and cross-family pairings are supported. Never substitute a native subagent tool, another provider, another model or different effort. If the sidekick cannot run, explain that and continue with the safest available path.
</t3_sidekick_mode>`;
}

export function promptWithSidekickInstructions(input: {
  readonly prompt: string;
  readonly sidekick: ModelSelection["sidekick"] | undefined;
  readonly previouslyEnabled?: boolean;
}): string {
  const instructions = buildSidekickInstructions(
    input.sidekick,
    input.previouslyEnabled === undefined
      ? undefined
      : { previouslyEnabled: input.previouslyEnabled },
  );
  if (instructions === null || input.prompt.trimStart().startsWith("/")) return input.prompt;
  return `${instructions}\n\nUser message:\n${input.prompt}`;
}
