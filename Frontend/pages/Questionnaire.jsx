import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import './Questionnaire.css'
import { NO_LIMIT, TRAVEL_MODES } from './CommuteFields'
import { FlowChoices, FlowPhoto, FlowRow, FlowSidebar } from './FlowLayout'
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

// label, backend accommodation key (null = no rent data yet)
const ROOM_TYPES = [
  ['1 BHK apartment', 'one_bed'],
  ['2 BHK apartment', 'two_bed'],
  ['Private room', 'private_room'],
  ['Double sharing', 'shared_room'],
  ['Student accommodation', null],
]

const MODE_ICONS = { public_transport: 'bus', walk: 'walk', cycle: 'bike' }

// Shown on the page, not used for ranking yet - each result already shows its area's safety
const SAFETY_LEVELS = ['High', 'Medium', 'Low']

// name, icon, hint, items that can be rated separately instead (as in the backend)
const FACTORS = [
  ['Rent', 'euro', 'Cheaper rent'],
  ['Commute', 'clock', 'A short commute to your university'],
  ['Shopping & Groceries', 'basket', 'Supermarkets, grocery shops and shopping centres',
    ['Supermarkets', 'Grocery Shops', 'Shopping Malls']],
  ['Restaurants', 'fork', 'Places to eat out'],
  ['Healthcare', 'heart', 'Hospitals and pharmacies', ['Hospitals', 'Pharmacies']],
  ['Recreation & Wellness', 'tree', 'Gyms and parks', ['Gyms', 'Parks']],
]

function joinWords(items) {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}

