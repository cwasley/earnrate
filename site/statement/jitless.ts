import { config } from 'zod'

// zod's compiled parsers probe `new Function`, which the page's policy
// refuses and reports as a violation in the console. Validation is the same
// without them. Imported first, before any module that builds or uses a
// schema.
config({ jitless: true })
