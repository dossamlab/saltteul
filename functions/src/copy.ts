// User-facing text comes from copy/ko.json (keys are documented in copy/copy-spec*.json).
import ko from '../../copy/ko.json'
import { makeT, type Dict, type T } from '../../shared/copy'

export const t: T = makeT(ko as Dict)
export type { T }
