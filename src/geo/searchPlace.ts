// Place search for the weather location, using OpenStreetMap Nominatim (no key, Korea only).
// Called only when the user presses search, which keeps within Nominatim's light-use policy.

export interface PlaceResult {
  label: string // short name saved as the location label, e.g. "강남구 역삼동"
  detail: string // longer address shown in the result list
  lat: number
  lon: number
}

interface NominatimItem {
  display_name: string
  lat: string
  lon: string
}

const COUNTRY = new Set(['대한민국', 'South Korea', 'Korea, Republic of'])

export function toPlace(item: NominatimItem): PlaceResult {
  const parts = item.display_name
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p && !/^\d{3,}$/.test(p) && !COUNTRY.has(p))
  // Prefer "<district> <place>" (e.g. 강남구 역삼동) even when sub-areas like 역삼2동 sit between them.
  const district = parts.find((p, i) => i > 0 && /(구|군|시)$/.test(p))
  const label = district && district !== parts[0] ? `${district} ${parts[0]}` : parts.slice(0, 2).reverse().join(' ')
  return {
    label,
    detail: parts.slice(0, 4).reverse().join(' '),
    lat: Number(Number(item.lat).toFixed(4)),
    lon: Number(Number(item.lon).toFixed(4)),
  }
}

/** Name for the device's current position; null when the lookup fails. */
export async function reversePlace(lat: number, lon: number): Promise<PlaceResult | null> {
  const url = new URL('https://nominatim.openstreetmap.org/reverse')
  url.search = new URLSearchParams({ lat: String(lat), lon: String(lon), format: 'jsonv2', 'accept-language': 'ko', zoom: '14' }).toString()
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) return null
    const item = (await res.json()) as NominatimItem & { error?: string }
    return item.error || !item.display_name ? null : { ...toPlace(item), lat, lon }
  } catch {
    return null
  }
}

export async function searchPlace(query: string): Promise<PlaceResult[]> {
  const q = query.trim()
  if (!q) return []
  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.search = new URLSearchParams({ q, format: 'jsonv2', countrycodes: 'kr', 'accept-language': 'ko', limit: '6' }).toString()
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`place search failed: ${res.status}`)
  const items = (await res.json()) as NominatimItem[]
  const seen = new Set<string>()
  return items.map(toPlace).filter((p) => {
    if (!p.label || seen.has(p.detail)) return false
    seen.add(p.detail)
    return true
  })
}
