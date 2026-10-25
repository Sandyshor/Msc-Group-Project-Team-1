// Travel mode + longest commute - used in the questionnaire and on the results page.

// backend travel_mode, button label, words used in sentences
export const TRAVEL_MODES = [
  ['public_transport', 'Public transport', 'by public transport'],
  ['walk', 'Walking', 'on foot'],
  ['cycle', 'Cycling', 'by bike'],
]

// The slider's last stop means "no limit"
const NO_LIMIT = 95

function CommuteFields({ travelMode, maxCommute, onChange }) {
  return (
    <>
      <div className="question-group">
        <label>How will you get to university?</label>
        <div className="rating-options mode-options" role="group" aria-label="Travel mode">
          {TRAVEL_MODES.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={travelMode === value}
              className={travelMode === value ? 'rating-option selected' : 'rating-option'}
              onClick={() => onChange({ travelMode: value, maxCommute })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="question-group">
        <label htmlFor="max-commute">What's the longest commute you'd accept?</label>

        <div className="budget-display">
          <span>One way</span>
          <strong>{maxCommute ? `${maxCommute} min` : 'No limit'}</strong>
        </div>

        <input
          id="max-commute"
          type="range"
          min="10"
          max={NO_LIMIT}
          step="5"
          value={maxCommute ?? NO_LIMIT}
          onChange={(event) => {
            const value = Number(event.target.value)
            onChange({ travelMode, maxCommute: value === NO_LIMIT ? null : value })
          }}
        />

        <div className="range-labels">
          <span>10 min</span>
          <span>No limit</span>
        </div>
      </div>
    </>
  )
}

export default CommuteFields
