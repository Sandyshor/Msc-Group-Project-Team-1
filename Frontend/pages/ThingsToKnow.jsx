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
        how: ['Check what your college offers or recommends.', 'Make sure the policy covers you for the whole time you’re studying.', 'Keep a printed certificate in English. You’ll show it at the airport and at your IRP appointment.'],
        link: ['Irish Immigration Service', 'https://www.irishimmigration.ie/coming-to-study-in-ireland/'],
      },
      {
        id: 'arrival-docs', icon: '🛂', title: 'Carry your arrival documents',
        why: 'An immigration officer checks your papers when you land and stamps your passport. That landing stamp is what lets you book your IRP appointment.',
        how: ['Carry your passport, college acceptance letter, proof of fees paid, proof of funds and medical insurance certificate.', 'Say you’re coming to study. The officer writes on the stamp the date you must register by.'],
        link: ['Coming to study in Ireland', 'https://www.irishimmigration.ie/coming-to-study-in-ireland/'],
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
        why: 'Student and Young Adult Leap Cards cut your fares on Dublin Bus, the Luas, DART and commuter rail.',
        how: ['Aged 19 to 25? The TFI Young Adult Leap Card gives the same discount and needs no college check.', 'Otherwise, apply online for a Student Leap Card with your student ID. Your college confirms you’re a full-time student.', 'Top up online, in shops, at Luas ticket machines or in the TFI Leap Top-Up app.', 'With the TFI 90-minute fare you can change between bus, Luas and DART for one fare.'],
        link: ['Student Leap Card', 'https://www.studentleapcard.ie/'],
      },
      {
        id: 'sim', icon: '📱', title: 'Get an Irish phone number',
        why: 'Banks, employers, landlords and doctors will all ask for an Irish number.',
        how: ['No-contract SIMs need no credit check and you can cancel any time.', 'Some offer an eSIM you can set up before you land.'],
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
        how: ['App-based banks can often open an account within a day.', 'High-street banks ask for photo ID and proof of an Irish address (not a hostel or hotel). Many accept a letter from your college.'],
        link: ['Education in Ireland: banking', 'https://www.educationinireland.com/en/living-in-ireland/on-arrival/banking'],
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
        how: ['Bring printed copies of everything listed in your confirmation email (electronic copies aren’t accepted), usually your passport, college letter, proof of fees paid, medical insurance and proof of funds.', 'The €300 fee is paid by card at the appointment. Cash isn’t accepted.', 'Your IRP card is posted to your home, usually within 15 days of approval.'],
        link: ['Registering your permission', 'https://www.irishimmigration.ie/registering-your-immigration-permission/'],
      },
      {
        id: 'pps', icon: '🔢', title: 'Apply for a PPS number',
        why: 'You need a Personal Public Service Number (PPSN) to work and pay the right tax.',
        how: ['Once you live in Ireland, apply on MyWelfare.ie with a basic MyGovID account.', 'Then go to an Intreo appointment with your passport, proof of your Irish address and a reason, such as a job offer or college letter.'],
        link: ['MyWelfare: PPS number', 'https://www.mywelfare.ie/'],
      },
      {
        id: 'revenue', icon: '🧾', title: 'Set up Revenue myAccount',
        why: 'When you start a job, registering it with Revenue stops you being charged emergency tax.',
        how: ['Register for myAccount on revenue.ie with your PPSN. First-time users get their password by post.', 'When you start a job, use “Add Job or Pension Details” under PAYE Services, with your employer’s tax number and start date.'],
        link: ['Revenue: starting your first job', 'https://www.revenue.ie/en/jobs-and-pensions/starting-your-first-job/index.aspx'],
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
        how: ['Up to 20 hours a week at all other times, across all your jobs.', 'Up to 40 hours a week only in June, July, August and September, and from 15 December to 15 January. Easter and mid-term breaks don’t count.'],
        link: ['Stamp 2 work rules', 'https://workplacerelations.ie/en/news-media/workplace_relations_notices/changes_to_employment_entitlements_of_non-eea_students_holding_immigration_stamp_2.html'],
      },
      {
        id: 'irp-renew', icon: '🔁', title: 'Renew your IRP on time',
        why: 'Your permission must stay valid for your whole course. Don’t let your IRP expire.',
        how: ['Renew online in the Immigration Service portal. You must be in Ireland when you apply.', 'Apply before your IRP card expires, with your new college letter and proof of fees.'],
        link: ['Renew your permission', 'https://www.irishimmigration.ie/registering-your-immigration-permission/how-to-renew-your-current-permission/renewing-your-registration-permission-if-you-live-in-the-republic-of-ireland/'],
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

  return (
    <div className="cg-page ttk-page" data-site-tour="things-to-know">
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
          <span>Tick each step as you complete it. Your progress is saved on this device.</span>
        </div>
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
