import { useEffect, useSyncExternalStore } from "react";

const WINDOW_PRESENCE_CHANNEL = "t3code:windows";
const WINDOW_INSTANCE_STORAGE_KEY = "t3code:window-instance:v1";
const WINDOW_HIDE_OTHER_THREADS_STORAGE_KEY = "t3code:window-hide-other-threads:v1";
const WINDOW_HEARTBEAT_INTERVAL_MS = 4_000;
const WINDOW_PEER_STALE_MS = 12_000;

export interface WindowPeerRecord {
  readonly instanceId: string;
  readonly createdAt: number;
  readonly electronWindowId: number | null;
  readonly activeThreadKeys: readonly string[];
  readonly updatedAt: number;
}

export interface OtherWindowThreadBadge {
  readonly instanceId: string;
  readonly electronWindowId: number | null;
  readonly windowNumber: number;
  readonly label: string;
}

export interface WindowPresenceSnapshot {
  readonly selfInstanceId: string;
  readonly selfWindowNumber: number;
  readonly selfWindowLabel: string;
  readonly openWindowCount: number;
  readonly otherWindowBadgesByThreadKey: ReadonlyMap<string, readonly OtherWindowThreadBadge[]>;
  readonly otherWindowThreadKeys: ReadonlySet<string>;
}

type WindowPresenceMessage =
  | { readonly type: "hello"; readonly record: WindowPeerRecord }
  | { readonly type: "state"; readonly record: WindowPeerRecord }
  | { readonly type: "goodbye"; readonly instanceId: string }
  | {
      readonly type: "focus-request";
      readonly targetInstanceId: string;
      readonly threadKey?: string | undefined;
    };

function sanitizeThreadKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && entry.length > 0 && !seen.has(entry)) {
      seen.add(entry);
      out.push(entry);
    }
  }
  return out;
}

function isValidPeerRecord(value: unknown): value is WindowPeerRecord {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.instanceId === "string" &&
    candidate.instanceId.length > 0 &&
    typeof candidate.createdAt === "number" &&
    Number.isFinite(candidate.createdAt) &&
    (candidate.electronWindowId === null ||
      (typeof candidate.electronWindowId === "number" &&
        Number.isFinite(candidate.electronWindowId))) &&
    Array.isArray(candidate.activeThreadKeys) &&
    typeof candidate.updatedAt === "number" &&
    Number.isFinite(candidate.updatedAt)
  );
}

export function deriveWindowPresenceSnapshot(input: {
  readonly self: WindowPeerRecord;
  readonly peers: Iterable<WindowPeerRecord>;
  readonly nowMs: number;
  readonly staleMs?: number | undefined;
}): WindowPresenceSnapshot {
  const staleMs = input.staleMs ?? WINDOW_PEER_STALE_MS;
  const livePeers: WindowPeerRecord[] = [];
  for (const peer of input.peers) {
    if (peer.instanceId === input.self.instanceId) continue;
    if (input.nowMs - peer.updatedAt > staleMs) continue;
    livePeers.push(peer);
  }

  const ordered = [input.self, ...livePeers].toSorted((left, right) => {
    if (left.createdAt !== right.createdAt) {
      return left.createdAt - right.createdAt;
    }
    const leftWinId = left.electronWindowId ?? Number.MAX_SAFE_INTEGER;
    const rightWinId = right.electronWindowId ?? Number.MAX_SAFE_INTEGER;
    if (leftWinId !== rightWinId) {
      return leftWinId - rightWinId;
    }
    return left.instanceId.localeCompare(right.instanceId);
  });

  let selfWindowNumber = 1;
  const badgesByThreadKey = new Map<string, OtherWindowThreadBadge[]>();
  const otherWindowThreadKeys = new Set<string>();

  for (let index = 0; index < ordered.length; index += 1) {
    const entry = ordered[index]!;
    const windowNumber = index + 1;
    const label = `W${windowNumber}`;
    if (entry.instanceId === input.self.instanceId) {
      selfWindowNumber = windowNumber;
      continue;
    }
    const badge: OtherWindowThreadBadge = {
      instanceId: entry.instanceId,
      electronWindowId: entry.electronWindowId,
      windowNumber,
      label,
    };
    for (const threadKey of entry.activeThreadKeys) {
      otherWindowThreadKeys.add(threadKey);
      const bucket = badgesByThreadKey.get(threadKey);
      if (bucket) {
        bucket.push(badge);
      } else {
        badgesByThreadKey.set(threadKey, [badge]);
      }
    }
  }

  return {
    selfInstanceId: input.self.instanceId,
    selfWindowNumber,
    selfWindowLabel: `W${selfWindowNumber}`,
    openWindowCount: ordered.length,
    otherWindowBadgesByThreadKey: badgesByThreadKey,
    otherWindowThreadKeys,
  };
}

