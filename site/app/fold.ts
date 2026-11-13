import { loadWallet } from './saved-wallet.ts'

// For someone with saved cards, the home page's story below the app folds
// behind one "About earnrate" button, and the header shrinks to its top row
// (app.css, by main's data-fold). A link to a section in the fold, followed
// on load or tapped later (#claude), opens it first so it can scroll there.
export function foldStory(): void {
  const main = document.querySelector('main')
  const hero = main?.querySelector(':scope > header.hero')
  if (!main || !hero || (loadWallet()?.cards.length ?? 0) === 0) return

  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = 'About earnrate'
  const bar = document.createElement('div')
  bar.className = 'about-fold'
  bar.append(button)
  hero.after(bar)

  const set = (open: boolean) => {
    main.dataset.fold = open ? 'open' : 'closed'
    button.setAttribute('aria-expanded', String(open))
  }
  const folded = (id: string) => {
    const target = id === '' ? null : document.getElementById(id)
    return target !== null && !hero.contains(target) && main.contains(target)
  }
  set(folded(decodeURIComponent(location.hash.slice(1))))
  button.addEventListener('click', () => {
    set(main.dataset.fold !== 'open')
  })
  document.addEventListener(
    'click',
    (e) => {
      const link = (e.target as Element | null)?.closest('a[href^="#"]')
      const id = link?.getAttribute('href')?.slice(1) ?? ''
      if (folded(id)) set(true)
    },
    true,
  )
  addEventListener('hashchange', () => {
    if (folded(location.hash.slice(1))) set(true)
  })
}
