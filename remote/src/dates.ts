// The hosted server's calendar is US Eastern: "today" and a wallet's start
// date use the same zone, so one started late in the evening reads today.
export const easternDate = (at: number | Date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(at)
