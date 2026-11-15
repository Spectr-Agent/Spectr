// One call, independent of LiveKit: takes finished transcripts, routes them, and decides
// what to say. The LiveKit entry wires a real session to this; tests drive it directly.

import {
  acknowledgement,
  afterthought,
  goodbye,
  greeting,
  isTerminal,
  likelyKind,
  narration,
  Phrasing,
  routeFailed,
  stillHere,
  type CallMedium,
  type GreetingOptions,
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

export interface CallSessionOptions {
  /** How often to check the task for news; 0 disables polling (tests). */
  pollMs?: number;
  /** Chooses among wordings; inject a seeded one for deterministic tests. */
  phrasing?: Phrasing;
}

export class CallSession {
  private turn = 0;
  private current: TaskStatus | null = null;
  private stopped = false;
  private polling: ReturnType<typeof setInterval> | undefined;
  private prepared: string | null = null;
  private readonly pollMs: number;
  private readonly phrasing: Phrasing;

  constructor(
    private readonly callId: string,
    private readonly medium: CallMedium,
    private readonly caller: Caller,
    private readonly tasks: TaskGateway,
    private readonly output: CallOutput,
    options: CallSessionOptions | number = {},
  ) {
    const resolved = typeof options === "number" ? { pollMs: options } : options;
    this.pollMs = resolved.pollMs ?? 1_500;
    this.phrasing = resolved.phrasing ?? new Phrasing();
  }

  /**
   * Works out the opening line before the caller can hear anything, so its audio can be
   * made ahead of time. `begin` speaks it; calling `begin` without this prepares then.
   */
  async prepareGreeting(options: Omit<GreetingOptions, "active"> = {}): Promise<string> {
    this.current = await this.tasks.activeTask(this.caller).catch(() => null);
    this.prepared = greeting(this.medium, { ...options, active: this.current }, this.phrasing);
    return this.prepared;
  }

  /** Greets, and picks up a task that is already running for this Mac. */
  async begin(options: Omit<GreetingOptions, "active"> = {}): Promise<void> {
    const line = this.prepared ?? (await this.prepareGreeting(options));
    this.prepared = null;
    this.output.say(line);
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
        this.output.say(stillHere(this.phrasing));
        return;
      case "goodbye":
        this.output.say(goodbye(this.phrasing));
        this.output.hangUp();
        this.end();
        return;
      case "route":
        break;
    }
    this.turn += 1;
    // Answer at once, before the database round trip, so the caller is never left
    // wondering whether they were heard.
    const guessed = likelyKind(action.text, this.current);
    this.output.say(acknowledgement(guessed, this.phrasing));
    try {
      const routed = await this.tasks.route(this.caller, action.text, `call:${this.callId}:${this.turn}`);
      const correction = afterthought(guessed, routed.kind, this.phrasing);
      if (correction) this.output.say(correction);
      const status = await this.tasks.status(routed.taskId);
      // Remember the new state silently: what was just acknowledged needs no narration.
      if (status) this.current = status;
    } catch {
      this.output.say(routeFailed(this.phrasing));
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
