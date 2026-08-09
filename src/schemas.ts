import { z } from "zod";
import {
  ACTIONS,
  CRITERION_MAX,
  MAX_CRITERIA,
  TEXT_MAX,
} from "./constants.js";

export const actionSchema = z.enum(ACTIONS);

const criterionSchema = z.string().min(1).max(CRITERION_MAX);

export const goalToolInputSchema = z
  .object({
    action: actionSchema.optional(),
    /** Primary goal statement — the sticky "why" for this thread. */
    text: z.string().min(1).max(TEXT_MAX).optional(),
    /** Replace the full success-criteria list. */
    successCriteria: z.array(criterionSchema).max(MAX_CRITERIA).optional(),
    /** Append criteria (update only). */
    addCriteria: z.array(criterionSchema).max(MAX_CRITERIA).optional(),
    /** Remove criteria by exact text match (update only). */
    removeCriteria: z.array(criterionSchema).max(MAX_CRITERIA).optional(),
  })
  .strict();

export type GoalToolInput = z.infer<typeof goalToolInputSchema>;

export const TOOL_DESCRIPTION = `Set and maintain the session goal for the current thread — a sticky "why" card with optional success criteria.

Use ONE tool for every goal operation via \`action\`:

- set — create or replace the goal (\`text\` required; optional \`successCriteria[]\`)
- update — patch fields (\`text\`, \`successCriteria\`, or \`addCriteria\` / \`removeCriteria\`)
- clear — remove the goal card
- list — read the current goal (default when action omitted)

## Fields
- text — short statement of what success looks like for this session (required on set)
- successCriteria — checklist of observable outcomes (max ${MAX_CRITERIA})
- addCriteria / removeCriteria — incremental edits on update (remove matches exact text)

## When to use
- User states an outcome, mission, or definition of done for the thread
- Multi-step work where the checklist (todo) is steps, but the goal is the why
- Re-orient after drift: update the goal rather than only adding todos

## Goal vs todo
- **goal** = sticky why / success definition (one per thread)
- **todo** = ordered steps / checklist toward that why

Prefer setting a goal early on non-trivial sessions. Keep criteria concrete and testable.
`;
