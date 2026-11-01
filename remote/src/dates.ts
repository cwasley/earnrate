// The hosted server's calendar is US Eastern: "today" and a wallet's start
// date use the same zone, so one started late in the evening reads today.
export const easternDate = (at: number | Date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(at)

// "2026-11-01T08:28" in the same zone, for when a wallet began.
export function easternMinute(at: number): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  )
  return `${parts.year ?? ''}-${parts.month ?? ''}-${parts.day ?? ''}T${parts.hour ?? ''}:${parts.minute ?? ''}`
}
