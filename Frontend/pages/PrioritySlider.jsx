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
      <div className="priority-value">
        <span>
          {showName && <strong className="priority-name">{name}</strong>}
          {words}
        </span>
        <strong>{value}/10</strong>
      </div>
      <input
        type="range"
        min="0"
        max="10"
        step="1"
        value={value}
        aria-label={`How important is ${name}?`}
        aria-valuetext={`${value} out of 10, ${words}`}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <div className="range-labels">
        <span>Not important</span>
        <span>Very important</span>
      </div>
    </div>
  )
}

export default PrioritySlider
