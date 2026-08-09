import { defineRpcContract } from "@bb/plugin-sdk";
import { z } from "zod";
import { CRITERION_MAX, STATUSES, TEXT_MAX } from "./constants.js";

export const uiCriterionSchema = z.object({
  text: z.string(),
  done: z.boolean(),
});

export const uiGoalSchema = z.object({
  text: z.string(),
  successCriteria: z.array(uiCriterionSchema),
  status: z.enum(STATUSES),
  evidence: z.string().nullable(),
  blockedReason: z.string().nullable(),
  source: z.enum(["plugin", "native"]),
  nativeStatus: z.string().nullable(),
  continuationCount: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const uiGoalSnapshotSchema = z.object({
  threadId: z.string(),
  updatedAt: z.number(),
  goal: uiGoalSchema.nullable(),
});

const snapshotOut = z.object({
  snapshot: uiGoalSnapshotSchema.nullable(),
  error: z.string().nullable(),
});

export const rpcContract = defineRpcContract({
  getGoal: {
    input: z.object({ threadId: z.string().min(1) }).strict(),
    output: snapshotOut,
  },
  /** Remove the goal card (user dismiss). */
  dismissGoal: {
    input: z.object({ threadId: z.string().min(1) }).strict(),
    output: snapshotOut,
  },
  /** Update goal text (and optional full criteria replace). */
  updateGoal: {
    input: z
      .object({
        threadId: z.string().min(1),
        text: z.string().min(1).max(TEXT_MAX).optional(),
        successCriteria: z
          .array(
            z.object({
              text: z.string().min(1).max(CRITERION_MAX),
              done: z.boolean().optional(),
            }),
          )
          .max(20)
          .optional(),
      })
      .strict(),
    output: snapshotOut,
  },
  /** Toggle a criterion done flag by exact text. */
  toggleCriterion: {
    input: z
      .object({
        threadId: z.string().min(1),
        text: z.string().min(1).max(CRITERION_MAX),
      })
      .strict(),
    output: snapshotOut,
  },
  /** User marks goal complete from the UI. */
  completeGoal: {
    input: z
      .object({
        threadId: z.string().min(1),
        evidence: z.string().max(2000).optional(),
      })
      .strict(),
    output: snapshotOut,
  },
  pauseGoal: {
    input: z.object({ threadId: z.string().min(1) }).strict(),
    output: snapshotOut,
  },
  resumeGoal: {
    input: z.object({ threadId: z.string().min(1) }).strict(),
    output: snapshotOut,
  },
});
