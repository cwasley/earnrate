// What earnrate.dev counts: these names and the kind of device, nothing
// else. Never a search, a card, an amount or anything that identifies a
// person or a browser. The privacy page lists them; keep it in step.
export const EVENTS = [
  // The app's tabs and what people do in them
  'tab-best',
  'tab-spending',
  'tab-wallet',
  'search',
  'example-search',
  'spending-edit',
  'wallet-first-card',
  'wallet-card-added',
  'wallet-which-card',
  'wallet-export',
  'wallet-import',
  'cheat-sheet',
  'cheat-sheet-image',
  'apple-wallet',
  'wallet-sync-on',
  'wallet-sync-off',
  // Calls to action
  'cta-claude',
  'cta-after-answer',
  'cta-save-cards',
  'cta-pass-hint',
  'cta-bottom',
  // Links for choosing a card
  'decide-fee',
  'decide-compare',
  'decide-quarterly',
  'decide-best',
  // The setup section
  'setup-code',
  'setup-desktop',
  'setup-cli',
  'copy-connector',
  'copy-plugin',
  'copy-cli',
  'desktop-download',
] as const

export type SiteEvent = (typeof EVENTS)[number]

const KNOWN = new Set<string>(EVENTS)
export const isEvent = (name: string): name is SiteEvent => KNOWN.has(name)

export type Device = 'iphone' | 'android' | 'desktop' | 'other'

// iPads report a Mac user agent, so they count as desktop.
export function deviceOf(userAgent: string): Device {
  if (/iPhone|iPod/.test(userAgent)) return 'iphone'
  if (/Android/.test(userAgent)) return 'android'
  if (/Macintosh|Windows|X11|CrOS/.test(userAgent)) return 'desktop'
  return 'other'
}
