// Synthetic activity files for the statement check: made-up purchases in
// the issuers' column layouts, never copied from a real statement.
const AMEX_HEADER =
  'Date,Description,Amount,Extended Details,Appears On Your Statement As,Address,City/State,Zip Code,Country,Reference,Category'

const amexRow = (
  date: string,
  description: string,
  amount: string,
  category: string,
) =>
  `${date},${description},${amount},"",${description},"100 SAMPLE ST","SAMPLETOWN\nCA",00000,UNITED STATES,'000000000000000000',${category}`

export const AMEX_CSV = [
  AMEX_HEADER,
  amexRow(
    '10/02/2026',
    'WHOLEFDS MKT 10234',
    '84.12',
    'Merchandise & Supplies-Groceries',
  ),
  amexRow('10/04/2026', 'SHELL OIL 57444', '41.30', 'Transportation-Fuel'),
  amexRow(
    '10/05/2026',
    'TST* HARBOR NOODLE BAR',
    '38.75',
    'Restaurant-Restaurant',
  ),
  amexRow(
    '10/09/2026',
    'TARGET 00012345',
    '62.18',
    'Merchandise & Supplies-Groceries',
  ),
  amexRow(
    '10/11/2026',
    'WHOLEFDS MKT 10234',
    '120.40',
    'Merchandise & Supplies-Groceries',
  ),
  amexRow('10/14/2026', 'ONLINE PAYMENT - THANK YOU', '-500.00', ''),
  amexRow(
    '10/16/2026',
    'NETFLIX.COM',
    '15.49',
    'Merchandise & Supplies-Internet Purchase',
  ),
  amexRow(
    '10/18/2026',
    'SQ *MAPLE AND OAK GOODS',
    '24.00',
    'Merchandise & Supplies-General Retail',
  ),
  amexRow(
    '10/20/2026',
    'WHOLEFDS MKT 10234',
    '-12.00',
    'Merchandise & Supplies-Groceries',
  ),
  amexRow(
    '10/22/2026',
    'Annual Membership Fee',
    '325.00',
    'Fees & Adjustments-Fees & Adjustments',
  ),
  amexRow('10/25/2026', 'DELTA AIR LINES', '312.60', 'Travel-Airline'),
  amexRow(
    '10/26/2026',
    'COSTCO WHSE #0123',
    '88.40',
    'Merchandise & Supplies-Wholesale Stores',
  ),
].join('\r\n')

export const CHASE_CSV = [
  'Transaction Date,Post Date,Description,Category,Type,Amount,Memo',
  '10/03/2026,10/04/2026,STARBUCKS STORE 01234,Food & Drink,Sale,-6.45,',
  '10/06/2026,10/07/2026,TRADER JOE S #552,Groceries,Sale,-73.20,',
  '10/08/2026,10/08/2026,AUTOMATIC PAYMENT - THANK YOU,,Payment,400.00,',
  '10/12/2026,10/13/2026,CVS/PHARMACY #01234,Health & Wellness,Sale,-18.99,',
  '10/15/2026,10/16/2026,AMAZON.COM*AB12CD34,Shopping,Sale,-45.00,',
  '10/19/2026,10/20/2026,TST* BLUE HERON CAFE,Food & Drink,Sale,-27.80,',
  '10/21/2026,10/21/2026,ANNUAL MEMBERSHIP FEE,Fees & Adjustments,Fee,-95.00,',
  '10/23/2026,10/24/2026,SHELL OIL 57444,Gas,Sale,-38.10,',
  '10/26/2026,10/27/2026,AMAZON.COM*AB12CD34,Shopping,Return,12.00,',
  '11/01/2026,11/02/2026,TRADER JOE S #552,Groceries,Sale,-51.75,',
].join('\n')

export const OTHER_CSV = 'Posted,Payee,Debit,Credit\n10/02/2026,SAMPLE,10.00,\n'
