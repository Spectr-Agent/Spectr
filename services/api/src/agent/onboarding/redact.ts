// Passwords, codes and card numbers are never shown back or saved, even if
// someone types one into an answer. Pure function, no network.

const PATTERNS: RegExp[] = [
  // Card-length digit runs, with spaces or dashes: 4111 1111 1111 1111
  /\b(?:\d[ -]?){13,19}\b/g,
  // "password is hunter2", "passcode: 4821", "2fa = 123456"
  /\b(?:password|passcode|passphrase|pin|otp|2fa|cvv|cvc|ssn|security code|verification code|login code)\s*(?:is|was|=|:)\s*\S+/gi,
  // "pin 1234", "code 482913", "cvv 123"
  /\b(?:pin|otp|cvv|cvc|code)\s+\d{3,8}\b/gi,
  // "password hunter2" (needs a digit or symbol, so "password manager" survives)
  /\b(?:password|passcode|passphrase)\s+(?=\S*[\d!@#$%^&*])\S+/gi,
  // Stand-alone one-time codes
  /\b\d{6,8}\b/g,
];

export interface Redacted {
  text: string;
  /** True when something secret-looking was taken out. */
  removed: boolean;
}

export function redactSecrets(input: string): Redacted {
  let text = input;
  for (const pattern of PATTERNS) text = text.replace(pattern, " ");
  text = text.replace(/\s{2,}/g, " ").replace(/\s+([,.;:])/g, "$1").trim();
  return { text, removed: text !== input.replace(/\s{2,}/g, " ").trim() };
}
