import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProviderInstanceId, type ProviderAuthState } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import * as PtyAdapter from "@t3tools/shared/PtyAdapter";
import { makeClaudeAuth } from "./ClaudeAuth.ts";

const instanceId = ProviderInstanceId.make("claudeAgent_personal");
const layer = Layer.mergeAll(NodeServices.layer, NodeCrypto.layer);

const makeHarness = (options?: { readonly binaryPath?: string; readonly configDir?: string }) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.makeTempDirectoryScoped();
    const configDir = options?.configDir ?? path.join(root, "accounts", "personal");
    const changed: boolean[] = [];
    let spawned: PtyAdapter.PtySpawnInput | undefined;
    let exit: ((event: PtyAdapter.PtyExitEvent) => void) | undefined;
    let data: ((value: string) => void) | undefined;
    let killed = false;
    const written: string[] = [];
    const controller = yield* makeClaudeAuth({
      instanceId,
      enabled: true,
      binaryPath: options?.binaryPath ?? "/bin/claude",
      configDir,
      cwd: root,
      environment: { PATH: process.env.PATH, CLAUDE_CONFIG_DIR: "/Users/me/.claude" },
      onChanged: (signedIn) =>
        Effect.sync(() => {
          changed.push(signedIn);
        }),
    }).pipe(
      Effect.provideService(PtyAdapter.PtyAdapter, {
        spawn: (input) =>
          Effect.sync(() => {
            spawned = input;
            return {
              pid: 1,
              write: (value) => {
                written.push(value);
              },
              resize: () => {},
              kill: () => {
                killed = true;
              },
              onData: (callback) => {
                data = callback;
                return () => {
                  data = undefined;
                };
              },
              onExit: (callback) => {
                exit = callback;
                return () => {
                  exit = undefined;
                };
              },
            };
          }),
      }),
    );
    const state = (predicate: (state: ProviderAuthState) => boolean) =>
      controller
        .subscribe("owner")
        .pipe(Stream.filter(predicate), Stream.runHead, Effect.map(Option.getOrThrow));
    const phase = (value: ProviderAuthState["phase"]) => state((s) => s.phase === value);
    return {
      controller,
      configDir,
      root,
      changed,
      written,
      phase,
      state,
      spawned: () => spawned,
      data: (value: string) => data?.(value),
      exit: (exitCode: number) => exit?.({ exitCode, signal: null }),
      killed: () => killed,
    };
  });

it.effect("binds credentials to the account's own config directory", () =>
  Effect.gen(function* () {
    const a = yield* makeHarness({ configDir: "/accounts/a" });
    const b = yield* makeHarness({ configDir: "/accounts/b" });
    assert.notDeepEqual(a.controller.credentialBinding, b.controller.credentialBinding);
  }).pipe(Effect.scoped, Effect.provide(layer)),
);

it.effect("signs in through a terminal pointed at only this account's directory", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const h = yield* makeHarness();
    const flow = yield* h.controller.start("owner");
    yield* h.phase("waiting");
    const spawned = h.spawned()!;
    assert.strictEqual(spawned.shell, "/bin/claude");
    assert.deepEqual(spawned.args, ["auth", "login", "--claudeai"]);
    assert.strictEqual(spawned.env.CLAUDE_CONFIG_DIR, h.configDir);
    assert.isTrue(yield* fs.exists(h.configDir));

    h.data("Paste code here");
    yield* h.state(
      (s) => s.interaction?.type === "terminal" && s.interaction.output.includes("Paste code"),
    );
    yield* h.controller.respond!("owner", {
      instanceId,
      flowId: flow.flowId!,
      interactionId: "terminal",
      response: { type: "terminal", data: "code\r" },
    });
    assert.deepEqual(h.written, ["code\r"]);

    h.exit(0);
    yield* h.phase("succeeded");
    assert.deepEqual(h.changed, [true]);
  }).pipe(Effect.scoped, Effect.provide(layer)),
);

it.effect("cancel stops the login terminal without changing the account", () =>
  Effect.gen(function* () {
    const h = yield* makeHarness();
    const flow = yield* h.controller.start("owner");
    yield* h.phase("waiting");
    yield* h.controller.cancel("owner", flow.flowId!);
    assert.isTrue(h.killed());
    assert.deepEqual(h.changed, []);
  }).pipe(Effect.scoped, Effect.provide(layer)),
);

it.effect("a failed login does not report the account as signed in", () =>
  Effect.gen(function* () {
    const h = yield* makeHarness();
    yield* h.controller.start("owner");
    yield* h.phase("waiting");
    h.exit(1);
    yield* h.phase("failed");
    assert.deepEqual(h.changed, []);
  }).pipe(Effect.scoped, Effect.provide(layer)),
);

it.effect("sign-out runs against this account's directory only", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.makeTempDirectoryScoped();
    const record = path.join(root, "logout-config-dir");
    const fake = path.join(root, "claude");
    yield* fs.writeFileString(
      fake,
      `#!/bin/sh\nprintf '%s %s|%s' "$1" "$2" "$CLAUDE_CONFIG_DIR" > "${record}"\n`,
    );
    yield* fs.chmod(fake, 0o755);
    const h = yield* makeHarness({ binaryPath: fake });
    yield* h.controller.logout(Effect.void);
    assert.strictEqual(yield* fs.readFileString(record), `auth logout|${h.configDir}`);
    assert.deepEqual(h.changed, [false]);
  }).pipe(Effect.scoped, Effect.provide(layer)),
);
