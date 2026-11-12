// Stands in for site/report-codes.gen.json in tests: the same codes, from
// the card data as it is now.
import { loadCatalog } from '../../src/data/load.ts'
import { reportCodes } from '../../site/rate/link.ts'

export default reportCodes(await loadCatalog())
