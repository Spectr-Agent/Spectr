// Shapes for the scripted FaceTime calls (the words live in content/copy.ts).

/** What the Mac's screen shows in the call video. */
export type SceneKind = "resume" | "due" | "folder" | "text" | "mail" | "appearance";

export interface MessageStep {
  from: "me" | "bot";
  /** What is said. It shows as a caption on the call. */
  text?: string;
  /** The Mac's screen changes to this when the caption appears. */
  scene?: SceneKind;
  /** Pause before the caller's line appears, in ms. */
  pre?: number;
  /** Pause after the line, in ms. */
  after?: number;
  /** How long Spectr "thinks" before it speaks, in ms. */
  typing?: number;
  /** The hero mascot changes to this pose when the line appears. */
  pose?: "success";
}

export interface ActionStep {
  /** Something happens on the Mac screen (the demo). */
  action: "mac";
}

export type Step = MessageStep | ActionStep;
export type Script = readonly Step[];

export const isAction = (step: Step): step is ActionStep => "action" in step;
