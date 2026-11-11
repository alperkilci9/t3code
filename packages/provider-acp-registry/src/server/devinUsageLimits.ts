import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type {
  ServerProviderUsageDetail,
  ServerProviderUsageLimits,
  ServerProviderUsageWindow,
} from "@t3tools/contracts";
import {
  clampPercent,
  makeUnavailableUsageLimits,
  makeUsageLimits,
} from "@t3tools/provider-core/server/usageLimits";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import type { AcpRegistrySettings } from "../settings.ts";

const DEFAULT_DEVIN_API_SERVER_URL = "https://server.codeium.com";
const DEFAULT_DEVIN_WEBAPP_HOST = "app.devin.ai";
const DAILY_WINDOW_DURATION_MINS = 24 * 60;
const WEEKLY_WINDOW_DURATION_MINS = 7 * DAILY_WINDOW_DURATION_MINS;

const NumericValue = Schema.Union([Schema.Number, Schema.String]);

const DevinInfoSchema = Schema.Struct({
  orgId: Schema.optional(Schema.String),
  accountDisplayName: Schema.optional(Schema.String),
  personalAnalyticsUrl: Schema.optional(Schema.String),
  acuConsumed: Schema.optional(Schema.Number),
  acuLimit: Schema.optional(Schema.Number),
  dollarsConsumed: Schema.optional(Schema.Number),
  dollarsLimit: Schema.optional(Schema.Number),
});

const DevinPlanInfoSchema = Schema.Struct({
  teamsTier: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
  planName: Schema.optional(Schema.String),
  billingStrategy: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
  hideDailyQuota: Schema.optional(Schema.Boolean),
  hideWeeklyQuota: Schema.optional(Schema.Boolean),
  monthlyPromptCredits: Schema.optional(NumericValue),
  monthlyFlowCredits: Schema.optional(NumericValue),
  monthlyFlexCreditPurchaseAmount: Schema.optional(NumericValue),
  devinInfo: Schema.optional(DevinInfoSchema),
});

const DevinTopUpStatusSchema = Schema.Struct({
  topUpEnabled: Schema.optional(Schema.Boolean),
  monthlyTopUpAmount: Schema.optional(NumericValue),
  topUpSpent: Schema.optional(NumericValue),
});

const DevinGracePeriodStatusSchema = Schema.Struct({
  inGracePeriod: Schema.optional(Schema.Boolean),
  gracePeriodEnd: Schema.optional(Schema.String),
});

const DevinPlanStatusSchema = Schema.Struct({
  planInfo: Schema.optional(DevinPlanInfoSchema),
  planStart: Schema.optional(Schema.String),
  planEnd: Schema.optional(Schema.String),
  availablePromptCredits: Schema.optional(NumericValue),
  usedPromptCredits: Schema.optional(NumericValue),
  availableFlexCredits: Schema.optional(NumericValue),
  usedFlexCredits: Schema.optional(NumericValue),
  dailyQuotaRemainingPercent: Schema.optional(Schema.Number),
  weeklyQuotaRemainingPercent: Schema.optional(Schema.Number),
  dailyQuotaResetAtUnix: Schema.optional(NumericValue),
  weeklyQuotaResetAtUnix: Schema.optional(NumericValue),
  overageBalanceMicros: Schema.optional(NumericValue),
  topUpStatus: Schema.optional(DevinTopUpStatusSchema),
  gracePeriodStatus: Schema.optional(DevinGracePeriodStatusSchema),
});

export const DevinGetUserStatusResponse = Schema.Struct({
  userStatus: Schema.optional(
    Schema.Struct({
      userId: Schema.optional(Schema.String),
      email: Schema.optional(Schema.String),
      teamId: Schema.optional(Schema.String),
      teamsTier: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
      planStatus: Schema.optional(DevinPlanStatusSchema),
    }),
  ),
});
export type DevinGetUserStatusResponse = typeof DevinGetUserStatusResponse.Type;

export interface DevinCredentials {
  readonly windsurfApiKey?: string | undefined;
  readonly apiServerUrl?: string | undefined;
  readonly devinWebappHost?: string | undefined;
}

