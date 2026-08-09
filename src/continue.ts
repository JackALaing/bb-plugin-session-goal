import type { BbPluginApi } from "@bb/plugin-sdk";
import {
  DEFAULT_AUTO_CONTINUE,
  DEFAULT_COOLDOWN_MS,
  DEFAULT_MAX_CONTINUATIONS,
} from "./constants.js";
import { continuationPrompt } from "./format.js";
import { recordContinuation } from "./model.js";
import { nativeOwnsContinuation, syncNativeGoal } from "./native.js";
import type { GoalStore } from "./store.js";

export interface ContinueSettings {
  autoContinue: boolean;
  maxContinuations: number;
  cooldownMs: number;
}

export function normalizeContinueSettings(raw: {
  autoContinue?: boolean;
  maxContinuations?: number;
  cooldownMs?: number;
}): ContinueSettings {
  return {
    autoContinue: raw.autoContinue ?? DEFAULT_AUTO_CONTINUE,
    maxContinuations: Math.max(
      0,
      Math.min(50, raw.maxContinuations ?? DEFAULT_MAX_CONTINUATIONS),
    ),
    cooldownMs: Math.max(
      0,
      Math.min(60_000, raw.cooldownMs ?? DEFAULT_COOLDOWN_MS),
    ),
  };
}

/**
 * If the goal is still active and settings allow, start a continuation turn.
 * Skips when native harness owns the goal (Codex already auto-continues).
 */
export async function maybeAutoContinue(
  bb: BbPluginApi,
  store: GoalStore,
  threadId: string,
  settings: ContinueSettings,
  publish: (threadId: string) => void,
): Promise<{ continued: boolean; reason: string }> {
  if (!settings.autoContinue) {
    return { continued: false, reason: "autoContinue disabled" };
  }
  if (settings.maxContinuations <= 0) {
    return { continued: false, reason: "maxContinuations is 0" };
  }

  // Prefer native truth for this thread.
  const { snapshot, native } = await syncNativeGoal(bb, store, threadId, publish);
  const goal = snapshot.goal;
  if (!goal) {
    return { continued: false, reason: "no goal" };
  }
  if (goal.status !== "active") {
    return { continued: false, reason: `status is ${goal.status}` };
  }
  if (nativeOwnsContinuation(goal) || native) {
    // Harness (e.g. Codex) already continues active native goals.
    return { continued: false, reason: "native harness owns continuation" };
  }
  if (goal.continuationCount >= settings.maxContinuations) {
    return {
      continued: false,
      reason: `max continuations reached (${settings.maxContinuations})`,
    };
  }
  const now = Date.now();
  if (
    goal.lastContinuationAt != null &&
    now - goal.lastContinuationAt < settings.cooldownMs
  ) {
    return { continued: false, reason: "cooldown" };
  }

  const prompt = continuationPrompt(goal);
  try {
    await bb.sdk.threads.send({
      threadId,
      mode: "auto",
      input: [
        {
          type: "text",
          text: prompt,
        },
      ],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    bb.log.warn(`goal auto-continue send failed for ${threadId}: ${message}`);
    return { continued: false, reason: `send failed: ${message}` };
  }

  const updated = recordContinuation(goal, now);
  store.save({ threadId, updatedAt: now, goal: updated });
  publish(threadId);
  bb.log.info(
    `goal auto-continue #${updated.continuationCount} for ${threadId}`,
  );
  return { continued: true, reason: "sent" };
}
