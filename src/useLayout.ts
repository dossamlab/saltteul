import { useEffect, useState } from 'react'

export type Layout = 'phone' | 'tablet' | 'pc'

const TABLET = '(min-width: 900px)'
const PC = '(min-width: 1200px)'

function read(): Layout {
  if (window.matchMedia(PC).matches) return 'pc'
  if (window.matchMedia(TABLET).matches) return 'tablet'
  return 'phone'
}

/** phone < 900px, tablet 900-1199px, pc >= 1200px. */
export function useLayout(): Layout {
  const [v, setV] = useState<Layout>(read)
  useEffect(() => {
    const qs = [window.matchMedia(TABLET), window.matchMedia(PC)]
    const on = () => setV(read())
    qs.forEach((q) => q.addEventListener('change', on))
    return () => qs.forEach((q) => q.removeEventListener('change', on))
  }, [])
  return v
}
