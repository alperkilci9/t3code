import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopConfig from "./DesktopConfig.ts";

const defaultInput = {
  dirname: "/repo/apps/desktop/dist-electron",
  homeDirectory: "/Users/alice",
  platform: "darwin",
  processArch: "arm64",
  appVersion: "0.0.22",
  appPath: "/Applications/T3 Code.app/Contents/Resources/app.asar",
  isPackaged: false,
  resourcesPath: "/Applications/T3 Code.app/Contents/Resources",
  runningUnderArm64Translation: false,
} satisfies DesktopEnvironment.MakeDesktopEnvironmentInput;

const layerEnvironment = (
  overrides: Partial<DesktopEnvironment.MakeDesktopEnvironmentInput> = {},
  env: Record<string, string | undefined> = {},
) =>
  DesktopEnvironment.layer({
    ...defaultInput,
    ...overrides,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(NodeServices.layer, NodePath.layerPosix, DesktopConfig.layerTest(env)),
    ),
  );

const makeEnvironment = (
  overrides: Partial<DesktopEnvironment.MakeDesktopEnvironmentInput> = {},
  env: Record<string, string | undefined> = {},
) => DesktopEnvironment.DesktopEnvironment.pipe(Effect.provide(layerEnvironment(overrides, env)));

describe("DesktopEnvironment", () => {
  it.effect("uses the packaged Windows server sidecar as the backend root", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment({
        platform: "win32",
        isPackaged: true,
        appPath: "/install/resources/app.asar",
        resourcesPath: "/install/resources",
      });

      assert.equal(environment.appRoot, "/install/resources/app.asar");
      assert.equal(environment.serverRoot, "/install/resources/server.asar");
      assert.equal(
        environment.backendEntryPath,
        "/install/resources/server.asar/apps/server/dist/bin.mjs",
      );
      assert.equal(
        environment.clientAssetsDir,
        "/install/resources/server.asar/apps/server/dist/client",
      );
    }),
  );

  it.effect("keeps Lab development and production state isolated from T3", () =>
    Effect.gen(function* () {
      const development = yield* makeEnvironment(
        {},
        { VITE_DEV_SERVER_URL: "http://localhost:5173" },
      );
      const production = yield* makeEnvironment();

      assert.equal(development.baseDir, "/Users/alice/.studyworkspace-lab");
      assert.equal(production.baseDir, "/Users/alice/.studyworkspace-lab");
      assert.equal(development.stateDir, "/Users/alice/.studyworkspace-lab/dev");
      assert.equal(production.stateDir, "/Users/alice/.studyworkspace-lab/userdata");
      assert.equal(development.appUserModelId, "com.studyworkspace.lab.dev");
      assert.equal(production.appUserModelId, "com.studyworkspace.lab");
      assert.equal(development.linuxDesktopEntryName, "com.studyworkspace.Lab.Development.desktop");
      assert.equal(production.linuxDesktopEntryName, "com.studyworkspace.Lab.desktop");
      const inherited = yield* makeEnvironment({}, { T3CODE_HOME: "/Users/alice/.t3" });
      assert.equal(inherited.baseDir, "/Users/alice/.studyworkspace-lab");
      const explicit = yield* makeEnvironment({}, { STUDYWORKSPACE_LAB_HOME: " /isolated/lab " });
      assert.equal(explicit.baseDir, "/isolated/lab");
      assert.equal(explicit.stateDir, "/isolated/lab/userdata");
    }),
  );
});
