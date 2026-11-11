import { describe, expect, it } from "vite-plus/test";

import { deriveWindowPresenceSnapshot, type WindowPeerRecord } from "./windowPresence";

describe("deriveWindowPresenceSnapshot", () => {
  it("assigns deterministic W1/W2 numbers and maps active threads open in sibling windows", () => {
    const nowMs = 100_000;
    const win1: WindowPeerRecord = {
      instanceId: "win-1",
      createdAt: 1_000,
      electronWindowId: 1,
      activeThreadKeys: ["local:thread-a", "local:thread-shared"],
      updatedAt: nowMs - 500,
    };
    const win2: WindowPeerRecord = {
      instanceId: "win-2",
      createdAt: 2_000,
      electronWindowId: 2,
      activeThreadKeys: ["local:thread-b", "local:thread-shared"],
      updatedAt: nowMs - 200,
    };

    const fromWin2 = deriveWindowPresenceSnapshot({
      self: win2,
      peers: [win1],
      nowMs,
    });
    expect(fromWin2.selfWindowNumber).toBe(2);
    expect(fromWin2.selfWindowLabel).toBe("W2");
    expect(fromWin2.openWindowCount).toBe(2);
    expect([...fromWin2.otherWindowThreadKeys]).toEqual(["local:thread-a", "local:thread-shared"]);
    expect(fromWin2.otherWindowBadgesByThreadKey.get("local:thread-a")).toEqual([
      {
        instanceId: "win-1",
        electronWindowId: 1,
        windowNumber: 1,
        label: "W1",
      },
    ]);
    expect(fromWin2.otherWindowBadgesByThreadKey.get("local:thread-b")).toBeUndefined();
  });

  it("drops stale peer windows beyond TTL", () => {
    const nowMs = 100_000;
    const self: WindowPeerRecord = {
      instanceId: "win-2",
      createdAt: 2_000,
      electronWindowId: 2,
      activeThreadKeys: ["local:thread-b"],
      updatedAt: nowMs,
    };
    const stalePeer: WindowPeerRecord = {
      instanceId: "win-1",
      createdAt: 1_000,
      electronWindowId: 1,
      activeThreadKeys: ["local:thread-a"],
      updatedAt: nowMs - 20_000,
    };

    const snapshot = deriveWindowPresenceSnapshot({
      self,
      peers: [stalePeer],
      nowMs,
    });
    expect(snapshot.openWindowCount).toBe(1);
    expect(snapshot.selfWindowLabel).toBe("W1");
    expect(snapshot.otherWindowThreadKeys.size).toBe(0);
  });
});
