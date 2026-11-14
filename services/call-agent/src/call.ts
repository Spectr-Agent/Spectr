// One call, independent of LiveKit: takes finished transcripts, routes them, and decides
// what to say. The LiveKit entry wires a real session to this; tests drive it directly.

import {
  acknowledgement,
  GOODBYE,
  greeting,
  isTerminal,
  narration,
  ROUTE_FAILED,
  type CallMedium,
  type TaskStatus,
  utteranceAction,
} from "./conversation.js";
import type { Caller, TaskGateway } from "./tasks.js";

export interface CallOutput {
  /** Speak a line. Interrupting speech is handled by the session. */
  say(text: string): void;
  /** End the call after the current line. */
  hangUp(): void;
}

export class CallSession {
  private turn = 0;
  private current: TaskStatus | null = null;
  private stopped = false;
  private polling: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly callId: string,
    private readonly medium: CallMedium,
    private readonly caller: Caller,
    private readonly tasks: TaskGateway,
    private readonly output: CallOutput,
    private readonly pollMs = 1_500,
  ) {}

  /** Greets, and picks up a task that is already running for this Mac. */
  async begin(): Promise<void> {
    this.current = await this.tasks.activeTask(this.caller).catch(() => null);
    this.output.say(greeting(this.medium));
    this.startPolling();
  }

  /** Handles one final transcript. */
  async hear(transcript: string): Promise<void> {
    if (this.stopped) return;
    const active = this.current !== null && !isTerminal(this.current.state);
    const action = utteranceAction(transcript, active);
    switch (action.type) {
      case "ignore":
        return;
      case "greeting":
        this.output.say(greeting(this.medium));
        return;
      case "goodbye":
        this.output.say(GOODBYE);
        this.output.hangUp();
        this.end();
        return;
      case "route":
        break;
    }
    this.turn += 1;
    try {
      const routed = await this.tasks.route(this.caller, action.text, `call:${this.callId}:${this.turn}`);
      this.output.say(acknowledgement(routed.kind));
      const status = await this.tasks.status(routed.taskId);
      // Remember the new state silently: what was just acknowledged needs no narration.
      if (status) this.current = status;
    } catch {
      this.output.say(ROUTE_FAILED);
    }
  }

  /** Checks the task once and speaks anything new (questions, verified results). */
  async poll(): Promise<void> {
    if (this.stopped || !this.current) return;
    const next = await this.tasks.status(this.current.taskId).catch(() => null);
    if (!next) return;
    const line = narration(this.current, next);
    this.current = next;
    if (line) this.output.say(line);
  }

  end(): void {
    this.stopped = true;
    if (this.polling) clearInterval(this.polling);
    this.polling = undefined;
  }

  get task(): TaskStatus | null {
    return this.current;
  }

  private startPolling(): void {
    if (this.pollMs <= 0) return;
    this.polling = setInterval(() => void this.poll(), this.pollMs);
  }
}
