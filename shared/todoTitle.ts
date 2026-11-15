// Kids Note todos are stored as "[키즈노트] 견학" so the shared Google calendar shows where they came from.
// Inside the app the source already has its own badge or colour, so the leading "[...]" is dropped on screen.
// Same rule as WidgetLogic.displayTitle on Android.
import type { Todo } from './types'

export function todoDisplayTitle(t: Pick<Todo, 'title' | 'source'>): string {
  const title = (t.title ?? '').trim()
  if (t.source !== 'kidsnote' || !title.startsWith('[')) return title
  const end = title.indexOf(']')
  if (end <= 0 || end >= title.length - 1) return title
  return title.slice(end + 1).trim() || title
}
