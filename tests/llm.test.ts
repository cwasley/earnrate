import type Anthropic from '@anthropic-ai/sdk'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import {
  LLM_ENV_VAR,
  LLM_MAX_CALLS_ENV_VAR,
  MERCHANT_CACHE_ENV_VAR,
  WALLET_ENV_VAR,
} from '../src/brand.ts'
import { run } from '../src/cli/run.ts'
import { loadCatalog } from '../src/data/load.ts'
import { recommend } from '../src/engine/recommend.ts'
import type { Recommendation } from '../src/engine/types.ts'
import {
  anthropicClassifier,
  systemPrompt,
} from '../src/merchants/anthropic.ts'
import { memoryCache, openMerchantCache } from '../src/merchants/cache.ts'
import type { Classification, Classifier } from '../src/merchants/classifier.ts'
import { createLlmSession } from '../src/merchants/fallback.ts'
import { baseWallet, purchase, TODAY, withProfile } from './golden/fixtures.ts'

const catalog = await loadCatalog()
const EXAMPLE_WALLET = fileURLToPath(
  new URL('../wallet.example.yaml', import.meta.url),
)

const BESTIA: Omit<Classification, 'model'> = {
  category: 'dining',
  likelyMcc: 5812,
  mayCodeAs: [],
  confidence: 'medium',
  rationale: 'Bestia is a restaurant in downtown Los Angeles.',
}

const answers: Record<string, Omit<Classification, 'model'>> = {
  "Joe's Hardware Santa Monica": {
    category: 'home_improvement',
    likelyMcc: 5251,
    mayCodeAs: [],
    confidence: 'low',
    rationale: 'The name suggests an independent hardware store.',
  },
  Bestia: BESTIA,
  'Blue Door Co': {
    category: 'other',
    likelyMcc: null,
    mayCodeAs: [],
    confidence: 'low',
    rationale: "The name doesn't say what the business sells.",
  },
  'Hotel Bar Downtown': {
    category: 'dining',
    likelyMcc: 5813,
    mayCodeAs: ['travel.hotels'],
    confidence: 'low',
    rationale: 'A bar, possibly run by a hotel.',
  },
}

function fakeClassifier() {
  const calls: string[] = []
  const classifier: Classifier = (merchant) => {
    calls.push(merchant)
    const answer = answers[merchant]
    return answer
      ? Promise.resolve({ ...answer, model: 'fake-model' })
      : Promise.reject(new Error('no fake answer'))
  }
  return { classifier, calls }
}

function session(classifier: Classifier, maxCalls = 20) {
  return createLlmSession({
    classifier,
    cache: memoryCache(),
    maxCalls,
    today: () => TODAY,
  })
}

async function recommendWith(
  classifier: Classifier,
  merchant: string,
): Promise<Recommendation> {
  const p = purchase(merchant, { channel: 'in_store' })
  const resolved = await session(classifier).resolve(catalog, p.merchant, null)
  return recommend(
    catalog,
    withProfile(baseWallet(), 'flat'),
    p,
    resolved.merchant,
  )
}