export interface DevinAccountSnapshot {
  readonly usageLimits: ServerProviderUsageLimits;
  readonly authenticated: boolean;
  readonly email?: string | undefined;
  readonly plan?: string | undefined;
  readonly workspaceId?: string | undefined;
}

export function isDevinAcpSettings(
  settings: Pick<AcpRegistrySettings, "source" | "agentId" | "commandPath">,
): boolean {
  if (settings.source !== "local") {
    return settings.agentId.trim().toLowerCase() === "devin";
  }
  const executable = settings.commandPath
    .trim()
    .split(/[\\/]/)
    .at(-1)
    ?.replace(/\.(exe|cmd|bat)$/i, "")
    .toLowerCase();
  return executable === "devin";
}

export function parseDevinCredentialsToml(contents: string): DevinCredentials {
  const values = new Map<string, string>();
  let inTable = false;
  for (const rawLine of contents.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("[")) {
      inTable = true;
      continue;
    }
    if (inTable) continue;
    const match = /^([A-Za-z0-9_]+)\s*=\s*(.+)$/.exec(trimmed);
    if (!match) continue;
    const key = match[1]!;
    const rawValue = match[2]!.trim();
    if (rawValue.startsWith('"')) {
      const endQuote = rawValue.indexOf('"', 1);
      if (endQuote > 0) {
        const inner = rawValue.slice(1, endQuote).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
        values.set(key, inner.trim());
      }
    } else if (rawValue.startsWith("'")) {
      const endQuote = rawValue.indexOf("'", 1);
      if (endQuote > 0) {
        values.set(key, rawValue.slice(1, endQuote).trim());
      }
    }
  }
  return {
    windsurfApiKey: values.get("windsurf_api_key") || undefined,
    apiServerUrl: values.get("api_server_url") || undefined,
    devinWebappHost: values.get("devin_webapp_host") || undefined,
  };
}

const UPPERCASE_WORDS = new Set(["API", "ACU", "SSO", "SAAS"]);

export function formatDevinPlanTier(
  teamsTier: string | number | undefined,
  planName: string | undefined,
): string | undefined {
  if (typeof teamsTier === "string") {
    const normalized = teamsTier.trim();
    if (normalized.startsWith("TEAMS_TIER_") && normalized !== "TEAMS_TIER_UNSPECIFIED") {
      const slug = normalized.slice("TEAMS_TIER_".length).replace(/_V\d+$/i, "");
      const words = slug
        .split("_")
        .filter(Boolean)
        .map((part) => {
          const upper = part.toUpperCase();
          if (upper === "SAAS") return "SaaS";
          if (UPPERCASE_WORDS.has(upper)) return upper;
          return upper.slice(0, 1) + upper.slice(1).toLowerCase();
        });
      if (words.length > 0) return words.join(" ");
    }
  }
  const fallback = planName?.trim();
  return fallback ? fallback : undefined;
}

function toFiniteNumber(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function unixSecondsToIso(value: string | number | undefined): string | undefined {
  const seconds = toFiniteNumber(value);
  if (seconds === undefined || seconds <= 0) return undefined;
  const dt = DateTime.make(seconds * 1000);
  return Option.isSome(dt) ? DateTime.formatIso(dt.value) : undefined;
}

function normalizeIsoTimestamp(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const millis = Date.parse(trimmed);
  if (!Number.isFinite(millis) || millis <= 0) return undefined;
  const dt = DateTime.make(millis);
  return Option.isSome(dt) ? DateTime.formatIso(dt.value) : undefined;
}

function cycleDurationMins(
  planStart: string | undefined,
  planEnd: string | undefined,
): number | undefined {
  if (!planStart || !planEnd) return undefined;
  const startMs = Date.parse(planStart);
  const endMs = Date.parse(planEnd);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return undefined;
  }
  const mins = Math.round((endMs - startMs) / 60_000);
  return mins > 0 ? mins : undefined;
}

const SHORT_MONTH_UTC = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

