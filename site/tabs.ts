// The app's tabs, in order, and where each opens from another page. The
// static pages' header links to them by these names.
export const TABS = [
  { id: 'best', name: 'At a store', href: '/#best' },
  { id: 'spending', name: 'Best setups', href: '/#spending' },
  { id: 'wallet', name: 'My wallet', href: '/#wallet' },
] as const

export type Tab = (typeof TABS)[number]['id']

// The tab a home page address opens on. The home page's first-paint script
// (site/index.html) repeats this so the right tab shows before the app has
// loaded; tests/first-paint.test.ts keeps the two in step.
export function tabFor(hash: string, holdsCards: boolean): Tab {
  if (hash.length <= 1) return holdsCards ? 'wallet' : 'best'
  const params = new URLSearchParams(hash.slice(1))
  if (params.has('spending') || params.has('whatif')) return 'spending'
  if (params.has('wallet') && params.get('wallet') === '') return 'wallet'
  return 'best'
}
