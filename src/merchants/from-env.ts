import {
  LLM_ENV_VAR,
  LLM_MAX_CALLS_ENV_VAR,
  LLM_MODEL_ENV_VAR,
} from '../brand.ts'
import { anthropicClassifier } from './anthropic.ts'
import { merchantCachePath, openMerchantCache } from './cache.ts'
import type { Classifier } from './classifier.ts'
import {
  createLlmSession,
  DEFAULT_MAX_CALLS,
  type LlmSession,
} from './fallback.ts'

const ON = new Set(['1', 'on', 'true', 'yes'])

export function llmEnabled(env: NodeJS.ProcessEnv): boolean {
  return ON.has((env[LLM_ENV_VAR] ?? '').trim().toLowerCase())
}

export function maxCallsFromEnv(env: NodeJS.ProcessEnv): number | null {
  const raw = env[LLM_MAX_CALLS_ENV_VAR]
  if (raw === undefined || raw === '') return DEFAULT_MAX_CALLS
  return /^\d+$/.test(raw) ? Number(raw) : null
}

export type OpenedSession =
  | { kind: 'ok'; session: LlmSession; notices: string[] }
  | { kind: 'error'; message: string }

export async function openLlmSession(options: {
  env: NodeJS.ProcessEnv
  today: () => string
  classifier?: Classifier | undefined
}): Promise<OpenedSession> {
  const maxCalls = maxCallsFromEnv(options.env)
  if (maxCalls === null) {
    return {
      kind: 'error',
      message: `${LLM_MAX_CALLS_ENV_VAR} must be a whole number.`,
    }
  }
  const opened = await openMerchantCache(merchantCachePath(options.env))
  const model = options.env[LLM_MODEL_ENV_VAR]
  return {
    kind: 'ok',
    notices: opened.problem ? [opened.problem] : [],
    session: createLlmSession({
      classifier:
        options.classifier ??
        anthropicClassifier(model === undefined ? {} : { model }),
      cache: opened.cache,
      maxCalls,
      today: options.today,
    }),
  }
}