function formatCycleRange(
  planStart: string | undefined,
  planEnd: string | undefined,
): string | undefined {
  if (!planStart || !planEnd) return undefined;
  const startMs = Date.parse(planStart);
  const endMs = Date.parse(planEnd);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return undefined;
  }
  return `${SHORT_MONTH_UTC.format(startMs)} – ${SHORT_MONTH_UTC.format(endMs)}`;
}

function formatCompactQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}

function resolveExternalPlansUrl(
  personalAnalyticsUrl: string | undefined,
  webappHost: string | undefined,
): string {
  const candidate = personalAnalyticsUrl?.trim();
  if (candidate) {
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol === "https:") return parsed.toString();
    } catch {
      // Fall back to the canonical Devin plans page.
    }
  }
  const host = (webappHost?.trim() || DEFAULT_DEVIN_WEBAPP_HOST)
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "");
  return `https://${host || DEFAULT_DEVIN_WEBAPP_HOST}/settings/plans`;
}

function resolveAllowedApiServerUrl(rawUrl: string | undefined): string | null {
  const candidate = (rawUrl?.trim() || DEFAULT_DEVIN_API_SERVER_URL).replace(/\/+$/, "");
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === "https:") return candidate;
    if (
      parsed.protocol === "http:" &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
    ) {
      return candidate;
    }
    return null;
  } catch {
    return null;
  }
}

function hashCredentialSeed(seed: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(`devin:${seed}`))).slice(0, 16);
}