function Questionnaire() {
  // Coming back from the results page ("About you" / "Your priorities"): start from the earlier answers
  const { state } = useLocation()
  const earlier = state?.answers
  const [step, setStep] = useState(state?.step === 2 ? 2 : 1)
  const [budget, setBudget] = useState(earlier?.budget ?? 1000)
  const [destination, setDestination] = useState(earlier?.university ?? '')
  const [roomType, setRoomType] = useState(earlier?.accommodationLabel ?? 'Private room')
  const [commute, setCommute] = useState({
    travelMode: earlier?.travelMode ?? 'public_transport',
    maxCommute: earlier?.maxCommute ?? null,
  })
  const [safety, setSafety] = useState(earlier?.safety ?? 'Medium')
  const [importance, setImportance] = useState({
    ...Object.fromEntries(
      FACTORS.flatMap(([name, , , items = []]) => [name, ...items]).map((name) => [name, DEFAULT_IMPORTANCE])
    ),
    ...earlier?.importance,
  })
  const [separately, setSeparately] = useState(
    Object.fromEntries(FACTORS.map(([name, , , items = []]) => [name, items.some((item) => item in (earlier?.importance ?? {}))]))
  )
  const navigate = useNavigate()

  const accommodation = ROOM_TYPES.find(([label]) => label === roomType)[1]
  const situationDone = Boolean(destination && accommodation)
  // A category rated "separately" is replaced by its items, as in the backend.
  const activeImportance = Object.fromEntries(
    FACTORS.flatMap(([name, , , items]) =>
      items && separately[name] ? items.map((item) => [item, importance[item]]) : [[name, importance[name]]]
    )
  )
  const allNotImportant = Object.values(activeImportance).every((value) => value === 0)

  function setFactorImportance(name, value) {
    setImportance({ ...importance, [name]: value })
  }

  const [needUniversity, setNeedUniversity] = useState(false)

  function handleContinue(event) {
    event.preventDefault()
    if (situationDone) setStep(2)
  }

  // Every step in the sidebar can be clicked; the matches need a university and an accommodation type first
  function goToStep(number) {
    if (number < 3) {
      setStep(number)
    } else if (situationDone) {
      showMatches()
    } else {
      setNeedUniversity(true)
      setStep(1)
    }
  }

  function handleSubmit(event) {
    event.preventDefault()
    if (situationDone) showMatches()
  }

  function showMatches() {
    navigate('/results', {
      state: {
        university: destination,
        budget,
        accommodation,
        accommodationLabel: roomType,
        importance: activeImportance,
        travelMode: commute.travelMode,
        maxCommute: commute.maxCommute,
        safety,
      },
    })
  }

  return (
    <section className="flow-page">
      <FlowSidebar step={step} onStep={goToStep} />

      {step === 1 ? (
        <>
          <FlowPhoto
            step={1}
            label="ABOUT YOU"
            title="First, tell us a little"
            accent="about your life."
            description="We'll use your answers to find Dublin neighbourhoods that fit your budget and everyday routine."
          />

          <form className="flow-rows" onSubmit={handleContinue}>
            <FlowRow icon="euro" title="Budget" question="What's your monthly accommodation budget?" htmlFor="budget">
              <div className="flow-value">
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
            </FlowRow>

            <FlowRow icon="cap" title="University" question="Which university will you attend?" htmlFor="destination">
              <select id="destination" value={destination} onChange={(event) => setDestination(event.target.value)}>
                <option value="">Select your university</option>
                {UNIVERSITIES.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </FlowRow>

            <FlowRow icon="home" title="Accommodation" question="What type of accommodation do you prefer?">
              <FlowChoices
                label="Accommodation type"
                className="flow-choices-rooms"
                options={ROOM_TYPES.map(([label]) => [label, label])}
                value={roomType}
                onChange={setRoomType}
              />
              {!accommodation && (
                <p className="flow-note">We don't have rent data for student accommodation yet - please choose another option.</p>
              )}
            </FlowRow>

            <FlowRow icon="route" title="Getting there" question="How will you get to university?">
              <FlowChoices
                label="Travel mode"
                options={TRAVEL_MODES.map(([value, label]) => [value, label, MODE_ICONS[value]])}
                value={commute.travelMode}
                onChange={(travelMode) => setCommute({ ...commute, travelMode })}
              />
            </FlowRow>

            <FlowRow icon="clock" title="Commute" question="What's the longest commute you'd accept?" htmlFor="max-commute">
              <div className="flow-value">
                <span>One way</span>
                <strong>{commute.maxCommute ? `${commute.maxCommute} min` : 'No limit'}</strong>
              </div>
              <input
                id="max-commute"
                type="range"
                min="10"
                max={NO_LIMIT}
                step="5"
                value={commute.maxCommute ?? NO_LIMIT}
                onChange={(event) => {
                  const value = Number(event.target.value)
                  setCommute({ ...commute, maxCommute: value === NO_LIMIT ? null : value })
                }}
              />
            </FlowRow>

            <FlowRow icon="shield" title="Safety" question="How important is safety to you when choosing a neighbourhood?">
              <FlowChoices
                label="Safety"
                options={SAFETY_LEVELS.map((level) => [level, level])}
                value={safety}
                onChange={setSafety}
              />
            </FlowRow>

            <div className="flow-actions">
              {!destination && (
                <p className={needUniversity ? 'flow-note flow-note-strong' : 'flow-note'} role="status">
                  Choose your university to continue.
                </p>
              )}
              <button className="flow-next" type="submit" disabled={!situationDone}>
                Continue <span>→</span>
              </button>
            </div>
          </form>
        </>
      ) : (
        <>
          <FlowPhoto
            step={2}
            label="YOUR PRIORITIES"
            title="What matters most"
            accent="to you?"
            description="Move each slider to show how important it is. We'll weigh them to rank the neighbourhoods that suit you best."
          />

          <form className="flow-rows" onSubmit={handleSubmit}>
            {FACTORS.map(([name, icon, hint, items]) => (
              <FlowRow
                key={name}
                icon={icon}
                title={name}
                question={hint}
                className={items && separately[name] ? 'flow-row-items' : ''}
              >
                {items && separately[name] ? (
                  <div className="flow-item-sliders">
                    {items.map((item) => (
                      <PrioritySlider
                        key={item}
                        name={item}
                        value={importance[item]}
                        showName
                        onChange={(value) => setFactorImportance(item, value)}
                      />
                    ))}
                  </div>
                ) : (
                  <PrioritySlider
                    name={name}
                    value={importance[name]}
                    onChange={(value) => setFactorImportance(name, value)}
                  />
                )}
                {items && (
                  <label className="flow-separate">
                    <input
                      type="checkbox"
                      checked={!!separately[name]}
                      onChange={(event) => setSeparately({ ...separately, [name]: event.target.checked })}
                    />
                    Rate {joinWords(items)} separately
                  </label>
                )}
              </FlowRow>
            ))}

            <div className="flow-actions">
              <button className="flow-back" type="button" onClick={() => setStep(1)}>
                ← Back
              </button>
              {allNotImportant && <p className="flow-note">Move at least one slider above 0.</p>}
              {!situationDone && !allNotImportant && (
                <p className="flow-note">Choose your university in "About you" first.</p>
              )}
              <button className="flow-next" type="submit" disabled={allNotImportant || !situationDone}>
                See my matches <span>→</span>
              </button>
            </div>
          </form>
        </>
      )}
    </section>
  )
}

export default Questionnaire
