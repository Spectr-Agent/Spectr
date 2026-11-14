// Remembers which texts onboarding has already handled, so a message delivered
// twice moves the questions forward once. Stores ids only, never the text.

export interface OnboardingTurnLog {
  /** True the first time a message is seen, false for a repeat delivery. */
  claim(providerMessageId: string, identity: string): Promise<boolean>;
}

export class InMemoryOnboardingTurnLog implements OnboardingTurnLog {
  private readonly seen = new Set<string>();

  async claim(providerMessageId: string, _identity: string) {
    if (this.seen.has(providerMessageId)) return false;
    this.seen.add(providerMessageId);
    return true;
  }
}
