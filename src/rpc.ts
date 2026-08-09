import { defineRpcContract } from "@bb/plugin-sdk";
import { z } from "zod";

export const uiGoalSchema = z.object({
  text: z.string(),
  successCriteria: z.array(z.string()),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const uiGoalSnapshotSchema = z.object({
  threadId: z.string(),
  updatedAt: z.number(),
  goal: uiGoalSchema.nullable(),
});

export const rpcContract = defineRpcContract({
  getGoal: {
    input: z.object({ threadId: z.string().min(1) }).strict(),
    output: z.object({
      snapshot: uiGoalSnapshotSchema.nullable(),
    }),
  },
});
