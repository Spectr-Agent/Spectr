export const MAX_SENTENCE_WORDS: number;
export const MAX_EXCLAMATIONS: number;
export function extractStrings(source: string): Array<{ value: string; template: boolean }>;
export function checkSource(source: string): Array<{ rule: string; text: string }>;
