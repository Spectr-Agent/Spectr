// What Spectr remembers about a person after onboarding. Preferences only
// change how Spectr talks and how often it updates; they never limit what
// someone can ask. Nothing here is saved until the person says yes.

import { z } from "zod";

export const TASK_CHOICES = ["files", "lookups", "forms", "messages"] as const;
export const UPDATE_CHOICES = ["every_step", "every_chunk", "result"] as const;
export const STYLE_CHOICES = ["short", "simple"] as const;

export type TaskChoice = (typeof TASK_CHOICES)[number];
export type UpdateChoice = (typeof UPDATE_CHOICES)[number];
export type StyleChoice = (typeof STYLE_CHOICES)[number];

export const MAX_FREE_TEXT = 200;
const freeText = z.string().min(1).max(MAX_FREE_TEXT).nullable();

export const ProfileSchema = z
  .object({
    /** What they use Spectr for, in their own words. */
    uses: freeText,
    tasks: z.array(z.enum(TASK_CHOICES)).max(TASK_CHOICES.length),
    /** A task they named that isn't one of the choices. */
    tasksOther: freeText,
    /** How often to send progress texts. */
    updates: z.enum(UPDATE_CHOICES).nullable(),
    /** How Spectr should explain things. */
    style: z.enum(STYLE_CHOICES).nullable(),
    /** A style they described themselves, such as "larger text". */
    styleOther: freeText,
  })
  .strict();
export type Profile = z.infer<typeof ProfileSchema>;

export function emptyProfile(): Profile {
  return { uses: null, tasks: [], tasksOther: null, updates: null, style: null, styleOther: null };
}

/** True when there is anything worth remembering. */
export function hasContent(p: Profile): boolean {
  return Boolean(p.uses || p.tasks.length || p.tasksOther || p.updates || p.style || p.styleOther);
}