export function devinUserStatusToAccountSnapshot(input: {
  readonly response: DevinGetUserStatusResponse;
  readonly checkedAt: string;
  readonly credentialSeed?: string | undefined;
  readonly webappHost?: string | undefined;
}): DevinAccountSnapshot {
  const userStatus = input.response.userStatus;
  const planStatus = userStatus?.planStatus;
  const planInfo = planStatus?.planInfo;
  const devinInfo = planInfo?.devinInfo;

  const email = userStatus?.email?.trim() || undefined;
  const workspaceId = devinInfo?.orgId?.trim() || userStatus?.teamId?.trim() || undefined;
  const plan = formatDevinPlanTier(
    userStatus?.teamsTier ?? planInfo?.teamsTier,
    planInfo?.planName,
  );
  const credentialFingerprint = hashCredentialSeed(
    userStatus?.userId?.trim() || email || input.credentialSeed || "unknown",
  );
  const externalUsage = {
    label: "Devin Plans & Usage",
    url: resolveExternalPlansUrl(devinInfo?.personalAnalyticsUrl, input.webappHost),
  };

  if (!planStatus) {
    return {
      authenticated: Boolean(userStatus),
      email,
      plan,
      workspaceId,
      usageLimits: {
        ...makeUnavailableUsageLimits({
          checkedAt: input.checkedAt,
          reason: "unsupported",
          message: "Devin did not report plan usage for this account.",
        }),
        credentialFingerprint,
        externalUsage,
      },
    };
  }

  const strategy = planInfo?.billingStrategy;
  const isQuotaStrategy =
    strategy === "BILLING_STRATEGY_QUOTA" ||
    strategy === 3 ||
    ((strategy === undefined || strategy === "BILLING_STRATEGY_UNSPECIFIED" || strategy === 0) &&
      (planStatus.dailyQuotaRemainingPercent !== undefined ||
        planStatus.weeklyQuotaRemainingPercent !== undefined));
  const isAcuStrategy = strategy === "BILLING_STRATEGY_ACU" || strategy === 2;

  const planResetIso = normalizeIsoTimestamp(planStatus.planEnd);
  const billingDurationMins = cycleDurationMins(planStatus.planStart, planStatus.planEnd);

  const windows: ServerProviderUsageWindow[] = [];
  const details: ServerProviderUsageDetail[] = [];

  if (isQuotaStrategy) {
    if (
      !planInfo?.hideDailyQuota &&
      planStatus.dailyQuotaRemainingPercent !== undefined &&
      Number.isFinite(planStatus.dailyQuotaRemainingPercent)
    ) {
      const resetsAt = unixSecondsToIso(planStatus.dailyQuotaResetAtUnix);
      windows.push({
        id: "daily",
        kind: "session",
        label: "Daily",
        usedPercent: clampPercent(100 - planStatus.dailyQuotaRemainingPercent),
        windowDurationMins: DAILY_WINDOW_DURATION_MINS,
        ...(resetsAt ? { resetsAt } : {}),
      });
    }
    if (
      !planInfo?.hideWeeklyQuota &&
      planStatus.weeklyQuotaRemainingPercent !== undefined &&
      Number.isFinite(planStatus.weeklyQuotaRemainingPercent)
    ) {
      const resetsAt = unixSecondsToIso(planStatus.weeklyQuotaResetAtUnix);
      windows.push({
        id: "weekly",
        kind: "weekly",
        label: "Weekly",
        usedPercent: clampPercent(100 - planStatus.weeklyQuotaRemainingPercent),
        windowDurationMins: WEEKLY_WINDOW_DURATION_MINS,
        ...(resetsAt ? { resetsAt } : {}),
      });
    }
    const overageMicros = toFiniteNumber(planStatus.overageBalanceMicros);
    if (overageMicros !== undefined) {
      details.push({
        id: "extra_usage_balance",
        label: "Extra usage balance",
        value: `$${(overageMicros / 1_000_000).toFixed(2)}`,
      });
    }
  } else if (isAcuStrategy) {
    const acuConsumed = devinInfo?.acuConsumed;
    const acuLimit = devinInfo?.acuLimit;
    if (
      acuConsumed !== undefined &&
      acuLimit !== undefined &&
      Number.isFinite(acuConsumed) &&
      Number.isFinite(acuLimit) &&
      acuLimit > 0
    ) {
      windows.push({
        id: "acu",
        kind: "monthly",
        label: "Monthly ACUs",
        usedPercent: clampPercent((acuConsumed / acuLimit) * 100),
        ...(planResetIso ? { resetsAt: planResetIso } : {}),
        ...(billingDurationMins ? { windowDurationMins: billingDurationMins } : {}),
      });
    }
    const dollarsConsumed = devinInfo?.dollarsConsumed;
    const dollarsLimit = devinInfo?.dollarsLimit;
    if (
      dollarsConsumed !== undefined &&
      dollarsLimit !== undefined &&
      Number.isFinite(dollarsConsumed) &&
      Number.isFinite(dollarsLimit) &&
      dollarsLimit > 0
    ) {
      windows.push({
        id: "spend",
        kind: "monthly",
        label: "Monthly spend",
        usedPercent: clampPercent((dollarsConsumed / dollarsLimit) * 100),
        ...(planResetIso ? { resetsAt: planResetIso } : {}),
        ...(billingDurationMins ? { windowDurationMins: billingDurationMins } : {}),
      });
    }
    if (acuConsumed !== undefined && Number.isFinite(acuConsumed)) {
      details.push({
        id: "acu_usage",
        label: "ACU usage",
        value:
          acuLimit && acuLimit > 0
            ? `${formatCompactQuantity(acuConsumed)} / ${formatCompactQuantity(acuLimit)} ACUs`
            : `${formatCompactQuantity(acuConsumed)} ACUs used`,
      });
    }
    if (
      dollarsConsumed !== undefined &&
      Number.isFinite(dollarsConsumed) &&
      (dollarsConsumed > 0 || (dollarsLimit !== undefined && dollarsLimit > 0))
    ) {
      details.push({
        id: "dollar_spend",
        label: "Cycle spend",
        value:
          dollarsLimit && dollarsLimit > 0
            ? `$${dollarsConsumed.toFixed(2)} / $${dollarsLimit.toFixed(2)}`
            : `$${dollarsConsumed.toFixed(2)}`,
      });
    }
  } else {
    const availablePrompt = toFiniteNumber(planStatus.availablePromptCredits);
    const usedPrompt = toFiniteNumber(planStatus.usedPromptCredits) ?? 0;
    if (availablePrompt !== undefined && availablePrompt > 0) {
      windows.push({
        id: "prompt_credits",
        kind: "monthly",
        label: "Prompt credits",
        usedPercent: clampPercent((Math.max(0, usedPrompt) / availablePrompt) * 100),
        ...(planResetIso ? { resetsAt: planResetIso } : {}),
        ...(billingDurationMins ? { windowDurationMins: billingDurationMins } : {}),
      });
      const remainingCredits = Math.max(0, availablePrompt - usedPrompt) / 100;
      details.push({
        id: "prompt_credits",
        label: "Prompt credits",
        value: `${formatCompactQuantity(remainingCredits)} / ${formatCompactQuantity(availablePrompt / 100)} left`,
      });
    } else if (availablePrompt === -1) {
      details.push({
        id: "prompt_credits",
        label: "Prompt credits",
        value: "Unlimited",
      });
    }
    const availableFlex = toFiniteNumber(planStatus.availableFlexCredits);
    const usedFlex = toFiniteNumber(planStatus.usedFlexCredits) ?? 0;
    if (availableFlex !== undefined && availableFlex > 0) {
      const remainingFlex = Math.max(0, availableFlex - usedFlex) / 100;
      details.push({
        id: "addon_credits",
        label: "Add-on credits",
        value: `${formatCompactQuantity(remainingFlex)} left`,
      });
    }
    if (planStatus.topUpStatus?.topUpEnabled) {
      const cap = toFiniteNumber(planStatus.topUpStatus.monthlyTopUpAmount);
      const spent = toFiniteNumber(planStatus.topUpStatus.topUpSpent) ?? 0;
      if (cap !== undefined && cap > 0) {
        details.push({
          id: "auto_top_up",
          label: "Auto top-up",
          value: `$${(spent / 100).toFixed(2)} / $${(cap / 100).toFixed(2)}`,
        });
      }
    }
  }

  const workspaceName = devinInfo?.accountDisplayName?.trim();
  if (workspaceName) {
    details.push({
      id: "workspace",
      label: "Workspace",
      value: workspaceName,
    });
  }
  const cycleRange = formatCycleRange(planStatus.planStart, planStatus.planEnd);
  if (cycleRange) {
    details.push({
      id: "billing_cycle",
      label: "Billing cycle",
      value: cycleRange,
    });
  }
  if (planStatus.gracePeriodStatus?.inGracePeriod) {
    const graceEndMs = planStatus.gracePeriodStatus.gracePeriodEnd
      ? Date.parse(planStatus.gracePeriodStatus.gracePeriodEnd)
      : Number.NaN;
    details.push({
      id: "grace_period",
      label: "Payment status",
      value: Number.isFinite(graceEndMs)
        ? `Grace period until ${SHORT_MONTH_UTC.format(graceEndMs)}`
        : "Payment grace period active",
      tone: "warning",
    });
  }

  const baseLimits =
    windows.length > 0
      ? makeUsageLimits({ checkedAt: input.checkedAt, windows })
      : makeUnavailableUsageLimits({
          checkedAt: input.checkedAt,
          reason: "unsupported",
          message: "Track usage in Devin Plans & Usage.",
        });

  return {
    authenticated: true,
    email,
    plan,
    workspaceId,
    usageLimits: {
      ...baseLimits,
      credentialFingerprint,
      ...(details.length > 0 ? { details } : {}),
      externalUsage,
    },
  };
}

