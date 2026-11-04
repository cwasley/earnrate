import { isEvent, type SiteEvent } from '../events.ts'

// Each event is sent at most once per page load, so the counts read as
// "visits that did this". The beacon carries only the event's name.
const sent = new Set<SiteEvent>()

export function track(event: SiteEvent) {
  if (!import.meta.env.PROD || sent.has(event)) return
  sent.add(event)
  try {
    navigator.sendBeacon('/count', event)
  } catch {
    // Counting never gets in the way.
  }
}

// The home page's own links and buttons name their event in data-count.
export function trackClicks() {
  document.addEventListener('click', (e) => {
    const name = (e.target as Element | null)
      ?.closest('[data-count]')
      ?.getAttribute('data-count')
    if (name && isEvent(name)) track(name)
  })
}

// Buttons with data-copy put that text on the clipboard.
export function copyButtons() {
  document.addEventListener('click', (e) => {
    const button = (e.target as Element | null)?.closest<HTMLElement>(
      '[data-copy]',
    )
    const text = button?.dataset.copy
    if (!button || text === undefined) return
    void navigator.clipboard.writeText(text).then(() => {
      const label = button.textContent
      button.textContent = 'Copied'
      setTimeout(() => {
        button.textContent = label
      }, 1500)
    })
  })
}
