import { steps, type WorkerRequest } from './steps.ts'

// One job per worker: the page starts a new one when the cards or the
// spending change, and stops this one.
self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  for (const step of steps(e.data.catalog, e.data.job)) self.postMessage(step())
}