function candidateCredentialsPaths(input: {
  readonly path: Path.Path;
  readonly platform: NodeJS.Platform;
  readonly home: string;
  readonly environment: NodeJS.ProcessEnv;
}): ReadonlyArray<string> {
  const { path, platform, home, environment } = input;
  const candidates: string[] = [];
  const explicit = environment.DEVIN_CREDENTIALS_PATH?.trim();
  if (explicit) candidates.push(explicit);
  const xdgData = environment.XDG_DATA_HOME?.trim() || path.join(home, ".local", "share");
  candidates.push(path.join(xdgData, "devin", "credentials.toml"));
  if (platform === "darwin") {
    candidates.push(path.join(home, "Library", "Application Support", "devin", "credentials.toml"));
  } else if (platform === "win32") {
    const localAppData = environment.LOCALAPPDATA?.trim() || path.join(home, "AppData", "Local");
    const roamingAppData = environment.APPDATA?.trim() || path.join(home, "AppData", "Roaming");
    candidates.push(path.join(localAppData, "devin", "credentials.toml"));
    candidates.push(path.join(roamingAppData, "devin", "credentials.toml"));
  }
  return [...new Set(candidates)];
}

const readStoredDevinCredentials = Effect.fn("readStoredDevinCredentials")(function* (
  environment: NodeJS.ProcessEnv,
) {
  const envKey = environment.WINDSURF_API_KEY?.trim();
  if (envKey) {
    return {
      windsurfApiKey: envKey,
      apiServerUrl: environment.DEVIN_API_SERVER_URL?.trim() || undefined,
      devinWebappHost: environment.DEVIN_WEBAPP_HOST?.trim() || undefined,
    } satisfies DevinCredentials;
  }
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const platform = yield* HostProcess.Platform;
  const home =
    (platform === "win32" ? environment.USERPROFILE : environment.HOME)?.trim() ||
    (yield* HostProcess.HomeDirectory);
  for (const filePath of candidateCredentialsPaths({ path, platform, home, environment })) {
    const raw = yield* fs.readFileString(filePath).pipe(
      Effect.catchTags({
        PlatformError: (error) =>
          error.reason._tag === "NotFound" ? Effect.succeed(null) : Effect.fail(error),
      }),
    );
    if (raw !== null) {
      const parsed = parseDevinCredentialsToml(raw);
      if (parsed.windsurfApiKey) return parsed;
    }
  }
  return {} satisfies DevinCredentials;
});

