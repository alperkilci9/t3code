import { describe, expect, it } from "@effect/vitest";
import { ProviderInstanceId } from "@t3tools/contracts";

import {
  buildSidekickInstructions,
  promptWithSidekickInstructions,
} from "./sidekickInstructions.ts";

const sidekick = {
  enabled: true,
  selection: {
    instanceId: ProviderInstanceId.make("cursor"),
    model: "grok-4.7",
    options: [
      { id: "reasoning_effort", value: "high" },
      { id: "fastMode", value: false },
    ],
  },
} as const;

describe("sidekick instructions", () => {
  it("binds the lead to a cross-family sidekick model and effort", () => {
    const instructions = buildSidekickInstructions(sidekick);
    expect(instructions).toContain('"providerInstanceId":"cursor"');
    expect(instructions).toContain('"model":"grok-4.7"');
    expect(instructions).toContain('"id":"reasoning_effort","value":"high"');
    expect(instructions).toContain('"id":"fastMode","value":false');
    expect(instructions).toContain('role "implementation"');
    expect(instructions).toContain("overrides any earlier <t3_sidekick_mode>");
    expect(instructions).toContain("final review");
  });

  it("does not inject when never enabled or when a native slash command must stay first", () => {
    expect(buildSidekickInstructions(undefined)).toBeNull();
    expect(buildSidekickInstructions({ ...sidekick, enabled: false })).toBeNull();
    expect(promptWithSidekickInstructions({ prompt: "/compact", sidekick })).toBe("/compact");
  });

  it("revokes an earlier sidekick pairing on the turn it is switched off", () => {
    const instructions = buildSidekickInstructions(
      { ...sidekick, enabled: false },
      { previouslyEnabled: true },
    );
    expect(instructions).toContain("Sidekick mode is now OFF for this turn");
    expect(instructions).toContain("Ignore any earlier <t3_sidekick_mode>");
  });

  it("keeps the user message distinct from the orchestration instruction", () => {
    const prompt = promptWithSidekickInstructions({ prompt: "Implement the change", sidekick });
    expect(prompt).toContain("<t3_sidekick_mode>");
    expect(prompt.endsWith("User message:\nImplement the change")).toBe(true);
  });
});
