// How important a factor is, on a 0-10 slider - used in the questionnaire and on the results page.
import './Questionnaire.css'

export const DEFAULT_IMPORTANCE = 7 // "Important"

// Same words as importance_label in the backend
export function importanceLabel(value) {
  if (value <= 0) return 'Not important'
  if (value < 4) return 'Slightly important'
  if (value < 8) return 'Important'
  return 'Very important'
}

function PrioritySlider({ name, value, onChange, showName = false }) {
  const words = importanceLabel(value)

  return (
    <div className="priority-slider">
      {showName && (
        <div className="priority-value">
          <strong className="priority-name">{name}</strong>
        </div>
      )}
      <div className="range-labels">
        <span>Least important</span>
        <span>Most important</span>
      </div>
      <input
        type="range"
        min="0"
        max="10"
        step="1"
        value={value}
        style={{ '--fill': `${value * 10}%` }}
        aria-label={`How important is ${name}?`}
        aria-valuetext={`${value} out of 10, ${words}`}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  )
}

export default PrioritySlider
