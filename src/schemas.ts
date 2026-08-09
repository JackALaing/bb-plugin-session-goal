import { z } from "zod";
import {
  ACTIONS,
  BLOCKED_REASON_MAX,
  CRITERION_MAX,
  EVIDENCE_MAX,
  MAX_CRITERIA,
  TEXT_MAX,
} from "./constants.js";

export const actionSchema = z.enum(ACTIONS);

const criterionTextSchema = z.string().min(1).max(CRITERION_MAX);

const criterionObjectSchema = z
  .object({
    text: criterionTextSchema,
    done: z.boolean().optional(),
  })
  .strict();

/** String or { text, done? } for set/update successCriteria. */
export const criterionInputSchema = z.union([
  criterionTextSchema,
  criterionObjectSchema,
]);

export const goalToolInputSchema = z
  .object({
    action: actionSchema.optional(),
    /** Primary goal statement — the sticky "why" for this thread. */
    text: z.string().min(1).max(TEXT_MAX).optional(),
    /** Replace the full success-criteria list (strings or {text,done}). */
    successCriteria: z
      .array(criterionInputSchema)
      .max(MAX_CRITERIA)
      .optional(),
    /** Append criteria (update only). */
    addCriteria: z.array(criterionTextSchema).max(MAX_CRITERIA).optional(),
    /** Remove criteria by exact text match (update only). */
    removeCriteria: z.array(criterionTextSchema).max(MAX_CRITERIA).optional(),
    /** Mark criteria done by exact text (update or completeCriteria). */
    completeCriteria: z.array(criterionTextSchema).max(MAX_CRITERIA).optional(),
    /** Mark criteria not done by exact text. */
    uncompleteCriteria: z
      .array(criterionTextSchema)
      .max(MAX_CRITERIA)
      .optional(),
    /** Proof of completion (complete action). */
    evidence: z.string().min(1).max(EVIDENCE_MAX).optional(),
    /** Why the goal is blocked (block action). */
    blockedReason: z.string().min(1).max(BLOCKED_REASON_MAX).optional(),
    /**
     * Allow complete even with open criteria or open todos.
     * Prefer fixing work instead of forcing.
     */
    force: z.boolean().optional(),
  })
  .strict();

export type GoalToolInput = z.infer<typeof goalToolInputSchema>;

export const TOOL_DESCRIPTION = `Set and maintain the session goal for the current thread — a sticky "why" with status, checkable success criteria, and finish discipline.

Use ONE tool for every goal operation via \`action\`:

- set — create or replace the goal (\`text\` required; optional \`successCriteria[]\`)
- update — patch text/criteria (\`addCriteria\` / \`removeCriteria\` / \`completeCriteria\` / \`uncompleteCriteria\`)
- complete — mark goal achieved (\`evidence\` recommended; requires open criteria done unless \`force\`)
- block — stop with \`blockedReason\` (true impasse only)
- pause / resume — soft stop / continue later
- completeCriteria / uncompleteCriteria — tick criteria by exact text
- clear — abandon / remove the goal card
- list — read the current goal (default when action omitted)

## Status
active | complete | blocked | paused

## Fields
- text — short statement of what success looks like (required on set)
- successCriteria — observable done-ness checks (max ${MAX_CRITERIA}); may be strings or {text, done}
- evidence — proof when completing (tests green, PR merged, install verified, …)
- blockedReason — required for block
- force — allow complete with open criteria/todos (prefer not to)

## End-of-work contract
Before yielding as "done":
1. Mark finished steps via \`todo\` (if used).
2. Tick criteria with completeCriteria as each gate is proven.
3. Call \`goal\` complete with evidence — or leave the goal **active** and say what remains.
Never soft-exit with an active goal and open criteria.

## Goal vs todo
- **goal** = sticky why + success definition (one per thread)
- **todo** = ordered steps / checklist toward that why

Prefer setting a goal early on non-trivial sessions. Keep criteria concrete and testable.
`;

export const TOOL_INSTRUCTIONS =
  "Use the `goal` tool for the sticky session why + success criteria. Prefer a concrete outcome early. Tick criteria as gates pass; call action `complete` with evidence when done — do not soft-exit with an active goal. Use `todo` for ordered steps. On true impasse use `block` with a reason.";
