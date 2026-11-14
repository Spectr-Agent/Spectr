// Shapes for the scripted phone threads (the text lives in content/copy.ts).

export type ShotKind = "resume" | "folder" | "text" | "dark";

export interface Preview {
  to: string;
  subject: string;
  body: string;
  file: string;
}

export interface MessageStep {
  from: "me" | "bot";
  text?: string;
  file?: string;
  size?: string;
  shot?: ShotKind;
  preview?: Preview;
  /** Pause before a message from "me" appears, in ms. */
  pre?: number;
  /** Pause after the message, in ms. */
  after?: number;
  /** How long the typing dots show before a bot message, in ms. */
  typing?: number;
  /** The hero mascot changes to this pose when the message shows. */
  pose?: "success";
}

export interface ActionStep {
  /** Something happens on the Mac screen (the demo). */
  action: "mac";
}

export type Step = MessageStep | ActionStep;
export type Script = readonly Step[];

export const isAction = (step: Step): step is ActionStep => "action" in step;
