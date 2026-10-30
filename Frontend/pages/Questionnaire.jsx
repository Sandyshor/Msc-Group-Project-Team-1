import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import './Questionnaire.css'
import CommuteFields from './CommuteFields'
import PrioritySlider, { DEFAULT_IMPORTANCE } from './PrioritySlider'

// Values match the university names in the backend's commute data.
const UNIVERSITIES = [
  ['TU Dublin - Aungier Street', 'Technological University Dublin — Aungier Street Campus'],
  ['TU Dublin - Bolton Street', 'Technological University Dublin — Bolton Street Campus'],
  ['TU Dublin - Grangegorman', 'Technological University Dublin — Grangegorman Campus'],
  ['TU Dublin - Blanchardstown', 'Technological University Dublin — Blanchardstown Campus'],
  ['TU Dublin - Tallaght', 'Technological University Dublin — Tallaght Campus'],
  ['University College Dublin - Belfield', 'University College Dublin — Belfield'],
  ['Dublin City University - Glasnevin', 'Dublin City University — Glasnevin Campus'],
  ["DCU - St Patrick's Campus", "Dublin City University — St Patrick's Campus"],
  ['Trinity College Dublin', 'Trinity College Dublin'],
  ['Royal College of Surgeons Ireland', 'Royal College of Surgeons in Ireland'],
  ['National College of Art and Design', 'National College of Art and Design'],
  ['National College of Ireland - IFSC', 'National College of Ireland — IFSC'],
  ['Griffith College Dublin', 'Griffith College Dublin'],
  ['Dublin Business School', 'Dublin Business School'],
  ['IADT - Dun Laoghaire', 'IADT — Dún Laoghaire'],
]

// label, icon, backend accommodation key (null = no rent data yet)
const ROOM_TYPES = [
  ['1 BHK apartment', '⌂', 'one_bed'],
  ['2 BHK apartment', '⌂', 'two_bed'],
  ['Private room', '▣', 'private_room'],
  ['Double sharing', '♧', 'shared_room'],
  ['Student accommodation', '⌂', null],
]

// name, hint, items that can be rated separately instead (as in the backend)
const FACTORS = [
  ['Rent', 'Cheaper rent'],
  ['Commute', 'A short commute to your university'],
  ['Shopping & Groceries', 'Supermarkets, grocery shops and shopping centres',
    ['Supermarkets', 'Grocery Shops', 'Shopping Malls']],
  ['Restaurants', 'Places to eat out'],
  ['Healthcare', 'Hospitals and pharmacies', ['Hospitals', 'Pharmacies']],
  ['Recreation & Wellness', 'Gyms and parks', ['Gyms', 'Parks']],
]

function joinWords(items) {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}