describe('golden #10 with the classifier', () => {
  test('an unknown local business is classified, labeled and kept low confidence', async () => {
    const { classifier } = fakeClassifier()
    const rec = await recommendWith(classifier, "Joe's Hardware Santa Monica")
    expect(rec.merchant.source).toBe('llm')
    expect(rec.merchant.category).toBe('home_improvement')
    expect(rec.decision).toMatchObject({
      cardId: 'sofi-unlimited-2',
      confidence: 'low',
    })
    expect(rec.assumptions.join(' ')).toMatch(
      /codes as home improvement \(MCC 5251\).*Claude's reasoning: The name suggests/,
    )
    expect(rec.warnings.join(' ')).toMatch(/Claude's guess \(fake-model\)/)
    expect(rec.warnings.join(' ')).not.toMatch(/Couldn't identify/)
  })

  test('a classified restaurant earns dining rates', async () => {
    const { classifier } = fakeClassifier()
    const rec = await recommendWith(classifier, 'Bestia')
    expect(rec.decision).toMatchObject({
      cardId: 'amex-gold',
      confidence: 'medium',
    })
    expect(rec.decision?.effectiveReturnPct).toBeCloseTo(4)
  })

  test('acceptance stays unknown, so an Amex winner gets the usual warning', async () => {
    const { classifier } = fakeClassifier()
    const rec = await recommendWith(classifier, 'Bestia')
    expect(rec.merchant.accepts).toBeNull()
    expect(rec.warnings.join(' ')).toMatch(
      /Not every business takes American Express/,
    )
  })

  test('other possible codings become ambiguity warnings', async () => {
    const { classifier } = fakeClassifier()
    const rec = await recommendWith(classifier, 'Hotel Bar Downtown')
    expect(rec.warnings.join(' ')).toMatch(/may code as hotels instead/)
  })
})

describe('session', () => {
  test('known merchants never reach the classifier', async () => {
    const { classifier, calls } = fakeClassifier()
    const s = session(classifier)
    for (const m of ['Whole Foods', 'chipotle', 'delta.com']) {
      expect((await s.resolve(catalog, m, null)).merchant.source).not.toBe(
        'llm',
      )
    }
    expect(calls).toEqual([])
  })

  test('a cached merchant is not classified again', async () => {
    const { classifier, calls } = fakeClassifier()
    const s = session(classifier)
    const first = await s.resolve(catalog, 'Bestia', null)
    const second = await s.resolve(catalog, 'BESTIA ', null)
    expect(calls).toEqual(['Bestia'])
    expect(first.merchant.inference?.cached).toBe(false)
    expect(second.merchant.inference?.cached).toBe(true)
  })

  test('stops calling after the session limit', async () => {
    const { classifier, calls } = fakeClassifier()
    const s = session(classifier, 1)
    await s.resolve(catalog, 'Bestia', null)
    const skipped = await s.resolve(
      catalog,
      "Joe's Hardware Santa Monica",
      null,
    )
    expect(calls).toHaveLength(1)
    expect(skipped.merchant.source).toBe('none')
    expect(skipped.notices.join(' ')).toMatch(/already made 1 calls/)
  })

  test('a failed call falls back to the offline answer with a notice', async () => {
    const { classifier } = fakeClassifier()
    const r = await session(classifier).resolve(catalog, 'Mystery Shop', null)
    expect(r.merchant.source).toBe('none')
    expect(r.notices.join(' ')).toMatch(/Claude lookup failed: no fake answer/)
  })

  test('a category earnrate does not have is ignored', async () => {
    const bad: Classifier = () =>
      Promise.resolve({ ...BESTIA, category: 'casinos', model: 'x' })
    const r = await session(bad).resolve(catalog, 'Bestia', null)
    expect(r.merchant.source).toBe('none')
    expect(r.notices.join(' ')).toMatch(/"casinos"/)
  })

  test('"other" from Claude is always low confidence', async () => {
    const other: Classifier = () =>
      Promise.resolve({ ...BESTIA, category: 'other', model: 'x' })
    const r = await session(other).resolve(catalog, 'Bestia', null)
    expect(r.merchant.confidence).toBe('low')
  })
})

describe('cache file', () => {
  async function tempFile(contents?: string): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'earnrate-cache-'))
    const file = path.join(dir, 'nested', 'merchant-cache.json')
    if (contents !== undefined) {
      await writeFile(path.join(dir, 'merchant-cache.json'), contents)
      return path.join(dir, 'merchant-cache.json')
    }
    return file
  }

  test('saves and reloads classifications', async () => {
    const file = await tempFile()
    const { classifier, calls } = fakeClassifier()
    const opened = await openMerchantCache(file)
    expect(opened.problem).toBeNull()
    await createLlmSession({
      classifier,
      cache: opened.cache,
      maxCalls: 5,
      today: () => TODAY,
    }).resolve(catalog, 'Bestia', null)

    const reopened = await openMerchantCache(file)
    const r = await createLlmSession({
      classifier,
      cache: reopened.cache,
      maxCalls: 5,
      today: () => '2026-11-01',
    }).resolve(catalog, 'Bestia', null)
    expect(calls).toHaveLength(1)
    expect(r.merchant.inference).toMatchObject({
      cached: true,
      classifiedOn: TODAY,
      model: 'fake-model',
    })
  })

  test('an unreadable cache file is reported and left alone', async () => {
    const file = await tempFile('{ not json')
    const opened = await openMerchantCache(file)
    expect(opened.problem).toMatch(/won't be saved/)
    await opened.cache.set('bestia', {
      ...BESTIA,
      model: 'x',
      classifiedOn: TODAY,
    })
    expect(await readFile(file, 'utf8')).toBe('{ not json')
  })
})

