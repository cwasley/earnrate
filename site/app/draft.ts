// What a field typed over a saved value holds: the typed value, kept only
// while the saved one is what it was when typing began. Then a settings
// panel left open never sends back a value it read before Claude or another
// tab changed it.
export type Draft<T> = { value: T; over: unknown } | null

export const draftShown = <T>(draft: Draft<T>, saved: T, key: unknown): T =>
  draft !== null && Object.is(draft.over, key) ? draft.value : saved
