// All user-facing Korean text lives in copy/ko.json (generated from copy/copy-spec.json).
// Code refers to keys only. Placeholders use {name}.

export type Dict = Record<string, string>

export function format(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m))
}

export function makeT(dict: Dict) {
  return (key: string, vars?: Record<string, string | number>): string => {
    const tpl = dict[key]
    return tpl === undefined ? key : format(tpl, vars)
  }
}

export type T = ReturnType<typeof makeT>