export const readDevinAccountSnapshot = Effect.fn("readDevinAccountSnapshot")(function* (
  environment: NodeJS.ProcessEnv = process.env,
) {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  return yield* Effect.gen(function* () {
    const credentials = yield* readStoredDevinCredentials(environment);
    const apiKey = credentials.windsurfApiKey?.trim();
    if (!apiKey) {
      return {
        authenticated: false,
        usageLimits: makeUnavailableUsageLimits({
          checkedAt,
          reason: "unsupported",
          message: "Sign in with `devin auth login` to view Devin usage limits.",
        }),
      } satisfies DevinAccountSnapshot;
    }
    const endpoint = resolveAllowedApiServerUrl(credentials.apiServerUrl);
    if (!endpoint) {
      return {
        authenticated: false,
        usageLimits: makeUnavailableUsageLimits({
          checkedAt,
          reason: "unsupported",
          message: "Devin usage limits require an HTTPS API server endpoint.",
        }),
      } satisfies DevinAccountSnapshot;
    }
    const client = yield* HttpClient.HttpClient;
    const response = yield* client.execute(
      HttpClientRequest.post(
        `${endpoint}/exa.seat_management_pb.SeatManagementService/GetUserStatus`,
      ).pipe(
        HttpClientRequest.setHeaders({
          "Content-Type": "application/json",
          "connect-protocol-version": "1",
          "X-Api-Key": apiKey,
        }),
        HttpClientRequest.bodyJsonUnsafe({
          metadata: {
            apiKey,
            ideName: "devin",
            ideVersion: "1.0.0",
            extensionName: "windsurf",
            extensionVersion: "1.0.0",
          },
        }),
      ),
    );
    if (response.status === 401 || response.status === 403) {
      return {
        authenticated: false,
        usageLimits: makeUnavailableUsageLimits({
          checkedAt,
          reason: "unsupported",
          message: "Devin login expired. Sign in again with `devin auth login`.",
        }),
      } satisfies DevinAccountSnapshot;
    }
    const body = yield* HttpClientResponse.schemaBodyJson(DevinGetUserStatusResponse)(
      yield* HttpClientResponse.filterStatusOk(response),
    );
    return devinUserStatusToAccountSnapshot({
      response: body,
      checkedAt,
      credentialSeed: apiKey,
      webappHost: credentials.devinWebappHost,
    });
  }).pipe(
    Effect.timeout("10 seconds"),
    Effect.orElseSucceed((): DevinAccountSnapshot => ({
      authenticated: false,
      usageLimits: makeUnavailableUsageLimits({
        checkedAt,
        reason: "probeFailed",
        message: "Devin could not read usage limits.",
      }),
    })),
  );
});
