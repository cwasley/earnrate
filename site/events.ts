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
  'place-kind',
  'spending-edit',
  'wallet-first-card',
  'wallet-card-added',
  'wallet-quick-add',
  'wallet-which-card',
  'wallet-export',
  'wallet-import',
  'cheat-sheet',
  'cheat-sheet-image',
  'cheat-sheet-link',
  'apple-wallet',
  'wallet-two-years',
  'wallet-skip-issuers',
  'wallet-keep-or-replace',
  'wallet-sync-on',
  'wallet-sync-off',
  // Calls to action
  'cta-claude',
  'cta-after-answer',
  'cta-save-cards',
  // Arrivals from the static pages' buttons
  'page-spending',
  'page-whatif',
  'page-settings',
  'page-add',
  'page-check',
  // Links to the statement check, which itself counts nothing
  'statement-check',
  // Rate my wallet: following a link to it, sharing or copying a report's
  // link, opening a page with a report link (never what it holds), and
  // saving a report as an image
  'wallet-rate',
  'decide-rate',
  'report-made',
  'report-opened',
  'rate-image',
  // A cheat sheet sent to someone: opening a page with its link (never what
  // the link holds)
  'cheat-sheet-opened',
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
  'copy-cli-mcp',
  'desktop-download',
  'year-end-share', // the year-end pages' send button, beaconed by their own script
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