function readOrCreateSelfIdentity(): { instanceId: string; createdAt: number } {
  if (typeof window === "undefined") {
    return { instanceId: "ssr-window", createdAt: 0 };
  }
  try {
    const raw = window.sessionStorage.getItem(WINDOW_INSTANCE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { instanceId?: unknown; createdAt?: unknown };
      if (
        typeof parsed.instanceId === "string" &&
        parsed.instanceId.length > 0 &&
        typeof parsed.createdAt === "number" &&
        Number.isFinite(parsed.createdAt)
      ) {
        return { instanceId: parsed.instanceId, createdAt: parsed.createdAt };
      }
    }
  } catch {}

  const bytes = new Uint8Array(8);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  }
  const suffix = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const created = {
    instanceId: `win-${Date.now().toString(36)}-${suffix || Math.random().toString(36).slice(2, 10)}`,
    createdAt: Date.now(),
  };
  try {
    window.sessionStorage.setItem(WINDOW_INSTANCE_STORAGE_KEY, JSON.stringify(created));
  } catch {}
  return created;
}

function readElectronWindowId(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const id = window.desktopBridge?.getWindowId?.();
    return typeof id === "number" && Number.isFinite(id) ? id : null;
  } catch {
    return null;
  }
}

class WindowPresenceController {
  private readonly identity = readOrCreateSelfIdentity();
  private activeThreadKeys: string[] = [];
  private readonly peers = new Map<string, WindowPeerRecord>();
  private readonly listeners = new Set<() => void>();
  private channel: BroadcastChannel | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private snapshot: WindowPresenceSnapshot;
  private testOverride: WindowPresenceSnapshot | null = null;
  private focusListeners = new Set<(threadKey: string | undefined) => void>();

  constructor() {
    this.snapshot = deriveWindowPresenceSnapshot({
      self: this.buildSelfRecord(Date.now()),
      peers: [],
      nowMs: Date.now(),
    });
  }

  private buildSelfRecord(nowMs: number): WindowPeerRecord {
    return {
      instanceId: this.identity.instanceId,
      createdAt: this.identity.createdAt,
      electronWindowId: readElectronWindowId(),
      activeThreadKeys: this.activeThreadKeys,
      updatedAt: nowMs,
    };
  }

  private recompute(nowMs = Date.now()): void {
    for (const [peerId, peer] of this.peers) {
      if (nowMs - peer.updatedAt > WINDOW_PEER_STALE_MS) {
        this.peers.delete(peerId);
      }
    }
    this.snapshot = deriveWindowPresenceSnapshot({
      self: this.buildSelfRecord(nowMs),
      peers: this.peers.values(),
      nowMs,
    });
    for (const listener of this.listeners) {
      listener();
    }
  }

  private post(message: WindowPresenceMessage): void {
    try {
      this.channel?.postMessage(message);
    } catch {}
  }

