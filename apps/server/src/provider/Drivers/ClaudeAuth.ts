import { ProviderSetupError, type ProviderInstanceId } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Queue from "effect/Queue";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as ProviderAuthFlow from "@t3tools/provider-core/server/providerAuthFlow";
import * as PtyAdapter from "@t3tools/shared/PtyAdapter";

export const makeClaudeAuth = Effect.fn("ClaudeAuth.make")(function* (options: {
  readonly instanceId: ProviderInstanceId;
  readonly enabled: boolean;
  readonly binaryPath: string;
  readonly configDir: string;
  readonly cwd: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly onChanged: (signedIn: boolean) => Effect.Effect<void, ProviderSetupError>;
}) {
  const pty = yield* PtyAdapter.PtyAdapter;
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const environment = { ...options.environment, CLAUDE_CONFIG_DIR: options.configDir };

  const authenticate = Effect.fn("ClaudeAuth.authenticate")(function* (
    _methodId: string,
    context: ProviderAuthFlow.ProviderAuthFlowContext,
  ) {
    if (!options.enabled)
      return yield* new ProviderSetupError({
        instanceId: options.instanceId,
        operation: "start",
        detail: "Enable Claude before signing in.",
      });
    yield* fs.makeDirectory(options.configDir, { recursive: true, mode: 0o700 }).pipe(
      Effect.mapError(
        (cause) =>
          new ProviderSetupError({
            instanceId: options.instanceId,
            operation: "start",
            detail: "Could not create this Claude account's configuration directory.",
            cause,
          }),
      ),
    );
    yield* Effect.scoped(
      Effect.gen(function* () {
        const exited = yield* Deferred.make<number>();
        const output = yield* Queue.sliding<string>(64);
        const process = yield* pty
          .spawn({
            shell: options.binaryPath,
            args: ["auth", "login", "--claudeai"],
            cwd: options.cwd,
            cols: 80,
            rows: 24,
            env: environment,
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new ProviderSetupError({
                  instanceId: options.instanceId,
                  operation: "start",
                  detail: "Could not open the Claude sign-in terminal.",
                  cause,
                }),
            ),
          );
        const detachData = process.onData((data) => {
          Queue.offerUnsafe(output, data.slice(-16_384));
        });
        const detachExit = process.onExit(({ exitCode }) => {
          Deferred.doneUnsafe(exited, Effect.succeed(exitCode));
        });
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            detachData();
            detachExit();
            try {
              process.kill();
            } catch {}
          }),
        );
        let transcript = "";
        let outputOffset = 0;
        const publishOutput = () =>
          context.setInteraction(
            { type: "terminal", id: "terminal", output: transcript, outputOffset },
            (response) =>
              response.type === "terminal"
                ? Effect.try({
                    try: () => {
                      if (response.size) process.resize(response.size.cols, response.size.rows);
                      if (response.data) process.write(response.data);
                    },
                    catch: () =>
                      new ProviderSetupError({
                        instanceId: options.instanceId,
                        operation: "respond",
                        detail: "The Claude sign-in terminal is no longer available.",
                      }),
                  })
                : Effect.void,
          );
        yield* publishOutput();
        yield* Queue.take(output).pipe(
          Effect.flatMap((data) => {
            outputOffset += data.length;
            transcript = (transcript + data).slice(-16_384);
            return publishOutput();
          }),
          Effect.forever,
          Effect.forkScoped,
        );
        if ((yield* Deferred.await(exited)) !== 0)
          return yield* new ProviderSetupError({
            instanceId: options.instanceId,
            operation: "start",
            detail: "Claude sign-in did not finish successfully. Start sign-in again.",
          });
      }),
    );
    yield* context.verifying;
    yield* options.onChanged(true);
  });

  const logout = Effect.scoped(
    Effect.gen(function* () {
      const process = yield* spawner
        .spawn(
          ChildProcess.make(options.binaryPath, ["auth", "logout"], {
            cwd: options.cwd,
            env: environment,
            extendEnv: false,
            stdin: "ignore",
            stdout: "ignore",
            stderr: "ignore",
          }),
        )
        .pipe(
          Effect.mapError(
            (cause) =>
              new ProviderSetupError({
                instanceId: options.instanceId,
                operation: "logout",
                detail: "Could not start Claude sign-out.",
                cause,
              }),
          ),
        );
      const code = yield* process.exitCode.pipe(
        Effect.mapError(
          (cause) =>
            new ProviderSetupError({
              instanceId: options.instanceId,
              operation: "logout",
              detail: "Could not finish Claude sign-out.",
              cause,
            }),
        ),
      );
      if (code !== 0)
        return yield* new ProviderSetupError({
          instanceId: options.instanceId,
          operation: "logout",
          detail: "Claude sign-out failed. Try again.",
        });
      yield* options.onChanged(false);
    }),
  ).pipe(
    Effect.timeoutOrElse({
      duration: "30 seconds",
      orElse: () =>
        Effect.fail(
          new ProviderSetupError({
            instanceId: options.instanceId,
            operation: "logout",
            detail: "Claude sign-out did not finish in time. Try again.",
          }),
        ),
    }),
  );

  return yield* ProviderAuthFlow.make({
    instanceId: options.instanceId,
    credentialBinding: { owner: "provider", key: `claude:home:${options.configDir}` },
    methods: Effect.succeed([
      { id: "subscription", name: "Claude account", description: null, type: "terminal" as const },
    ]),
    authenticate,
    logout,
  });
});
