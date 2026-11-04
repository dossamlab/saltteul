// What the last voice input put in the quick add field, so 「원래대로」 can swap Claude's corrected words back to what
// Speech-to-Text heard without touching anything typed before the recording.

export interface VoiceFix {
  /** Field text before the recording */
  base: string
  /** What went in (Claude's corrected sentence) */
  fixed: string
  /** What Speech-to-Text heard */
  heard: string
}

/** Appends spoken words to what is already typed, with one space between. */
export const joinVoice = (prev: string, said: string) => (prev.trim() ? `${prev.trimEnd()} ${said}` : said)

/** The field with the heard words back, or null when the field has changed since the recording. */
export function undoVoiceFix(current: string, fix: VoiceFix): string | null {
  return current === joinVoice(fix.base, fix.fixed) ? joinVoice(fix.base, fix.heard) : null
}
