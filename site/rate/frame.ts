import { perYear, upToText } from './picture-text.ts'

// The outline of a report while it isn't in yet, in bars (app.css's
// .frame-line) and unseen words (.frame-text) the size of its parts: rate.html
// shows it before the page's script has run, and a short link shows it while
// the report is fetched. Its figures are a typical report's, with credits
// still to answer.
const line = (extra = '') =>
  `<span class="frame-line${extra === '' ? '' : ` ${extra}`}"></span>`

const words = (text: string, extra = '') =>
  `<span class="frame-text${extra === '' ? '' : ` ${extra}`}">${text.trim()}</span>`

const tiles = Array.from(
  { length: 18 },
  () =>
    `<li><span class="quick-card frame-tile"><span class="frame-art"></span>${line()}</span></li>`,
).join('')

const BASIS = 'On typical U.S. spending, about $1,990 a month.'

function reportFrame(voice: 'you' | 'neutral'): string {
  const upTo = upToText({ range: { low: 345, high: 769 } }, voice) ?? ''
  return [
    '<div class="rate-report-frame">',
    `<p class="rate-figure">${line('rate-frame-figure')}`,
    `<span class="rate-per">${words(perYear({ counted: [null] }, voice))}</span></p>`,
    `<p class="rate-up-to">${words(upTo)}`,
    voice === 'you' ? ` ${words('Tell us which you use ↓', 'nowrap')}` : '',
    '</p>',
    '<ul class="rate-cards"><li></li><li></li><li></li></ul>',
    `<p class="rate-lead">${words('Without credits: $670 in rewards, less $325 in annual fees.')}</p>`,
    voice === 'you'
      ? `<details class="filters spend-edit"><summary>${words(BASIS, 'frame-basis')} ${words('Change it')}</summary></details>`
      : `<p class="muted rate-basis">${words(BASIS)}</p>`,
    '<div class="rate-blocks"><section class="panel rate-frame-panel">',
    `<h2>${line('frame-heading')}</h2><p>${line()}${line('frame-short')}</p>`,
    '</section></div></div>',
  ].join('')
}

export const REPORT_FRAME = `<div aria-hidden="true" inert>${reportFrame('neutral')}</div>`

// rate.html's: the report for someone with saved cards or a shared link,
// and the card picker for someone with none (rate.css shows the one main's
// data-rate picks).
export const RATE_FRAME = [
  '<div class="rate-frame" aria-hidden="true" inert>',
  '<div data-rate-frame="own">',
  `<p class="lede rate-frame-lede">${words('Your saved cards. Credits you mark here save to My wallet.')}</p>`,
  reportFrame('you'),
  '</div>',
  `<div data-rate-frame="shared">${reportFrame('neutral')}</div>`,
  '<div data-rate-frame="pick"><section class="panel first rate-pick">',
  `<h2>${line('frame-heading')}</h2>`,
  `<p>${words("Tap the cards you have, then see what they earn after fees and how that compares. They're saved to My wallet.")}</p>`,
  `<ul class="quick-cards">${tiles}</ul>`,
  '</section></div></div>',
].join('')
