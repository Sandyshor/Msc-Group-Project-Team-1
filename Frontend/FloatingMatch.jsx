// "Find my match" medallion that hangs on a string from the top-right corner once the visitor has scrolled past
// the hero (home page) or down the Things to know page, swinging gently to invite a click.
// It never sits on top of the page: when text, a button or a picture is underneath it, it tucks up so only its
// edge peeks out, and drops back down on hover / focus or as soon as the space under it is clear.
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import './FloatingMatch.css'

const PAGES = { '/': '[data-site-tour="home"]', '/things-to-know': null } // page -> what to scroll past first
const SOLID = 'a, button, input, select, textarea, video, iframe, canvas, img, svg, [role="button"], .leaflet-container'

// is anything real (text, controls, pictures) under this box? Looks underneath the medallion itself.
function busyUnder(self, rect) {
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) {
      const x = rect.left + ((i + 0.5) / 5) * rect.width
      const y = rect.top + ((j + 0.5) / 5) * rect.height
      const stack = document.elementsFromPoint(x, y).filter((el) => !self.contains(el)).slice(0, 6)
      const hit = stack.some((el) => {
        if (el.closest('.chatw, .site-tour')) return false
        // a picture, video or map counts unless it is a full-width background; a wide button or link counts
        // only where its text is (checked below), so a full-width FAQ row doesn't push the medallion away
        const solid = el.closest(SOLID)
        if (solid && solid.getBoundingClientRect().width < window.innerWidth * 0.6) return true
        return [...el.childNodes].some((n) => {
          if (n.nodeType !== 3 || !n.textContent.trim()) return false
          const range = document.createRange()
          range.selectNodeContents(n)
          return [...range.getClientRects()].some((q) => x >= q.left - 4 && x <= q.right + 4 && y >= q.top - 4 && y <= q.bottom + 4)
        })
      })
      if (hit) return true
    }
  }
  return false
}

export default function FloatingMatch({ hidden = false }) {
  const { pathname } = useLocation()
  const ref = useRef(null)
  const [shown, setShown] = useState(false)
  const [tucked, setTucked] = useState(false)
  const onPage = pathname in PAGES

  useEffect(() => {
    setShown(false)
    setTucked(false)
    if (!onPage) return undefined
    let frame = 0
    let idle = 0
    const check = () => {
      const past = PAGES[pathname]
      const hero = past && document.querySelector(past)
      // shown once the page's own button (the hero) has scrolled away
      const show = hero ? hero.getBoundingClientRect().bottom < 120 : window.scrollY > 420
      setShown(show)
      const el = ref.current
      if (!show || !el) return
      // measure where the medallion hangs when it is out (not where it is while tucked into the edge)
      const r = el.querySelector('.fm-disc').getBoundingClientRect()
      const shift = new DOMMatrixReadOnly(getComputedStyle(el).transform)
      const down = { left: r.left - shift.m41, top: r.top - shift.m42, width: r.width, height: r.height }
      setTucked(busyUnder(el, { left: down.left - 6, top: down.top - 6, width: down.width + 12, height: down.height + 12 }))
    }
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => { clearTimeout(idle); idle = setTimeout(check, 90) })
    }
    const first = setTimeout(check, 400)
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      clearTimeout(first)
      clearTimeout(idle)
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [pathname, onPage])

  if (!onPage) return null
  return (
    <Link
      ref={ref}
      to="/questionnaire"
      className={`fm${shown && !hidden ? ' is-shown' : ''}${tucked ? ' is-tucked' : ''}`}
      aria-label="Find my match: start the questionnaire"
      aria-hidden={!shown || hidden}
      tabIndex={shown && !hidden ? 0 : -1}
    >
      <span className="fm-swing">
        <span className="fm-string" aria-hidden="true" />
        <span className="fm-ring" aria-hidden="true" />
        <span className="fm-disc">
          <svg className="fm-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 21s-6.5-5.8-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15.2 12 21 12 21Z" />
            <path d="m9.6 10.2 1.7 1.7 3.2-3.4" />
          </svg>
          <span className="fm-word">Find my<br />match</span>
        </span>
        <span className="fm-label" aria-hidden="true">Find my match <b>→</b></span>
      </span>
    </Link>
  )
}
