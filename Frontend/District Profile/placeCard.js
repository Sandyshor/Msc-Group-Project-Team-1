// Keeps a hover card (a Leaflet popup) fully inside its map: shown above the pin when there is room, otherwise
// below it, and nudged sideways when it would run off the left or right edge. `top` is space at the top of the map
// taken by controls (hint, buttons) that the card should not slide under.
export function fitCard(popup, map, { top = 12, pinGap = 16 } = {}) {
  const node = popup.getElement()
  if (!node) return
  node.classList.remove('is-below')
  popup.options.offset = [0, -pinGap]
  popup.update()
  const box = map.getContainer().getBoundingClientRect()
  let r = node.getBoundingClientRect()
  let dy = 0
  if (r.top < box.top + top) {
    // not enough room above the pin: put the card below it (the tip flips to the top)
    dy = r.height + pinGap * 2 + 28 // clear of the pin itself (up to ~20 px radius) plus the tip
    node.classList.add('is-below')
  }
  let dx = 0
  if (r.left < box.left + 8) dx = box.left + 8 - r.left
  else if (r.right > box.right - 8) dx = box.right - 8 - r.right
  if (dx || dy) {
    popup.options.offset = [dx, -pinGap + dy]
    popup.update()
    node.style.setProperty('--tip-x', `${-dx}px`)
  } else node.style.removeProperty('--tip-x')
}
