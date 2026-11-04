import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { DesktopConfig, layerTest } from "./DesktopConfig.ts";

it.effect.each([
  { value: undefined, expected: true },
  { value: "true", expected: true },
  { value: "false", expected: false },
])("keeps Lab app updates disabled by default ($value)", ({ value, expected }) =>
  Effect.gen(function* () {
    const config = yield* DesktopConfig;
    assert.equal(config.disableAutoUpdate, expected);
  }).pipe(Effect.provide(layerTest({ T3CODE_DISABLE_AUTO_UPDATE: value }))),
);
