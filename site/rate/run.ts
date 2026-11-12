// The report's slower parts run off the page's thread, so a phone stays
// responsive, and come back one at a time. Without workers they run on the
// page, one part per task.
import type { Catalog } from '../../src/schema/catalog.ts'
import { steps, type Job, type Part, type WorkerRequest } from './steps.ts'

// Calls `onPart` as each part is ready; the function it returns stops the
// job, and nothing more arrives.
export function runReport(
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
