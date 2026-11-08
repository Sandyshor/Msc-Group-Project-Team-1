// Home page FAQ: the questions new international students ask most, with short answers and links onward.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import './HomeFaq.css'

const FAQS = [
  {
    q: 'Which area of Dublin should I live in?',
    a: <>It depends on where your campus is and your budget. The city centre (D1, D2) is close to many colleges but costs more, while areas like Stoneybatter and Phibsborough (D7) or Drumcondra and Glasnevin (D9) are popular with students. <Link to="/questionnaire">Find my match</Link> ranks every district for you.</>,
  },
  {
    q: 'How much does rent cost?',
    a: <>A room in a shared house or apartment typically costs around €700 to €1,200 a month, more in the city centre and less further out. Each district’s typical rents are on its <Link to="/districts">district profile</Link>. Never pay a deposit before viewing a place.</>,
  },
  {
    q: 'How do I get around the city?',
    a: <>Dublin Bus, the Luas tram, the DART and commuter trains cover the city. Pay with a Student Leap Card for cheaper fares. With the TFI 90-minute fare, you can change between them for one price. Dublin Bikes and walking work well in the centre.</>,
  },
  {
    q: 'What do I need to do when I first arrive?',
    a: <>The main steps are registering for your Irish Residence Permit (IRP) if you’re from outside the EU/EEA, getting a PPS number, a Student Leap Card, an Irish SIM and a bank account. Our <Link to="/things-to-know">Things to know</Link> checklist walks you through each one.</>,
  },
  {
    q: 'Can I work while I study?',
    a: <>Students with a Stamp 2 permission can work up to 20 hours a week during term and up to 40 hours a week in the holidays (June to September, and 15 December to 15 January). You’ll need a PPS number, and you should register your job with Revenue.</>,
  },
  {
    q: 'Is Dublin safe?',
    a: <>Dublin is generally a safe city, though like any capital some areas have more recorded crime than others. Each district’s safety section shows how it compares, and the usual big-city common sense applies, especially late at night.</>,
  },
]

export default function HomeFaq() {
  const [open, setOpen] = useState(0)
  return (
    <section className="faq" aria-labelledby="faq-title">
      <div className="faq-inner">
        <div className="faq-intro">
          <p className="faq-kicker">GOOD TO KNOW</p>
          <h2 id="faq-title">Questions new students <em>always ask.</em></h2>
          <p className="faq-lead">Quick answers to help you plan your move to Dublin.</p>
          <div className="faq-actions">
            <button type="button" className="faq-btn faq-btn-solid" onClick={() => window.dispatchEvent(new Event('chatw-open'))}>
              <span aria-hidden="true">💬</span> Ask the Crib Crew Assistant
            </button>
            <Link className="faq-btn" to="/things-to-know">Things to know <span aria-hidden="true">→</span></Link>
          </div>
        </div>
        <div className="faq-list">
          {FAQS.map((f, i) => {
            const isOpen = open === i
            return (
              <div key={f.q} className={`faq-item${isOpen ? ' is-open' : ''}`}>
                <h3>
                  <button type="button" aria-expanded={isOpen} aria-controls={`faq-a-${i}`} id={`faq-q-${i}`} onClick={() => setOpen(isOpen ? -1 : i)}>
                    <span className="faq-n" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                    <span className="faq-q">{f.q}</span>
                    <span className="faq-plus" aria-hidden="true" />
                  </button>
                </h3>
                <div className="faq-a" id={`faq-a-${i}`} role="region" aria-labelledby={`faq-q-${i}`}>
                  <div><p>{f.a}</p></div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