function Questionnaire() {
  const [step, setStep] = useState(1)
  const [budget, setBudget] = useState(1000)
  const [destination, setDestination] = useState('')
  const [roomType, setRoomType] = useState('Private room')
  const [commute, setCommute] = useState({ travelMode: 'public_transport', maxCommute: null })
  const [importance, setImportance] = useState(
    Object.fromEntries(
      FACTORS.flatMap(([name, , items = []]) => [name, ...items]).map((name) => [name, DEFAULT_IMPORTANCE])
    )
  )
  const [separately, setSeparately] = useState({})
  const navigate = useNavigate()

  const accommodation = ROOM_TYPES.find(([label]) => label === roomType)[2]
  // A category rated "separately" is replaced by its items, as in the backend.
  const activeImportance = Object.fromEntries(
    FACTORS.flatMap(([name, , items]) =>
      items && separately[name] ? items.map((item) => [item, importance[item]]) : [[name, importance[name]]]
    )
  )
  const allNotImportant = Object.values(activeImportance).every((value) => value === 0)

  function setFactorImportance(name, value) {
    setImportance({ ...importance, [name]: value })
  }

  function handleContinue(event) {
    event.preventDefault()
    setStep(2)
    window.scrollTo(0, 0)
  }

  function handleSubmit(event) {
    event.preventDefault()
    navigate('/results', {
      state: {
        university: destination,
        budget,
        accommodation,
        accommodationLabel: roomType,
        importance: activeImportance,
        travelMode: commute.travelMode,
        maxCommute: commute.maxCommute,
      },
    })
  }

  return (
    <section className="questionnaire-page">
      <div className="questionnaire-container">
        {step === 1 ? (
          <Link className="back-link" to="/">
            ← Back to home
          </Link>
        ) : (
          <button className="back-link back-button" type="button" onClick={() => setStep(1)}>
            ← Back to your situation
          </button>
        )}

        {/* Heading and progress sit in their own panel (left column on wide screens) */}
        <div className="questionnaire-intro">
          <p className="eyebrow">LET'S FIND YOUR PLACE</p>

          <div className="progress-info">
            <span>{step === 1 ? 'YOUR SITUATION' : 'YOUR PRIORITIES'}</span>
            <span>STEP {step} OF 3</span>
          </div>

          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${(step / 3) * 100}%` }} />
          </div>

          {step === 1 ? (
            <>
              <h1>
                First, tell us a little
                <em> about your life.</em>
              </h1>

              <p className="questionnaire-description">
                We'll use your answers to find Dublin neighbourhoods
                that fit your budget and everyday routine.
              </p>
            </>
          ) : (
            <>
              <h1>
                What matters most
                <em> to you?</em>
              </h1>

              <p className="questionnaire-description">
                Tell us how important each of these is. We'll weigh them to rank
                the neighbourhoods that suit you best.
              </p>
            </>
          )}
        </div>

        {step === 1 ? (
          <>
            <form onSubmit={handleContinue}>
              <div className="question-group">
                <label htmlFor="budget">
                  What's your monthly accommodation budget?
                </label>

                <p className="field-hint">
                  Enter the amount you can spend on rent each month.
                </p>

                <div className="budget-display">
                  <span>Monthly budget</span>
                  <strong>€{budget.toLocaleString('en-IE')}</strong>
                </div>

                <input
                  id="budget"
                  type="range"
                  min="400"
                  max="2500"
                  step="50"
                  value={budget}
                  onChange={(event) => setBudget(Number(event.target.value))}
                />

                <div className="range-labels">
                  <span>€400</span>
                  <span>€2,500+</span>
                </div>
              </div>

              <div className="question-group">
                <label htmlFor="destination">
                  Which university will you attend?
                </label>

                <p className="field-hint">
                  Choose your university.
                </p>

                <select
                  id="destination"
                  value={destination}
                  onChange={(event) => setDestination(event.target.value)}
                  required
                >
                  <option value="">Select</option>
                  {UNIVERSITIES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <CommuteFields {...commute} onChange={setCommute} />

              <div className="question-group">
                <label>What type of accommodation do you prefer?</label>

                <div className="room-options">
                  {ROOM_TYPES.map(([type, icon]) => (
                    <button
                      key={type}
                      type="button"
                      className={`room-option${roomType === type ? ' selected' : ''}${type === 'Student accommodation' ? ' room-option-wide' : ''}`}
                      onClick={() => setRoomType(type)}
                    >
                      <span>{icon}</span>
                      {type}
                      {roomType === type && <span>✓</span>}
                    </button>
                  ))}
                </div>

                {!accommodation && (
                  <p className="field-note">
                    We don't have rent data for student accommodation yet.
                    Please choose another option to see recommendations.
                  </p>
                )}
              </div>

              <button className="questionnaire-next" type="submit" disabled={!accommodation}>
                Continue <span>→</span>
              </button>
            </form>
          </>
        ) : (
          <>
            <form onSubmit={handleSubmit}>
              {FACTORS.map(([name, hint, items]) => (
                <fieldset className="question-group" key={name}>
                  <legend className="factor-name">{name}</legend>
                  <p className="field-hint">{hint}</p>

                  {!(items && separately[name]) && (
                    <PrioritySlider
                      name={name}
                      value={importance[name]}
                      onChange={(value) => setFactorImportance(name, value)}
                    />
                  )}

                  {items && (
                    <label className="separate-toggle">
                      <input
                        type="checkbox"
                        checked={!!separately[name]}
                        onChange={(event) =>
                          setSeparately({ ...separately, [name]: event.target.checked })
                        }
                      />
                      Set priorities for {joinWords(items)} separately
                    </label>
                  )}

                  {items && separately[name] && (
                    <div className="item-ratings">
                      {items.map((item) => (
                        <div className="item-rating" key={item}>
                          <p className="item-name">{item}</p>
                          <PrioritySlider
                            name={item}
                            value={importance[item]}
                            onChange={(value) => setFactorImportance(item, value)}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </fieldset>
              ))}

              {allNotImportant && (
                <p className="field-note">
                  Move at least one slider above 0 so we have something to rank on.
                </p>
              )}

              <button className="questionnaire-next" type="submit" disabled={allNotImportant}>
                See my matches <span>→</span>
              </button>
            </form>
          </>
        )}
      </div>
    </section>
  )
}

export default Questionnaire