  private startChannelIfNeeded(): void {
    if (
      this.channel !== null ||
      typeof window === "undefined" ||
      typeof BroadcastChannel === "undefined"
    ) {
      return;
    }
    try {
      const channel = new BroadcastChannel(WINDOW_PRESENCE_CHANNEL);
      this.channel = channel;
      channel.onmessage = (event: MessageEvent<unknown>) => {
        const data = event.data as Partial<WindowPresenceMessage> | null;
        if (!data || typeof data !== "object" || typeof data.type !== "string") return;

        if (data.type === "hello" || data.type === "state") {
          if (!isValidPeerRecord(data.record)) return;
          if (data.record.instanceId === this.identity.instanceId) return;
          const normalizedRecord: WindowPeerRecord = {
            ...data.record,
            activeThreadKeys: sanitizeThreadKeys(data.record.activeThreadKeys),
            updatedAt: Date.now(),
          };
          this.peers.set(normalizedRecord.instanceId, normalizedRecord);
          this.recompute();
          if (data.type === "hello") {
            this.post({ type: "state", record: this.buildSelfRecord(Date.now()) });
          }
          return;
        }

        if (data.type === "goodbye" && typeof data.instanceId === "string") {
          if (this.peers.delete(data.instanceId)) {
            this.recompute();
          }
          return;
        }

        if (data.type === "focus-request" && data.targetInstanceId === this.identity.instanceId) {
          void window.desktopBridge?.revealWindow?.();
          for (const focusListener of this.focusListeners) {
            focusListener(typeof data.threadKey === "string" ? data.threadKey : undefined);
          }
        }
      };

      this.post({ type: "hello", record: this.buildSelfRecord(Date.now()) });
      this.heartbeatTimer = setInterval(() => {
        const now = Date.now();
        this.post({ type: "state", record: this.buildSelfRecord(now) });
        this.recompute(now);
      }, WINDOW_HEARTBEAT_INTERVAL_MS);

      const handleUnload = () => {
        this.post({ type: "goodbye", instanceId: this.identity.instanceId });
      };
      window.addEventListener("pagehide", handleUnload);
      window.addEventListener("beforeunload", handleUnload);
    } catch {
      this.channel = null;
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.startChannelIfNeeded();
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): WindowPresenceSnapshot => {
    return this.testOverride ?? this.snapshot;
  };

  setActiveThreadKeys(nextKeys: readonly string[]): void {
    const sanitized = sanitizeThreadKeys(nextKeys);
    if (
      sanitized.length === this.activeThreadKeys.length &&
      sanitized.every((key, index) => key === this.activeThreadKeys[index])
    ) {
      return;
    }
    this.activeThreadKeys = sanitized;
    this.startChannelIfNeeded();
    const now = Date.now();
    this.post({ type: "state", record: this.buildSelfRecord(now) });
    this.recompute(now);
  }

  focusPeer(badge: OtherWindowThreadBadge, threadKey?: string): void {
    if (
      badge.electronWindowId !== null &&
      typeof window !== "undefined" &&
      typeof window.desktopBridge?.focusWindow === "function"
    ) {
      void window.desktopBridge.focusWindow(badge.electronWindowId);
    }
    this.post({
      type: "focus-request",
      targetInstanceId: badge.instanceId,
      threadKey,
    });
  }

  onFocusRequested(listener: (threadKey: string | undefined) => void): () => void {
    this.focusListeners.add(listener);
    return () => {
      this.focusListeners.delete(listener);
    };
  }

  setTestOverride(override: WindowPresenceSnapshot | null): void {
    this.testOverride = override;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

const controller = new WindowPresenceController();

export function __setWindowPresenceForTests(override: WindowPresenceSnapshot | null): void {
  controller.setTestOverride(override);
}

export function focusOtherWindow(badge: OtherWindowThreadBadge, threadKey?: string): void {
  controller.focusPeer(badge, threadKey);
}

export function useWindowPresence(
  activeThreadKeys: readonly string[],
  onFocusRequested?: (threadKey: string | undefined) => void,
): WindowPresenceSnapshot {
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const serializedKeys = activeThreadKeys.join("\n");
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Broadcasts this window's active thread keys over the external BroadcastChannel window registry.
  useEffect(() => {
    controller.setActiveThreadKeys(serializedKeys ? serializedKeys.split("\n") : []);
  }, [serializedKeys]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Subscribes to cross-window focus requests arriving on the external BroadcastChannel listener until unmount.
  useEffect(() => {
    if (!onFocusRequested) return;
    return controller.onFocusRequested(onFocusRequested);
  }, [onFocusRequested]);
  return snapshot;
}

// Per-window "Hide threads open in other windows" toggle stored in sessionStorage.
let hideOtherWindowThreadsCache: boolean | null = null;
const hideOtherListeners = new Set<() => void>();

function readHideOtherWindowThreads(): boolean {
  if (hideOtherWindowThreadsCache !== null) {
    return hideOtherWindowThreadsCache;
  }
  if (typeof window === "undefined") {
    return false;
  }
  try {
    hideOtherWindowThreadsCache =
      window.sessionStorage.getItem(WINDOW_HIDE_OTHER_THREADS_STORAGE_KEY) === "1";
    return hideOtherWindowThreadsCache;
  } catch {
    hideOtherWindowThreadsCache = false;
    return false;
  }
}

export function setWindowHideOtherThreads(next: boolean): void {
  hideOtherWindowThreadsCache = next;
  if (typeof window !== "undefined") {
    try {
      if (next) {
        window.sessionStorage.setItem(WINDOW_HIDE_OTHER_THREADS_STORAGE_KEY, "1");
      } else {
        window.sessionStorage.removeItem(WINDOW_HIDE_OTHER_THREADS_STORAGE_KEY);
      }
    } catch {}
  }
  for (const listener of hideOtherListeners) {
    listener();
  }
}

function subscribeHideOtherWindowThreads(listener: () => void): () => void {
  hideOtherListeners.add(listener);
  return () => {
    hideOtherListeners.delete(listener);
  };
}

export function useWindowHideOtherThreads(): readonly [boolean, (next: boolean) => void] {
  const value = useSyncExternalStore(
    subscribeHideOtherWindowThreads,
    readHideOtherWindowThreads,
    () => false,
  );
  return [value, setWindowHideOtherThreads] as const;
}
