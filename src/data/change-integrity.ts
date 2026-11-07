import { isDeepStrictEqual } from 'node:util'
import { changeHeadline, fieldValue, subjectOf } from '../engine/changes.ts'
import { WelcomeOfferSchema } from '../schema/card.ts'
import type { Catalog } from '../schema/catalog.ts'
import {
  CHANGE_SUBJECTS,
  type Change,
  type ChangeSubject,
  type Release,
} from '../schema/changes.ts'

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

// Every key the record gives matches the data; keys it leaves out (a note,
// a default) don't matter. null means absent.
export function matches(expected: unknown, actual: unknown): boolean {
  if (expected === null) return actual === undefined || actual === null
  if (Array.isArray(expected))
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((e, i) => matches(e, actual[i]))
    )
  if (isRecord(expected))
    return (
      isRecord(actual) &&
      Object.entries(expected).every(([k, v]) => matches(v, actual[k]))
    )
  return isDeepStrictEqual(expected, actual)
}

type Touch = {
  at: number // release index, 0 is the newest
  kind: ChangeSubject
  id: string
  change: Change
}

const subjectKind = (c: Change) =>
  CHANGE_SUBJECTS.find((s) => c[s] !== undefined) ?? 'cards'

// One path covers another when they're the same or one is inside the other.
const overlaps = (a: string | undefined, b: string | undefined) =>
  a === undefined ||
  b === undefined ||
  a === b ||
  a.startsWith(`${b}.`) ||
  b.startsWith(`${a}.`)

const removes = (later: Change, field: string | undefined) =>
  later.now === null &&
  (later.field === undefined ||
    (field !== undefined &&
      (field === later.field || field.startsWith(`${later.field}.`))))

export function changeProblems(
  releases: Release[],
  catalog: Catalog,
  changelog: string,
  version: string,
): string[] {
  const problems: string[] = []
  const sections = [...changelog.matchAll(/^## (\S+)$/gm)].map((m) => m[1])
  const versions = releases.map((r) => r.version)
  if (!isDeepStrictEqual(sections, versions))
    problems.push(
      'data/changes.yaml releases must match data/CHANGELOG.md sections, newest first',
    )
  if (versions[0] !== version)
    problems.push(`data/changes.yaml must start with ${version}`)
  for (let i = 1; i < releases.length; i++)
    if ((releases[i]?.date ?? '') > (releases[i - 1]?.date ?? ''))
      problems.push(`${versions[i] ?? ''}: releases must be newest first`)

  const touches: Touch[] = releases.flatMap((r, at) =>
    r.changes.flatMap((change) => {
      const kind = subjectKind(change)
      return (change[kind] ?? []).map((id) => ({ at, kind, id, change }))
    }),
  )

  for (const t of touches) {
    const { change, kind, id, at } = t
    const release = releases[at]
    const where = `${release?.version ?? ''} ${id}${change.field ? ` ${change.field}` : ''}`
    if (change.date !== undefined && change.date > (release?.date ?? ''))
      problems.push(`${where}: date is after its release`)
    if (
      change.detected !== undefined &&
      change.detected > (change.date ?? release?.date ?? '')
    )
      problems.push(`${where}: detected after it was released`)

    const later = touches.filter(
      (o) =>
        o.kind === kind &&
        o.id === id &&
        o.change !== change &&
        o.at <= at &&
        overlaps(o.change.field, change.field),
    )
    const removedLater = later.some(
      (o) => o.at < at && removes(o.change, change.field),
    )
    const subject = subjectOf(catalog, kind, id)
    const value = fieldValue(subject, change.field)
    const removal = change.now === null

    if (subject === undefined && !removedLater && !(removal && !change.field))
      problems.push(`${where}: no ${kind} '${id}' in the data`)
    else if (
      subject !== undefined &&
      value === undefined &&
      !removal &&
      !removedLater
    )
      problems.push(`${where}: no such field`)

    // The newest change to a path must still describe the data.
    if (later.length === 0 && change.now !== undefined) {
      const current = removal && !change.field ? subject : value
      if (!matches(change.now, current))
        problems.push(`${where}: 'now' doesn't match the data`)
    }

    if (change.cause === 'issuer') {
      if (!change.source?.startsWith('https://'))
        problems.push(`${where}: an issuer change needs an https source`)
      if (change.field === 'welcome_offer')
        for (const v of [change.was, change.now])
          if (v !== null && !WelcomeOfferSchema.safeParse(v).success)
            problems.push(`${where}: not a welcome offer: ${JSON.stringify(v)}`)
      try {
        changeHeadline(catalog, change)
      } catch (e) {
        problems.push(`${where}: ${(e as Error).message}`)
      }
    }
  }

  // A value recorded as the old one must be what the previous change left.
  for (const t of touches) {
    if (t.change.was === undefined || t.change.field === undefined) continue
    const before = touches.find(
      (o) =>
        o.kind === t.kind &&
        o.id === t.id &&
        o.at > t.at &&
        o.change.field === t.change.field &&
        o.change.now !== undefined,
    )
    if (before && !matches(t.change.was, before.change.now))
      problems.push(
        `${releases[t.at]?.version ?? ''} ${t.id} ${t.change.field}: 'was' doesn't match the previous change's 'now'`,
      )
  }
  return problems
}
