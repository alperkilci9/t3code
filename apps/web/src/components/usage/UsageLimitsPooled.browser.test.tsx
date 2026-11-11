import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { CHATGPT_USAGE_URL } from "@t3tools/shared/usageLimits";
import { describe, expect, it } from "vite-plus/test";

import { render } from "../../../test/render";
import { UsageLimitsPooled } from "./UsageLimitsPooled";

const checkedAt = "2026-10-25T16:00:00.000Z";

function managedChatGpt(instanceId: string, displayName: string): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(instanceId),
    driver: ProviderDriverKind.make("codex"),
    displayName,
    enabled: true,
    installed: true,
    version: "0.164.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt,
    models: [],
    slashCommands: [],
    skills: [],
    usageLimits: {
      checkedAt,
      windows: [],
      unavailable: { reason: "unsupported", message: "Track usage in ChatGPT." },
      externalUsage: { label: "ChatGPT usage", url: CHATGPT_USAGE_URL },
    },
  };
}

describe("UsageLimitsPooled ChatGPT usage card", () => {
  it("names the managed connections it covers", async () => {
    const presentations = new Map([
      [
        EnvironmentId.make("desk"),
        {
          entry: { target: { label: "Desk" } },
          serverConfig: {
            providers: [
              managedChatGpt("chatgpt_work", "ChatGPT Work"),
              managedChatGpt("chatgpt_personal", "ChatGPT Personal"),
            ],
          },
        },
      ],
    ]);
    await using screen = await render(
      <UsageLimitsPooled presentations={presentations} now={Date.parse(checkedAt)} />,
    );

    await expect
      .element(screen.getByText("ChatGPT Work on Desk, ChatGPT Personal on Desk"))
      .toBeVisible();
    await expect
      .element(screen.getByText("View usage in ChatGPT with your connected account."))
      .toBeVisible();
  });
});

describe("UsageLimitsPooled Devin usage card", () => {
  it("renders Devin ACP Registry daily and weekly windows, dynamic plan tier, redacted email, and billing details", async () => {
    const devinProvider: ServerProvider = {
      instanceId: ProviderInstanceId.make("acpRegistry_devin"),
      driver: ProviderDriverKind.make("acpRegistry"),
      displayName: "Devin",
      iconUrl: "https://cdn.agentclientprotocol.com/registry/v1/latest/devin.svg",
      enabled: true,
      installed: true,
      version: "0.9.4",
      status: "ready",
      auth: {
        status: "authenticated",
        email: "learner@university.edu",
        label: "Devin Pro",
        workspaceId: "org_123",
      },
      checkedAt,
      models: [],
      slashCommands: [],
      skills: [],
      usageLimits: {
        checkedAt,
        credentialFingerprint: "devin-fp-1",
        windows: [
          {
            id: "daily",
            kind: "session",
            label: "Daily",
            usedPercent: 16,
            windowDurationMins: 1440,
            resetsAt: "2026-10-26T04:00:00.000Z",
          },
          {
            id: "weekly",
            kind: "weekly",
            label: "Weekly",
            usedPercent: 35,
            windowDurationMins: 10080,
            resetsAt: "2026-10-30T04:00:00.000Z",
          },
        ],
        details: [
          { id: "extra_usage_balance", label: "Extra usage balance", value: "$12.50" },
          { id: "workspace", label: "Workspace", value: "Study Team" },
          { id: "billing_cycle", label: "Billing cycle", value: "Oct 10 – Nov 10" },
        ],
        externalUsage: {
          label: "Devin Plans & Usage",
          url: "https://app.devin.ai/settings/plans",
        },
      },
    };

    const presentations = new Map([
      [
        EnvironmentId.make("desk"),
        {
          entry: { target: { label: "Desk" } },
          serverConfig: {
            providers: [devinProvider],
          },
        },
      ],
    ]);

    await using screen = await render(
      <UsageLimitsPooled presentations={presentations} now={Date.parse(checkedAt)} />,
    );

    await expect.element(screen.getByRole("heading", { name: "Devin" })).toBeVisible();
    await expect.element(screen.getByText("· Devin Pro")).toBeVisible();
    await expect.element(screen.getByText("Daily")).toBeVisible();
    await expect.element(screen.getByText("84%").first()).toBeVisible();
    await expect.element(screen.getByText("Weekly")).toBeVisible();
    await expect.element(screen.getByText("65%").first()).toBeVisible();
    await expect.element(screen.getByText("Extra usage balance:")).toBeVisible();
    await expect.element(screen.getByText("$12.50")).toBeVisible();
    await expect.element(screen.getByText("Oct 10 – Nov 10")).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Manage usage" })).toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Toggle account email visibility" }))
      .toBeVisible();
  });
});
