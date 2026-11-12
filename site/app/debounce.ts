export type Debouncer = {
  run: (fn: () => void) => void // replaces any call still waiting
  flush: () => void // the waiting call, now
  cancel: () => void
}

// Runs the last call given once `ms` pass without another.
export function debouncer(ms: number): Debouncer {
  let timer: ReturnType<typeof setTimeout> | null = null
  let waiting: (() => void) | null = null
  const cancel = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    waiting = null
  }
  const flush = () => {
    const fn = waiting
    cancel()
    fn?.()
  }
  return {
    run: (fn) => {
      cancel()
      waiting = fn
      timer = setTimeout(flush, ms)
    },
    flush,
    cancel,
  }
}
