import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { resolveUserDataPath } from "./DesktopUserData.ts";

it.effect.each(["darwin", "win32", "linux"] as const)(
  "isolates Lab profiles without importing T3 browser state on %s",
  (platform) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "studyworkspace-profile-" });
      const state = '{"os_crypt":{"encrypted_key":"upstream-key"}}';
      for (const name of ["t3code", "t3code-v2", "T3 Code (Alpha)", "T3 Code (Dev)"]) {
        yield* fs.makeDirectory(path.join(directory, name), { recursive: true });
        yield* fs.writeFileString(path.join(directory, name, "Local State"), state);
      }
      for (const isDevelopment of [false, true]) {
        const destination = yield* resolveUserDataPath({
          appDataDirectory: directory,
          isDevelopment,
          platform,
        });
        assert.equal(
          destination,
          path.join(directory, isDevelopment ? "studyworkspace-lab-dev" : "studyworkspace-lab"),
        );
        assert.isFalse(yield* fs.exists(path.join(destination, "Local State")));
      }
      for (const name of ["t3code", "t3code-v2", "T3 Code (Alpha)", "T3 Code (Dev)"]) {
        assert.equal(yield* fs.readFileString(path.join(directory, name, "Local State")), state);
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
