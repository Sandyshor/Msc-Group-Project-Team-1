import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

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

const FACTORS = [
  ['Rent', 'Cheaper rent'],
  ['Commute', 'A short commute to your university'],
  ['Shopping & Groceries', 'Supermarkets, grocery shops and shopping centres'],
  ['Restaurants', 'Places to eat out'],
  ['Healthcare', 'Hospitals and pharmacies'],
  ['Recreation & Wellness', 'Gyms and parks'],
]

const RATINGS = [
  [1, 'Very important'],
  [2, 'Important'],
  [3, 'Slightly important'],
  [4, 'Not important'],
]

function Questionnaire() {
  const [step, setStep] = useState(1)
  const [budget, setBudget] = useState(1000)
  const [destination, setDestination] = useState('')
  const [roomType, setRoomType] = useState('Private room')
  const [ratings, setRatings] = useState(
    Object.fromEntries(FACTORS.map(([name]) => [name, 2]))
  )
  const navigate = useNavigate()

  const accommodation = ROOM_TYPES.find(([label]) => label === roomType)[2]
  const allNotImportant = Object.values(ratings).every((r) => r === 4)

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
        ratings,
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

              <div className="question-group">
                <label>What type of accommodation do you prefer?</label>

                <div className="room-options">
                  {ROOM_TYPES.map(([type, icon]) => (
                    <button
                      key={type}
                      type="button"
                      className={roomType === type ? 'room-option selected' : 'room-option'}
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
            <h1>
              What matters most
              <em> to you?</em>
            </h1>

            <p className="questionnaire-description">
              Tell us how important each of these is. We'll weigh them to rank
              the neighbourhoods that suit you best.
            </p>

            <form onSubmit={handleSubmit}>
              {FACTORS.map(([name, hint]) => (
                <fieldset className="question-group" key={name}>
                  <legend className="factor-name">{name}</legend>
                  <p className="field-hint">{hint}</p>

                  <div className="rating-options">
                    {RATINGS.map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={ratings[name] === value}
                        className={ratings[name] === value ? 'rating-option selected' : 'rating-option'}
                        onClick={() => setRatings({ ...ratings, [name]: value })}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </fieldset>
              ))}

              {allNotImportant && (
                <p className="field-note">
                  Mark at least one thing as important so we have something to rank on.
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
