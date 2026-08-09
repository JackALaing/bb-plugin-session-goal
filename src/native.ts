import type { BbPluginApi } from "@bb/plugin-sdk";
import { applyNativeSnapshot, type GoalSnapshot, type SessionGoal } from "./model.js";
import type { GoalStore } from "./store.js";

export interface NativeTimelineGoal {
  objective: string;
  status: string;
  tokenBudget: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
}

/**
 * Read provider-native harness goal from the thread timeline (Codex etc.).
 * Returns null when the harness has no goal surface or the call fails.
 */
export async function readNativeGoal(
  bb: BbPluginApi,
  threadId: string,
): Promise<NativeTimelineGoal | null> {
  try {
    const timeline = await bb.sdk.threads.timeline({ threadId });
    const goal = timeline.goal;
    if (!goal || typeof goal.objective !== "string" || !goal.objective.trim()) {
      return null;
    }
    return {
      objective: goal.objective,
      status: String(goal.status),
      tokenBudget: goal.tokenBudget ?? null,
      tokensUsed: goal.tokensUsed ?? 0,
      timeUsedSeconds: goal.timeUsedSeconds ?? 0,
    };
  } catch {
    return null;
  }
}

/**
 * Merge native harness goal into the plugin store for UI + instructions.
 * Returns the effective snapshot after sync.
 */
export async function syncNativeGoal(
  bb: BbPluginApi,
  store: GoalStore,
  threadId: string,
  publish?: (threadId: string) => void,
): Promise<{
  snapshot: GoalSnapshot;
  native: NativeTimelineGoal | null;
  changed: boolean;
}> {
  const native = await readNativeGoal(bb, threadId);
  const current = store.get(threadId);
  const now = Date.now();

  if (!native) {
    // If we were mirroring native and harness cleared, mark complete-ish local mirror off.
    if (current.goal?.source === "native" && current.goal.status === "active") {
      // Native cleared while we still show active native-sourced goal → clear local.
      const cleared = store.clear(threadId, now);
      publish?.(threadId);
      return { snapshot: cleared, native: null, changed: true };
    }
    return { snapshot: current, native: null, changed: false };
  }

  const merged = applyNativeSnapshot(current.goal, native, now);
  const prev = current.goal;
  const changed =
    !prev ||
    prev.text !== merged.text ||
    prev.status !== merged.status ||
    prev.nativeStatus !== merged.nativeStatus ||
    prev.source !== "native";

  if (!changed) {
    return { snapshot: current, native, changed: false };
  }

  const snapshot = store.save({
    threadId,
    updatedAt: now,
    goal: merged,
  });
  publish?.(threadId);
  return { snapshot, native, changed: true };
}

/** True when harness owns continuation (active native goal). */
export function nativeOwnsContinuation(goal: SessionGoal | null): boolean {
  if (!goal) return false;
  return goal.source === "native" && goal.status === "active";
}

/** Clear provider-native goal when abandoning via our tool. */
export async function clearNativeGoal(
  bb: BbPluginApi,
  threadId: string,
): Promise<{ attempted: boolean; ok: boolean; error?: string }> {
  try {
    const native = await readNativeGoal(bb, threadId);
    if (!native) return { attempted: false, ok: true };
    await bb.sdk.threads.clearGoal({ threadId });
    return { attempted: true, ok: true };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
