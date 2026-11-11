import type { ServerProviderUsageLimits } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as ChildProcess from "effect/process/ChildProcess";

import { resolveSpawnCommand } from "@t3tools/shared/shell";
import {
  AUTH_PROBE_TIMEOUT_MS,
  spawnAndCollect,
} from "@t3tools/provider-core/server/snapshotProbe";
import {
  makeUnavailableUsageLimits,
  makeUsageLimits,
} from "@t3tools/provider-core/server/usageLimits";

import type { MuseSettings } from "../settings.ts";
import { museUsageWindows } from "./usageLimits.ts";

const MuseUsageReport = Schema.Struct({
  allowance: Schema.optionalKey(
    Schema.Struct({
      window: Schema.Struct({ usedPercent: Schema.Finite, resetsAtMs: Schema.Finite }),
      weekly: Schema.Struct({ usedPercent: Schema.Finite, resetsAtMs: Schema.Finite }),
    }),
  ),
});
const decodeUsageReport = Schema.decodeUnknownOption(Schema.fromJsonString(MuseUsageReport));

/** Reads `muse usage --json`; any failure degrades to probeFailed, never to provider error. */
export const readMuseUsageLimits = Effect.fn("readMuseUsageLimits")(function* (
  settings: MuseSettings,
  environment: NodeJS.ProcessEnv,
  cwd?: string,
) {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const result = yield* Effect.gen(function* () {
    const spawnCommand = yield* resolveSpawnCommand(settings.binaryPath, ["usage", "--json"], {
      env: environment,
    });
    return yield* spawnAndCollect(
      settings.binaryPath,
      ChildProcess.make(spawnCommand.command, spawnCommand.args, {
        env: environment,
        shell: spawnCommand.shell,
        ...(cwd ? { cwd } : {}),
      }),
    );
  }).pipe(Effect.timeoutOption(AUTH_PROBE_TIMEOUT_MS), Effect.result);
  const report =
    Result.isSuccess(result) && Option.isSome(result.success) && result.success.value.code === 0
      ? Option.getOrUndefined(decodeUsageReport(result.success.value.stdout))
      : undefined;
  const allowance = report?.allowance;
  const usageLimits: ServerProviderUsageLimits = allowance
    ? makeUsageLimits({ checkedAt, windows: museUsageWindows(allowance) })
    : makeUnavailableUsageLimits({
        checkedAt,
        reason: "probeFailed",
        message: "Muse Code could not report usage.",
      });
  return usageLimits;
});
