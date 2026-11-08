// The site logo in the header: the door, the "Find My Dublin" wordmark, and a graduation cap on the D that
// animates (drops in on load, tips its tassel now and then, and gets tossed in the air on hover or click).
// The wordmark images have the cap removed; the cap is drawn here in the same place and colours.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import './BrandLogo.css'

export default function BrandLogo({ light }) {
  const [toss, setToss] = useState(0) // each hover restarts the toss

  return (
    <Link className={`brand${light ? ' is-light' : ''}`} to="/" onMouseEnter={() => setToss((n) => n + 1)} onFocus={() => setToss((n) => n + 1)}>
      <img className="brand-logo" src="/images/find-your-dublin-logo.png" alt="" />
      <span className="brand-word">
        <img
          className="brand-wordmark"
          // dark letters on the light homepage bar, light letters on the dark green bar of the other pages
          src={light ? '/images/find-my-dublin-wordmark-nocap-light.png' : '/images/find-my-dublin-wordmark-nocap.png'}
          alt="Find My Dublin"
        />
        {/* drawn in the wordmark image's own pixel grid (3230 x 768), over the D */}
        <svg className={`brand-cap${toss ? (toss % 2 ? ' toss-a' : ' toss-b') : ''}`} viewBox="1700 100 470 430" aria-hidden="true">
          <g className="cap-hat">
            <path className="cap-skull" d="M1840 248 2056 216 2063 278 1960 302 1847 288Z" />
            <path className="cap-board" d="M1722 262 1890 118 2142 150 2060 216Z" />
            <circle className="cap-button" cx="1925" cy="184" r="12" />
            <g className="cap-tassel">
              <path className="cap-cord" d="M1925 184C1840 186 1790 214 1776 262L1785 402" />
              <rect className="cap-knot" x="1765" y="398" width="38" height="24" rx="6" />
              <path className="cap-fringe" d="M1770 420h30l38 98h-102Z" />
              <path className="cap-strands" d="M1778 424l-22 92M1786 424l-10 92M1794 424l4 92M1800 424l18 92" />
            </g>
          </g>
        </svg>
      </span>
    </Link>
  )
}
