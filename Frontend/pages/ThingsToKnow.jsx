// "Things to know": an arrival checklist for international students moving to Dublin, grouped by when each step
// matters. Each item says why it matters, how to do it, and links to the official source. Ticks are remembered
// on this device only.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import './CityGuide.css'
import './ThingsToKnow.css'

const STORE_KEY = 'fmd-things-done'

const PHASES = [
  {
    id: 'before',
    title: 'Before you fly',
    note: 'Sort these out at home so your first weeks are easier.',
    items: [
      {
        id: 'insurance', icon: '🩺', title: 'Private medical insurance',
        why: 'Students from outside the EU/EEA need private medical insurance to register for their IRP.',
        how: ['Check what your college offers or recommends.', 'Make sure the policy covers you for the whole time you’re studying.', 'Keep the certificate: you’ll show it at your IRP appointment.'],
        link: ['Irish Immigration Service', 'https://www.irishimmigration.ie/my-situation-has-changed-since-i-arrived-in-ireland/study-in-ireland/'],
      },
      {
        id: 'arrival-docs', icon: '🛂', title: 'Carry your arrival documents',
        why: 'An immigration officer checks your papers when you land and stamps your passport. That landing stamp is what lets you book your IRP appointment.',
        how: ['Carry your passport, college acceptance letter, proof of fees paid, proof of funds and medical insurance certificate.', 'Say you’re coming to study. The officer writes on the stamp the date you must register by.'],
        link: ['Coming to study in Ireland', 'https://www.irishimmigration.ie/my-situation-has-changed-since-i-arrived-in-ireland/study-in-ireland/'],
      },
    ],
  },
  {
    id: 'week',
    title: 'Your first week',
    note: 'Get connected, and book your IRP appointment as soon as you land.',
    items: [
      {
        id: 'leap', icon: '🚋', title: 'Get a Student Leap Card',
        why: 'It gives you cheaper fares on Dublin Bus, the Luas, DART and commuter rail than paying cash.',
        how: ['Apply online with your college details (or at your college’s student services).', 'Top up in shops, at Luas stops or in the TFI Leap Top-Up app.', 'With the TFI 90-minute fare you can change between bus, Luas and DART for one fare.'],
        link: ['Student Leap Card', 'https://www.studentleapcard.ie/'],
      },
      {
        id: 'sim', icon: '📱', title: 'Get an Irish phone number',
        why: 'Banks, employers, landlords and doctors will all ask for an Irish number.',
        how: ['No-contract SIMs need no credit check and you can cancel any time.', 'Most offer an eSIM, so you can set one up before you land.'],
        // Popular low-cost, no-contract plans. Prices as published, checked 8 Nov 2026; we're not affiliated with any.
        options: [
          { name: 'Lyca Mobile', plan: 'Lyca Unlimited', price: '€8.99', per: 'per 28 days', detail: 'Unlimited 5G data, calls and texts; 100 international minutes to 42 countries', url: 'https://www.lycamobile.ie/en/bundles/' },
          { name: 'Lidl Connect', plan: 'Lidl Connect', price: '€12.99', per: 'a month', detail: 'Unlimited 5G data, calls and texts; sign up in the Lidl Plus app or with a SIM from any Lidl store', url: 'https://www.lidl.ie/c/lidl-connect' },
          { name: '48', plan: '48 plan', price: '€9.99', per: 'a month for 6 months, then €12.99', detail: 'Unlimited 5G data, 5,000 minutes and texts; €9.99 activation fee', url: 'https://48.ie/', indicative: true },
        ],
        optionsNote: 'Prices checked 8 November 2026 on each provider’s website (48’s via SmartSaver.ie). Offers change often, so check before you sign up. We’re not affiliated with any provider.',
      },
      {
        id: 'bank', icon: '💳', title: 'Open a bank account',
        why: 'Your rent, salary and Leap Card top-ups are much easier with an Irish IBAN.',
        how: ['App-based banks can often open an account within a day.', 'High-street banks usually ask for proof of address, so a letter from your college can help.'],
        link: ['Citizens Information: bank accounts', 'https://www.citizensinformation.ie/en/money-and-tax/personal-finance/banking/opening-a-bank-account/'],
      },
      {
        id: 'irp-book', icon: '📅', title: 'Book your IRP appointment',
        why: 'You can only book once you’re in Ireland: the booking asks for the date on your passport’s landing stamp.',
        how: ['Book online in the Immigration Service portal. Booking is free.', 'Get an appointment before the date written on your landing stamp. It is often up to 90 days, but can be shorter.', 'Slots go fast at the start of term, so book in your first days and check back for cancellations.'],
        link: ['Book at Burgh Quay', 'https://www.irishimmigration.ie/burgh-quay-appointments/'],
      },
    ],
  },
  {
    id: 'month',
    title: 'Your first month',
    note: 'The official paperwork. Do these as soon as you can.',
    items: [
      {
        id: 'irp', icon: '🪪', title: 'Go to your IRP appointment',
        why: 'Non-EU/EEA students staying more than 90 days register in person at Burgh Quay, Dublin 2, and get an Irish Residence Permit (IRP) card with Stamp 2.',
        how: ['Bring your passport, appointment confirmation, college letter, proof of fees paid, medical insurance, proof of funds and proof of your Irish address.', 'The €300 fee is paid by card at the appointment. Cash isn’t accepted.', 'Your IRP card is posted to you, usually within about 15 working days.'],
        link: ['Registering your permission', 'https://www.irishimmigration.ie/registering-your-immigration-permission/'],
      },
      {
        id: 'pps', icon: '🔢', title: 'Apply for a PPS number',
        why: 'Your Personal Public Service Number (PPSN) is needed to work, pay tax and use public services.',
        how: ['Apply online on MyWelfare.ie once you have an address in Ireland.', 'You’ll need your passport (and IRP if you have it) and proof of address.'],
        link: ['MyWelfare: PPS number', 'https://www.mywelfare.ie/'],
      },
      {
        id: 'revenue', icon: '🧾', title: 'Set up Revenue myAccount',
        why: 'When you start a job, registering it with Revenue stops you being charged emergency tax.',
        how: ['Create a myAccount on revenue.ie with your PPSN.', 'Add your job under “Jobs and Pensions” when you start work.'],
        link: ['Revenue myAccount', 'https://www.revenue.ie/en/online-services/services/manage-your-record/myaccount.aspx'],
      },
    ],
  },
  {
    id: 'living',
    title: 'Living in Dublin',
    note: 'Good to know for the rest of your stay.',
    items: [
      {
        id: 'work', icon: '💼', title: 'Know your work rules',
        why: 'Students with a Stamp 2 permission can work part-time, within set limits.',
        how: ['Up to 20 hours a week during term.', 'Up to 40 hours a week in the holidays: June to September, and 15 December to 15 January.'],
        link: ['Working while studying', 'https://www.irishimmigration.ie/my-situation-has-changed-since-i-arrived-in-ireland/study-in-ireland/'],
      },
      {
        id: 'irp-renew', icon: '🔁', title: 'Renew your IRP on time',
        why: 'Your permission must stay valid for your whole course. Don’t let your IRP expire.',
        how: ['Dublin residents usually renew online.', 'Apply well before your card’s expiry date, with your new college letter and proof of fees.'],
        link: ['Renew your permission', 'https://www.irishimmigration.ie/registering-your-immigration-permission/'],
      },
      {
        id: 'health', icon: '🏥', title: 'Find a GP, and know the emergency number',
        why: 'Knowing where to go before you’re unwell saves a lot of stress.',
        how: ['Your college’s student health service is a good first stop.', 'Pharmacies can help with minor illnesses.', 'In an emergency, call 112 or 999.'],
        link: ['Citizens Information: health', 'https://www.citizensinformation.ie/en/health/'],
      },
      {
        id: 'rent', icon: '🔑', title: 'Rent safely',
        why: 'Rental scams target newcomers, especially before term starts.',
        how: ['Never pay a deposit before viewing (in person or on a live video call).', 'Get a written agreement and a receipt for every payment.', 'Threshold gives free advice if something goes wrong.'],
        link: ['Threshold', 'https://www.threshold.ie/'],
      },
    ],
  },
]