describe('Anthropic classifier', () => {
  function fakeClient(response: Record<string, unknown>) {
    const requests: Record<string, unknown>[] = []
    const client = {
      beta: {
        messages: {
          parse: (params: Record<string, unknown>) => {
            requests.push(params)
            return Promise.resolve(response)
          },
        },
      },
    } as unknown as Anthropic
    return { client, requests }
  }

  const parsed = {
    category: 'dining',
    likely_mcc: 5812,
    may_code_as: ['dining'],
    confidence: 'medium',
    rationale: 'A restaurant.',
  }

  test('sends only the merchant text, with a cached system prompt', async () => {
    const { client, requests } = fakeClient({
      stop_reason: 'end_turn',
      model: 'claude-opus-5-5',
      parsed_output: parsed,
    })
    const result = await anthropicClassifier({ client })(
      'Bestia',
      catalog.categories,
    )
    expect(result).toEqual({
      category: 'dining',
      likelyMcc: 5812,
      mayCodeAs: [],
      confidence: 'medium',
      rationale: 'A restaurant.',
      model: 'claude-opus-5-5',
    })
    const request = requests[0]
    expect(request).toMatchObject({
      model: 'claude-opus-5-5',
      fallbacks: 'default',
      betas: ['server-side-fallback-2026-07-01'],
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: '<merchant>Bestia</merchant>' }],
      system: [
        {
          text: systemPrompt(catalog.categories),
          cache_control: { type: 'ephemeral' },
        },
      ],
    })
  })

  test('the system prompt lists every category and is stable', () => {
    const prompt = systemPrompt(catalog.categories)
    for (const c of catalog.categories) expect(prompt).toContain(`- ${c.id}: `)
    expect(systemPrompt(catalog.categories)).toBe(prompt)
  })

  test('a refusal or an unreadable answer throws', async () => {
    const refusal = fakeClient({
      stop_reason: 'refusal',
      model: 'm',
      parsed_output: null,
    })
    await expect(
      anthropicClassifier({ client: refusal.client })('x', catalog.categories),
    ).rejects.toThrow(/declined/)
    const empty = fakeClient({
      stop_reason: 'max_tokens',
      model: 'm',
      parsed_output: null,
    })
    await expect(
      anthropicClassifier({ client: empty.client })('x', catalog.categories),
    ).rejects.toThrow(/max_tokens/)
  })
})

describe('CLI', () => {
  async function cli(argv: string[], env: Record<string, string> = {}) {
    const dir = await mkdtemp(path.join(tmpdir(), 'earnrate-cli-llm-'))
    const { classifier, calls } = fakeClassifier()
    let stdout = ''
    let stderr = ''
    const code = await run(argv, {
      env: {
        [WALLET_ENV_VAR]: EXAMPLE_WALLET,
        [MERCHANT_CACHE_ENV_VAR]: path.join(dir, 'cache.json'),
        ...env,
      },
      today: TODAY,
      stdout: (t) => (stdout += t),
      stderr: (t) => (stderr += t),
      classifier,
    })
    return { code, stdout, stderr, calls }
  }

  test('off by default', async () => {
    const { stdout, calls } = await cli(['bestia'])
    expect(calls).toEqual([])
    expect(stdout).toMatch(/\(not recognized\)/)
  })

  test('--llm classifies an unknown merchant', async () => {
    const { code, stdout } = await cli(['Bestia', '60', '--llm'])
    expect(code).toBe(0)
    expect(stdout).toMatch(
      /^Bestia \(classified by Claude\) · \$60\n\nUse Amex Gold: 4% back/,
    )
    expect(stdout).toMatch(/Claude's reasoning: Bestia is a restaurant/)
  })

  test("says so when Claude couldn't place the merchant", async () => {
    const { stdout } = await cli(['Blue Door Co', '--llm'])
    expect(stdout).toMatch(/^"Blue Door Co" \(Claude couldn't place it\)\n/)
  })

  test(`${LLM_ENV_VAR}=on turns it on, and --no-llm overrides that`, async () => {
    expect((await cli(['Bestia'], { [LLM_ENV_VAR]: 'on' })).calls).toHaveLength(
      1,
    )
    expect(
      (await cli(['Bestia', '--no-llm'], { [LLM_ENV_VAR]: 'on' })).calls,
    ).toHaveLength(0)
  })

  test('notices go to stderr with --json', async () => {
    const { stdout, stderr } = await cli(['Mystery Shop', '--llm', '--json'])
    expect(JSON.parse(stdout)).toHaveProperty('decision')
    expect(stderr).toMatch(/Claude lookup failed/)
  })

  test('a bad call limit is a usage error', async () => {
    const { code, stderr } = await cli(['Bestia', '--llm'], {
      [LLM_MAX_CALLS_ENV_VAR]: 'lots',
    })
    expect(code).toBe(2)
    expect(stderr).toMatch(/whole number/)
  })
})
