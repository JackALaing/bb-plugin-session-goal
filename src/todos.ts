import type { BbPluginApi } from "@bb/plugin-sdk";
import { z } from "zod";

const openTodoSummarySchema = z.object({
  snapshot: z
    .object({
      counts: z.object({
        total: z.number(),
        pending: z.number(),
        inProgress: z.number(),
        completed: z.number(),
        cancelled: z.number(),
        blocked: z.number(),
        ready: z.number(),
      }),
    })
    .nullable(),
});

export interface OpenTodoInfo {
  available: boolean;
  open: number;
  inProgress: number;
  blocked: number;
  pending: number;
  total: number;
}

/**
 * Best-effort open-todo counts via the todo plugin RPC.
 * If todo is not installed, available=false.
 */
export async function readOpenTodos(
  bb: BbPluginApi,
  threadId: string,
): Promise<OpenTodoInfo> {
  const empty: OpenTodoInfo = {
    available: false,
    open: 0,
    inProgress: 0,
    blocked: 0,
    pending: 0,
    total: 0,
  };
  try {
    const plugins = await bb.sdk.plugins.list();
    const todo = plugins.plugins?.find(
      (p: { id: string; enabled?: boolean; status?: string }) =>
        p.id === "todo" && p.enabled !== false,
    );
    if (!todo) return empty;

    const result = await bb.sdk.plugins.callRpc({
      pluginId: "todo",
      method: "getTodos",
      input: { threadId },
      outputSchema: openTodoSummarySchema,
    });

    if (!result.snapshot) {
      return { ...empty, available: true };
    }
    const c = result.snapshot.counts;
    const open = c.pending + c.inProgress + c.blocked + (c.ready ?? 0);
    // ready is a subset of pending-ish; avoid double count — use non-terminal only
    const openStrict = c.pending + c.inProgress + c.blocked;
    return {
      available: true,
      open: openStrict,
      inProgress: c.inProgress,
      blocked: c.blocked,
      pending: c.pending,
      total: c.total,
    };
  } catch {
    return empty;
  }
}