const ALL_IDS = PHASES.flatMap((p) => p.items.map((i) => i.id))

function loadDone() {
  try { return new Set(JSON.parse(localStorage.getItem(STORE_KEY)) || []) } catch { return new Set() }
}

export default function ThingsToKnow() {
  const [done, setDone] = useState(loadDone)
  useEffect(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify([...done])) } catch { /* private mode */ } }, [done])
  const toggle = (id) => setDone((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const count = ALL_IDS.filter((id) => done.has(id)).length
  const pct = Math.round((count / ALL_IDS.length) * 100)

  return (
    <div className="cg-page ttk-page">
      <header className="cg-hero">
        <img className="cg-hero-img" src="/images/flow/georgian-doors.jpg" alt="" />
        <div className="cg-hero-text">
          <p className="cg-kicker">NEW TO DUBLIN</p>
          <h1>Things to know <em>before you settle in.</em></h1>
          <p className="cg-lead">Your arrival checklist: the permits, numbers and cards every international student needs, in the order you’ll need them.</p>
          <ul className="cg-stats">
            <li><strong>{ALL_IDS.length}</strong>essentials</li>
            <li><strong>4</strong>stages</li>
            <li><strong>✓</strong>tick off as you go</li>
          </ul>
        </div>
        <p className="cg-hero-credit">Georgian doors, Dublin · Photo: <a href="https://commons.wikimedia.org/wiki/File:The_Doors_of_Dublin_(7580307812).jpg" target="_blank" rel="noreferrer">Tim Sackton</a>, CC BY-SA 2.0</p>
      </header>

      <div className="ttk-progress" aria-live="polite">
        <div>
          <strong>{count === ALL_IDS.length ? 'All done. Welcome to Dublin! 🎉' : `${count} of ${ALL_IDS.length} done`}</strong>
          <span>Tick each step as you complete it. Your progress is saved on this device.</span>
        </div>
        <span className="ttk-bar" role="img" aria-label={`${pct}% complete`}><i style={{ width: `${pct}%` }} /></span>
        <nav className="ttk-jump" aria-label="Jump to a stage">
          {PHASES.map((p, i) => <a key={p.id} href={`#${p.id}`}><b>{i + 1}</b>{p.title}</a>)}
        </nav>
      </div>

      <div className="ttk-phases">
        {PHASES.map((phase, pi) => (
          <section key={phase.id} id={phase.id} className="ttk-phase">
            <div className="ttk-phase-head">
              <span className="ttk-num">{pi + 1}</span>
              <div>
                <h2>{phase.title}</h2>
                <p>{phase.note}</p>
              </div>
            </div>
            <div className="ttk-grid">
              {phase.items.map((item) => {
                const isDone = done.has(item.id)
                return (
                  <article key={item.id} className={`ttk-card${isDone ? ' is-done' : ''}`}>
                    <div className="ttk-card-head">
                      <span className="ttk-icon" aria-hidden="true">{item.icon}</span>
                      <h3>{item.title}</h3>
                      <button type="button" className="ttk-check" aria-pressed={isDone} onClick={() => toggle(item.id)}
                        aria-label={isDone ? `Mark “${item.title}” as not done` : `Mark “${item.title}” as done`}>
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
                      </button>
                    </div>
                    <p className="ttk-why">{item.why}</p>
                    <ul className="ttk-how">{item.how.map((h) => <li key={h}>{h}</li>)}</ul>
                    {item.options && (
                      <div className="ttk-options">
                        {item.options.map((o) => (
                          <a key={o.name} className="ttk-option" href={o.url} target="_blank" rel="noopener noreferrer">
                            <span className="ttk-option-head"><strong>{o.name}</strong><span aria-hidden="true">↗</span></span>
                            <span className="ttk-option-price"><b>{o.price}</b> {o.per}{o.indicative && <em> · indicative</em>}</span>
                            <span className="ttk-option-detail">{o.detail}</span>
                          </a>
                        ))}
                        <p className="ttk-options-note">{item.optionsNote}</p>
                      </div>
                    )}
                    {item.link && (
                      <a className="ttk-link" href={item.link[1]} target="_blank" rel="noreferrer">{item.link[0]} <span aria-hidden="true">↗</span></a>
                    )}
                  </article>
                )
              })}
            </div>
          </section>
        ))}
      </div>

      <aside className="ttk-cta">
        <div>
          <h2>Next: find where you’ll live</h2>
          <p>Answer a few questions and we’ll rank Dublin’s neighbourhoods for your budget and university.</p>
        </div>
        <Link className="ttk-cta-btn" to="/questionnaire">Find my match <span aria-hidden="true">→</span></Link>
      </aside>
      <p className="ttk-disclaimer">Rules, fees and processes change. This page is general guidance, so always check the linked official sites before you act.</p>
    </div>
  )
}
