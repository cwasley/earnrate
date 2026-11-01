// The hosted server's calendar is US Eastern, for "today".
export const easternDate = (at: number | Date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(at)
