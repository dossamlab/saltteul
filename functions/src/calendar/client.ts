import { calendar, type calendar_v3 } from '@googleapis/calendar'
import { GoogleAuth } from 'google-auth-library'

export interface CalTime {
  date?: string | null // all-day: 'YYYY-MM-DD'
  dateTime?: string | null // RFC3339
  timeZone?: string | null
}

export interface CalEvent {
  id: string
  status: 'confirmed' | 'tentative' | 'cancelled'
  summary?: string | null
  description?: string | null
  start?: CalTime | null
  end?: CalTime | null
  updated?: string | null // RFC3339
  saltteulId?: string | null // extendedProperties.private.saltteulId
}

export interface EventInput {
  summary: string
  description?: string | null
  start: CalTime
  end: CalTime
  saltteulId: string
}

export interface ChangeSet {
  events: CalEvent[]
  nextSyncToken: string
}

/** The stored sync token is no longer valid (HTTP 410); the caller must run a full sync. */
export class SyncTokenExpiredError extends Error {}

export interface CalendarPort {
  /** Changed events since `syncToken` (all events when null). Throws SyncTokenExpiredError on 410. */
  listChanges(calendarId: string, syncToken: string | null): Promise<ChangeSet>
  insert(calendarId: string, ev: EventInput): Promise<{ id: string; updated: string | null }>
  patch(calendarId: string, eventId: string, ev: EventInput): Promise<{ id: string; updated: string | null }>
  /** Deleting an event that is already gone is not an error. */
  remove(calendarId: string, eventId: string): Promise<void>
}

const SCOPES = ['https://www.googleapis.com/auth/calendar.events']

export function httpStatus(e: unknown): number | undefined {
  const err = e as { code?: unknown; status?: unknown; response?: { status?: number } }
  const n = Number(err?.response?.status ?? err?.status ?? err?.code)
  return Number.isFinite(n) ? n : undefined
}

function fromApi(e: calendar_v3.Schema$Event): CalEvent {
  return {
    id: e.id ?? '',
    status: (e.status as CalEvent['status']) ?? 'confirmed',
    summary: e.summary ?? null,
    description: e.description ?? null,
    start: e.start ?? null,
    end: e.end ?? null,
    updated: e.updated ?? null,
    saltteulId: e.extendedProperties?.private?.saltteulId ?? null,
  }
}

function toApi(ev: EventInput): calendar_v3.Schema$Event {
  return {
    summary: ev.summary,
    description: ev.description ?? null,
    start: { date: ev.start.date ?? null, dateTime: ev.start.dateTime ?? null, timeZone: ev.start.timeZone ?? null },
    end: { date: ev.end.date ?? null, dateTime: ev.end.dateTime ?? null, timeZone: ev.end.timeZone ?? null },
    extendedProperties: { private: { saltteulId: ev.saltteulId } },
  }
}

/** Google Calendar through the functions' service account (Application Default Credentials). */
export class GoogleCalendar implements CalendarPort {
  private api: calendar_v3.Calendar

  constructor(api?: calendar_v3.Calendar) {
    this.api = api ?? calendar({ version: 'v3', auth: new GoogleAuth({ scopes: SCOPES }) })
  }

  async listChanges(calendarId: string, syncToken: string | null): Promise<ChangeSet> {
    const events: CalEvent[] = []
    let pageToken: string | undefined
    try {
      for (;;) {
        const res = await this.api.events.list({
          calendarId,
          singleEvents: true,
          showDeleted: true,
          maxResults: 250,
          ...(syncToken ? { syncToken } : {}),
          ...(pageToken ? { pageToken } : {}),
        })
        for (const e of res.data.items ?? []) if (e.id) events.push(fromApi(e))
        if (res.data.nextPageToken) {
          pageToken = res.data.nextPageToken
          continue
        }
        return { events, nextSyncToken: res.data.nextSyncToken ?? syncToken ?? '' }
      }
    } catch (e) {
      if (httpStatus(e) === 410) throw new SyncTokenExpiredError('sync token expired')
      throw e
    }
  }

  async insert(calendarId: string, ev: EventInput) {
    const res = await this.api.events.insert({ calendarId, requestBody: toApi(ev) })
    return { id: res.data.id ?? '', updated: res.data.updated ?? null }
  }

  async patch(calendarId: string, eventId: string, ev: EventInput) {
    const res = await this.api.events.patch({ calendarId, eventId, requestBody: toApi(ev) })
    return { id: res.data.id ?? eventId, updated: res.data.updated ?? null }
  }

  async remove(calendarId: string, eventId: string) {
    try {
      await this.api.events.delete({ calendarId, eventId })
    } catch (e) {
      const s = httpStatus(e)
      if (s === 404 || s === 410) return
      throw e
    }
  }
}

/** In-memory calendar for tests. */
export class FakeCalendar implements CalendarPort {
  events = new Map<string, CalEvent>()
  calls: string[] = []
  private seq = 0
  private clock = Date.parse('2026-10-28T00:00:00Z')
  private changed = new Set<string>()
  expireNextToken = false

  tick(ms = 1000) {
    this.clock += ms
    return new Date(this.clock).toISOString()
  }

  /** Simulates an edit made directly in Google Calendar. */
  external(ev: Omit<CalEvent, 'updated'> & { updated?: string }) {
    const full = { ...ev, updated: ev.updated ?? this.tick() }
    this.events.set(ev.id, full)
    this.changed.add(ev.id)
    return full
  }

  async listChanges(_calendarId: string, syncToken: string | null): Promise<ChangeSet> {
    this.calls.push(`list:${syncToken ?? 'full'}`)
    if (syncToken && this.expireNextToken) {
      this.expireNextToken = false
      throw new SyncTokenExpiredError('expired')
    }
    const ids = syncToken ? [...this.changed] : [...this.events.keys()]
    this.changed.clear()
    return { events: ids.map((id) => this.events.get(id)!).filter(Boolean), nextSyncToken: `tok${++this.seq}` }
  }

  async insert(_c: string, ev: EventInput) {
    const id = `ev${++this.seq}`
    const stored: CalEvent = { id, status: 'confirmed', ...ev, updated: this.tick() }
    this.events.set(id, stored)
    this.changed.add(id)
    this.calls.push(`insert:${id}`)
    return { id, updated: stored.updated ?? null }
  }

  async patch(_c: string, eventId: string, ev: EventInput) {
    const prev = this.events.get(eventId)
    if (!prev) throw Object.assign(new Error('not found'), { code: 404 })
    const stored: CalEvent = { ...prev, ...ev, updated: this.tick() }
    this.events.set(eventId, stored)
    this.changed.add(eventId)
    this.calls.push(`patch:${eventId}`)
    return { id: eventId, updated: stored.updated ?? null }
  }

  async remove(_c: string, eventId: string) {
    this.calls.push(`remove:${eventId}`)
    const prev = this.events.get(eventId)
    if (!prev) return
    this.events.set(eventId, { ...prev, status: 'cancelled', updated: this.tick() })
    this.changed.add(eventId)
  }
}
