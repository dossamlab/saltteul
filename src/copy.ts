import ko from '../copy/ko.json'
import { makeT } from '../shared/copy'

// Wording only for this household (the child's name on the kids tab) lives in copy/ko.private.json, which the public
// repository leaves out; without it the generic wording is used.
const local = import.meta.glob<Record<string, string>>('../copy/ko.private.json', { eager: true, import: 'default' })

export const t = makeT({ ...(ko as Record<string, string>), ...Object.values(local)[0] })
