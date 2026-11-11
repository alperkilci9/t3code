import * as HostProcess from "@t3tools/shared/HostProcess";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientError from "effect/http/HttpClientError";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import {
  devinUserStatusToAccountSnapshot,
  formatDevinPlanTier,
  isDevinAcpSettings,
  parseDevinCredentialsToml,
  readDevinAccountSnapshot,
} from "./devinUsageLimits.ts";

const checkedAt = "2026-11-11T00:00:00.000Z";

function makeMemoryFsLayer(files: Readonly<Record<string, string>>) {
  return Layer.mergeAll(
    Path.layer,
    Layer.succeed(HostProcess.Platform, "darwin"),
    Layer.succeed(HostProcess.HomeDirectory, "/Users/tester"),
    FileSystem.layerNoop({
      readFileString: (filePath) =>
        Object.hasOwn(files, filePath)
          ? Effect.succeed(files[filePath]!)
          : Effect.fail(
              PlatformError.systemError({
                _tag: "NotFound",
                module: "FileSystem",
                method: "readFileString",
                pathOrDescriptor: filePath,
              }),
            ),
    }),
  );
}

describe("devinUsageLimits", () => {
  it("identifies Devin ACP Registry settings for registry and local executables", () => {
    expect(isDevinAcpSettings({ source: "registry", agentId: "devin", commandPath: "" })).toBe(
      true,
    );
    expect(isDevinAcpSettings({ source: "registry", agentId: "goose", commandPath: "" })).toBe(
      false,
    );
    expect(
      isDevinAcpSettings({
        source: "local",
        agentId: "",
        commandPath: "/opt/homebrew/bin/devin",
      }),
    ).toBe(true);
    expect(
      isDevinAcpSettings({
        source: "local",
        agentId: "",
        commandPath: "C:\\Tools\\devin.exe",
      }),
    ).toBe(true);
    expect(
      isDevinAcpSettings({
        source: "local",
        agentId: "devin",
        commandPath: "/usr/local/bin/other-agent",
      }),
    ).toBe(false);
  });

  it("parses top-level Devin credentials.toml keys while ignoring comments and tables", () => {
    const parsed = parseDevinCredentialsToml(`
      # Stored by devin auth login
      windsurf_api_key = "sk-ws-test-123"
      api_server_url = "https://server.codeium.com"
      devin_webapp_host = 'app.devin.ai'

      [extra]
      windsurf_api_key = "ignored-table-key"
    `);
    expect(parsed).toEqual({
      windsurfApiKey: "sk-ws-test-123",
      apiServerUrl: "https://server.codeium.com",
      devinWebappHost: "app.devin.ai",
    });
  });

  it("formats Devin plan tiers dynamically without hardcoding plan names", () => {
    expect(formatDevinPlanTier("TEAMS_TIER_DEVIN_PRO", "Pro")).toBe("Devin Pro");
    expect(formatDevinPlanTier("TEAMS_TIER_DEVIN_MAX", "Max")).toBe("Devin Max");
    expect(formatDevinPlanTier("TEAMS_TIER_DEVIN_TEAMS_V2", "Teams")).toBe("Devin Teams");
    expect(formatDevinPlanTier("TEAMS_TIER_ENTERPRISE_SAAS", undefined)).toBe("Enterprise SaaS");
    expect(formatDevinPlanTier("TEAMS_TIER_UNSPECIFIED", "Custom Plan")).toBe("Custom Plan");
  });

  it("maps BILLING_STRATEGY_QUOTA daily and weekly windows, pace durations, and extra balance", () => {
    const snapshot = devinUserStatusToAccountSnapshot({
      checkedAt,
      credentialSeed: "seed-1",
      webappHost: "app.devin.ai",
      response: {
        userStatus: {
          userId: "user-42",
          email: "student@example.edu",
          teamId: "team-99",
          teamsTier: "TEAMS_TIER_DEVIN_PRO",
          planStatus: {
            planInfo: {
              teamsTier: "TEAMS_TIER_DEVIN_PRO",
              planName: "Pro",
              billingStrategy: "BILLING_STRATEGY_QUOTA",
              devinInfo: {
                orgId: "org-99",
                accountDisplayName: "Study Team",
                personalAnalyticsUrl: "",
              },
            },
            planStart: "2026-11-10T22:38:03Z",
            planEnd: "2026-12-10T22:38:03Z",
            dailyQuotaRemainingPercent: 84,
            weeklyQuotaRemainingPercent: 65,
            dailyQuotaResetAtUnix: "1794456000",
            weeklyQuotaResetAtUnix: "1794888000",
            overageBalanceMicros: "12500000",
          },
        },
      },
    });

    expect(snapshot.authenticated).toBe(true);
    expect(snapshot.email).toBe("student@example.edu");
    expect(snapshot.plan).toBe("Devin Pro");
    expect(snapshot.workspaceId).toBe("org-99");
    expect(snapshot.usageLimits.windows).toEqual([
      {
        id: "daily",
        kind: "session",
        label: "Daily",
        usedPercent: 16,
        windowDurationMins: 1440,
        resetsAt: "2026-11-12T04:00:00.000Z",
      },
      {
        id: "weekly",
        kind: "weekly",
        label: "Weekly",
        usedPercent: 35,
        windowDurationMins: 10080,
        resetsAt: "2026-11-17T04:00:00.000Z",
      },
    ]);
    expect(snapshot.usageLimits.details).toEqual([
      { id: "extra_usage_balance", label: "Extra usage balance", value: "$12.50" },
      { id: "workspace", label: "Workspace", value: "Study Team" },
      { id: "billing_cycle", label: "Billing cycle", value: "Nov 10 – Dec 10" },
    ]);
    expect(snapshot.usageLimits.externalUsage).toEqual({
      label: "Devin Plans & Usage",
      url: "https://app.devin.ai/settings/plans",
    });
  });

  it("maps BILLING_STRATEGY_ACU and BILLING_STRATEGY_CREDITS including grace warnings", () => {
    const acuSnapshot = devinUserStatusToAccountSnapshot({
      checkedAt,
      response: {
        userStatus: {
          email: "eng@acme.test",
          teamsTier: "TEAMS_TIER_DEVIN_TEAMS",
          planStatus: {
            planInfo: {
              billingStrategy: "BILLING_STRATEGY_ACU",
              devinInfo: {
                orgId: "org-acme",
                acuConsumed: 15,
                acuLimit: 60,
                dollarsConsumed: 30,
                dollarsLimit: 120,
                personalAnalyticsUrl: "https://app.devin.ai/analytics/me",
              },
            },
            planStart: "2026-11-01T00:00:00Z",
            planEnd: "2026-12-01T00:00:00Z",
          },
        },
      },
    });

    expect(acuSnapshot.plan).toBe("Devin Teams");
    expect(acuSnapshot.usageLimits.windows).toEqual([
      {
        id: "acu",
        kind: "monthly",
        label: "Monthly ACUs",
        usedPercent: 25,
        resetsAt: "2026-12-01T00:00:00.000Z",
        windowDurationMins: 43200,
      },
      {
        id: "spend",
        kind: "monthly",
        label: "Monthly spend",
        usedPercent: 25,
        resetsAt: "2026-12-01T00:00:00.000Z",
        windowDurationMins: 43200,
      },
    ]);
    expect(acuSnapshot.usageLimits.externalUsage?.url).toBe("https://app.devin.ai/analytics/me");

    const creditsSnapshot = devinUserStatusToAccountSnapshot({
      checkedAt,
      response: {
        userStatus: {
          teamsTier: "TEAMS_TIER_DEVIN_MAX",
          planStatus: {
            planInfo: { billingStrategy: "BILLING_STRATEGY_CREDITS" },
            planStart: "2026-11-01T00:00:00Z",
            planEnd: "2026-12-01T00:00:00Z",
            availablePromptCredits: 50000,
            usedPromptCredits: 12500,
            availableFlexCredits: 10000,
            usedFlexCredits: 2500,
            gracePeriodStatus: {
              inGracePeriod: true,
              gracePeriodEnd: "2026-11-18T00:00:00Z",
            },
          },
        },
      },
    });
    expect(creditsSnapshot.plan).toBe("Devin Max");
    expect(creditsSnapshot.usageLimits.windows[0]?.usedPercent).toBe(25);
    expect(creditsSnapshot.usageLimits.details).toContainEqual({
      id: "grace_period",
      label: "Payment status",
      value: "Grace period until Nov 18",
      tone: "warning",
    });
  });

  it.effect("reads credentials.toml and queries SeatManagementService/GetUserStatus", () =>
    Effect.gen(function* () {
      let seenUrl = "";
      let seenApiKey = "";
      const clientLayer = Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) => {
          seenUrl = request.url;
          seenApiKey = request.headers["x-api-key"] ?? "";
          return Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              new Response(
                JSON.stringify({
                  userStatus: {
                    userId: "u-1",
                    email: "dev@example.com",
                    teamsTier: "TEAMS_TIER_DEVIN_PRO",
                    planStatus: {
                      planInfo: { billingStrategy: "BILLING_STRATEGY_QUOTA" },
                      dailyQuotaRemainingPercent: 90,
                      weeklyQuotaRemainingPercent: 80,
                      dailyQuotaResetAtUnix: 1794456000,
                      weeklyQuotaResetAtUnix: 1794888000,
                    },
                  },
                }),
                { status: 200, headers: { "content-type": "application/json" } },
              ),
            ),
          );
        }),
      );

      const snapshot = yield* readDevinAccountSnapshot({ HOME: "/Users/tester" }).pipe(
        Effect.provide(
          Layer.mergeAll(
            makeMemoryFsLayer({
              "/Users/tester/.local/share/devin/credentials.toml":
                'windsurf_api_key = "test-secret"\napi_server_url = "https://server.codeium.com"\n',
            }),
            clientLayer,
          ),
        ),
      );

      expect(seenUrl).toBe(
        "https://server.codeium.com/exa.seat_management_pb.SeatManagementService/GetUserStatus",
      );
      expect(seenApiKey).toBe("test-secret");
      expect(snapshot.authenticated).toBe(true);
      expect(snapshot.plan).toBe("Devin Pro");
      expect(snapshot.usageLimits.windows.map((w) => [w.id, w.usedPercent])).toEqual([
        ["daily", 10],
        ["weekly", 20],
      ]);
    }),
  );

  it.effect("returns unsupported when logged out and probeFailed on transport failure", () =>
    Effect.gen(function* () {
      const noCredsLayer = Layer.mergeAll(
        makeMemoryFsLayer({}),
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make((request) =>
            Effect.fail(
              new HttpClientError.HttpClientError({
                reason: new HttpClientError.TransportError({
                  request,
                  cause: new Error("unreachable"),
                }),
              }),
            ),
          ),
        ),
      );

      const missing = yield* readDevinAccountSnapshot({ HOME: "/Users/tester" }).pipe(
        Effect.provide(noCredsLayer),
      );
      expect(missing.authenticated).toBe(false);
      expect(missing.usageLimits.unavailable?.reason).toBe("unsupported");

      const failingLayer = Layer.mergeAll(
        makeMemoryFsLayer({
          "/Users/tester/.local/share/devin/credentials.toml": 'windsurf_api_key = "test-secret"\n',
        }),
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make((request) =>
            Effect.fail(
              new HttpClientError.HttpClientError({
                reason: new HttpClientError.TransportError({
                  request,
                  cause: new Error("network down"),
                }),
              }),
            ),
          ),
        ),
      );

      const failed = yield* readDevinAccountSnapshot({ HOME: "/Users/tester" }).pipe(
        Effect.provide(failingLayer),
      );
      expect(failed.authenticated).toBe(false);
      expect(failed.usageLimits.unavailable?.reason).toBe("probeFailed");
    }),
  );
});
