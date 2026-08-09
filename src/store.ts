import type { BbPluginApi } from "@bb/plugin-sdk";
import {
  emptySnapshot,
  normalizeGoal,
  type GoalSnapshot,
  type SessionGoal,
} from "./model.js";

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS thread_goals (
    thread_id TEXT PRIMARY KEY NOT NULL,
    updated_at INTEGER NOT NULL,
    goal_json TEXT NOT NULL
  )`,
];

export function openGoalStore(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);

  const select = db.prepare(
    `SELECT thread_id, updated_at, goal_json FROM thread_goals WHERE thread_id = ?`,
  );
  const upsert = db.prepare(
    `INSERT INTO thread_goals (thread_id, updated_at, goal_json)
     VALUES (@threadId, @updatedAt, @goalJson)
     ON CONFLICT(thread_id) DO UPDATE SET
       updated_at = excluded.updated_at,
       goal_json = excluded.goal_json`,
  );
  const remove = db.prepare(`DELETE FROM thread_goals WHERE thread_id = ?`);
  const listThreadIds = db.prepare(`SELECT thread_id FROM thread_goals`);

  function get(threadId: string): GoalSnapshot {
    const row = select.get(threadId) as
      | { thread_id: string; updated_at: number; goal_json: string }
      | undefined;
    if (!row) return emptySnapshot(threadId);
    let goal: SessionGoal | null = null;
    try {
      const parsed: unknown = JSON.parse(row.goal_json);
      goal = normalizeGoal(parsed, row.updated_at);
    } catch {
      goal = null;
    }
    if (!goal) return emptySnapshot(threadId, row.updated_at);
    return {
      threadId: row.thread_id,
      updatedAt: row.updated_at,
      goal,
    };
  }

  function save(snapshot: GoalSnapshot): GoalSnapshot {
    if (!snapshot.goal) {
      remove.run(snapshot.threadId);
      return emptySnapshot(snapshot.threadId, snapshot.updatedAt);
    }
    upsert.run({
      threadId: snapshot.threadId,
      updatedAt: snapshot.updatedAt,
      goalJson: JSON.stringify(snapshot.goal),
    });
    return snapshot;
  }

  function clear(threadId: string, now = Date.now()): GoalSnapshot {
    remove.run(threadId);
    return emptySnapshot(threadId, now);
  }

  function knownThreadIds(): string[] {
    const rows = listThreadIds.all() as Array<{ thread_id: string }>;
    return rows.map((r) => r.thread_id);
  }

  return { get, save, clear, knownThreadIds };
}

export type GoalStore = ReturnType<typeof openGoalStore>;
