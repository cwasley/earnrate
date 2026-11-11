// The app's tabs, in order, and where each opens from another page. The
// static pages' header links to them by these names.
export const TABS = [
  { id: 'best', name: 'Best for…', href: '/' },
  { id: 'spending', name: 'Find a card', href: '/#spending' },
  { id: 'wallet', name: 'My wallet', href: '/#wallet' },
] as const

export type Tab = (typeof TABS)[number]['id']
