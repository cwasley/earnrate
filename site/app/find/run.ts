// Get a card's answer is worked out off the page's thread, so a phone
// stays responsive while it runs. Without workers it runs on the page, one
// part per task.
import type { Catalog } from '../../../src/schema/catalog.ts'
import type { Wallet } from '../../../src/schema/wallet.ts'
import { engineOptions, type Saved, type Settings } from '../settings.ts'
import { isTypicalRows, type Row } from '../spending-rows.ts'
import { steps, type Job, type Part, type WorkerRequest } from './steps.ts'

// Calls `onPart` as each part is ready; the function it returns stops the
// job, and nothing more arrives.
export function runAnswer(
  catalog: Catalog,
  job: Job,
  onPart: (p: Part) => void,
): () => void {
  let stopped = false
  let worker: Worker | null = null

  const onPage = () => {
    const queue = steps(catalog, job)
    const next = () => {
      const step = queue.shift()
      if (stopped || !step) return
      onPart(step())
      setTimeout(next, 0)
    }
    setTimeout(next, 0)
  }

  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
    })
  } catch {
    worker = null
  }
  if (worker) {
    const w = worker
    w.onmessage = (e: MessageEvent<Part>) => {
      if (!stopped) onPart(e.data)
      if (e.data.part === 'done') w.terminate()
    }
    w.onerror = () => {
      w.terminate()
      if (!stopped) onPage()
    }
    const request: WorkerRequest = { catalog, job }
    w.postMessage(request)
  } else onPage()

  return () => {
    stopped = true
    worker?.terminate()
  }
}

// The job for these rows and settings, built the same way wherever it's
// asked for, so an answer started before the tab opens is found again.
// With `wallet`, the job is a new card for it rather than the best cards
// from scratch.
export function jobFor(
  rows: Row[],
  settings: Settings,
  saved: Saved,
  today: string,
  wallet: Wallet | null = null,
): Job {
  return {
    rows,
    typical: isTypicalRows(rows),
    options: engineOptions(settings, saved),
    offerFilters: {
      kind: settings.kind,
      business: settings.business,
      noAnnualFee: settings.noFee,
      includeHeld: true,
    },
    today,
    ...(wallet ? { wallet } : {}),
  }
}

export type Answer = Extract<Part, { part: 'answer' }>

type Latest = {
  key: string
  answer: Answer | null
  waiting: Set<(a: Answer) => void>
  stop: () => void
}

// One answer at a time, kept after the tab closes: the home page can start
// it before the tab opens, and going back to the tab finds it done. A
// different job stops the one before it.
let latest: Latest | null = null

export function readyAnswer(job: Job): Answer | null {
  return latest?.key === JSON.stringify(job) ? latest.answer : null
}

// Starts the job unless it's the one already started, and calls `onAnswer`
// once its answer is in; the function it returns stops listening.
export function answerFor(
  catalog: Catalog,
  job: Job,
  onAnswer?: (a: Answer) => void,
): () => void {
  const key = JSON.stringify(job)
  let entry = latest
  if (entry?.key !== key) {
    latest?.stop()
    const fresh: Latest = {
      key,
      answer: null,
      waiting: new Set(),
      stop: () => {},
    }
    fresh.stop = runAnswer(catalog, job, (p) => {
      if (p.part !== 'answer') return
      fresh.answer = p
      for (const f of fresh.waiting) f(p)
      fresh.waiting.clear()
    })
    latest = entry = fresh
  }
  if (!onAnswer) return () => {}
  if (entry.answer) {
    onAnswer(entry.answer)
    return () => {}
  }
  const waiting = entry.waiting
  waiting.add(onAnswer)
  return () => waiting.delete(onAnswer)
}
