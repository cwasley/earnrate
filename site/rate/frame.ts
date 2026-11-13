// The outline of a report while it isn't in yet, in bars (app.css's
// .frame-line) the size of its parts: rate.html shows it before the page's
// script has run, and a short link shows it while the report is fetched.
const line = (extra = '') =>
  `<span class="frame-line${extra === '' ? '' : ` ${extra}`}"></span>`

const tiles = Array.from(
  { length: 15 },
  () =>
    `<li><span class="quick-card frame-tile"><span class="frame-art"></span>${line()}</span></li>`,
).join('')

export const REPORT_FRAME = [
  '<div class="rate-report-frame" aria-hidden="true">',
  `<p class="rate-figure">${line('rate-frame-figure')}</p>`,
  `<p class="rate-frame-per">${line('frame-short')}</p>`,
  `<p class="rate-up-to">${line('frame-short')}</p>`,
  '<ul class="rate-cards"><li></li><li></li><li></li></ul>',
  `<p class="rate-lead">${line()}${line('frame-short')}</p>`,
  '<div class="rate-blocks"><section class="panel rate-frame-panel">',
  `<h2>${line('frame-heading')}</h2><p>${line()}${line('frame-short')}</p>`,
  '</section></div></div>',
].join('')

// rate.html's: the report for someone with saved cards or a shared link,
// and the card picker for someone with none (rate.css shows the one main's
// data-rate picks).
export const RATE_FRAME = [
  '<div class="rate-frame" aria-hidden="true">',
  '<div data-rate-frame="report">',
  `<p class="lede rate-frame-lede">${line()}${line('frame-short')}</p>`,
  REPORT_FRAME,
  '</div>',
  '<div data-rate-frame="pick"><section class="panel first rate-pick">',
  `<h2>${line('frame-heading')}</h2><p>${line()}${line('frame-short')}</p>`,
  `<ul class="quick-cards">${tiles}</ul>`,
  '</section></div></div>',
].join('')
