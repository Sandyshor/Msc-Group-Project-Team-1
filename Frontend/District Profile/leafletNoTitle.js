// Leaflet copies a marker's `title` into the HTML title attribute, so the browser shows its own grey tooltip on top
// of the site's hover cards and tooltips (e.g. "Trinity Hall (student residence)" over the residence card).
// Every marker keeps its name for screen readers (aria-label); the browser's own tooltip is dropped.
import L from 'leaflet'

if (!L.Marker.prototype.fmdNoTitle) {
  L.Marker.prototype.fmdNoTitle = true
  const initIcon = L.Marker.prototype._initIcon
  L.Marker.prototype._initIcon = function initIconWithoutTitle() {
    initIcon.call(this)
    const icon = this._icon
    if (icon && this.options.title) {
      icon.setAttribute('aria-label', this.options.title)
      icon.removeAttribute('title')
    }
  }
}
