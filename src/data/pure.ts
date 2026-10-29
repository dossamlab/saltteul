// Pure helpers for the quick add, newsletter upload, dinner and journal screens (no Firebase imports, unit tested).

/** Images are scaled so the long side is at most this many pixels before upload. */
export const IMAGE_MAX_SIDE = 2000
export const IMAGE_QUALITY = 0.85
/** PDFs are sent as-is up to this size. */
export const PDF_MAX_BYTES = 8 * 1024 * 1024

/** Target size that fits within maxSide on the long side, keeping the aspect ratio. Never scales up. */
export function fitWithin(width: number, height: number, maxSide = IMAGE_MAX_SIDE): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 }
  const long = Math.max(width, height)
  if (long <= maxSide) return { width: Math.round(width), height: Math.round(height) }
  const k = maxSide / long
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) }
}

/** 'photo.HEIC' -> 'photo.jpg' (the upload is re-encoded as JPEG). */
export function jpegName(fileName: string): string {
  const base = fileName.replace(/\.[^./\\]+$/, '') || 'image'
  return `${base}.jpg`
}

/** Comparison key for shopping names: whitespace removed, case-insensitive. */
export function normName(name: string): string {
  return name.replace(/\s+/g, '').toLowerCase()
}

/** Ingredients that are not already on the open shopping list (and not repeated within the list itself). */
export function missingIngredients(ingredients: string[], openShoppingNames: string[]): string[] {
  const have = new Set(openShoppingNames.map(normName))
  const out: string[] = []
  for (const raw of ingredients) {
    const name = raw.trim()
    const k = normName(name)
    if (!k || have.has(k)) continue
    have.add(k)
    out.push(name)
  }
  return out
}

/** Plain text for sharing one journal entry (title, date range, bullet lines). */
export function journalShareText(title: string, range: string, lines: string[]): string {
  return [title, range, '', ...lines.map((l) => `• ${l}`)].join('\n')
}
