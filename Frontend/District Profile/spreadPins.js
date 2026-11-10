// Keeps map pins from sitting on top of each other.
//
// groupPins: zoomed out, pins closer than `gap` pixels become one group (shown as a count badge).
// spreadPins: pins that still overlap are pushed apart on screen (never the fixed ones, e.g. campus pins), so each
// can be seen and clicked; the caller draws a thin line back to the true spot when a pin had to move.
// Both work in screen pixels (Leaflet container points), so they are re-run whenever the zoom changes.

// [{ point: {x, y}, ... }] -> [[item, item, ...], ...] (greedy: each pin joins the first group it is close to)
export function groupPins(items, gap) {
  const groups = []
  items.forEach((item) => {
    const g = groups.find((x) => Math.hypot(x.cx - item.point.x, x.cy - item.point.y) < gap)
    if (g) {
      g.items.push(item)
      g.cx = g.items.reduce((s, i) => s + i.point.x, 0) / g.items.length
      g.cy = g.items.reduce((s, i) => s + i.point.y, 0) / g.items.length
    } else {
      groups.push({ items: [item], cx: item.point.x, cy: item.point.y })
    }
  })
  return groups
}

// movable: [{x, y, r}] (changed in place), fixed: [{x, y, r}]; two pins need r1 + r2 + pad between centres
export function spreadPins(movable, fixed, pad = 3) {
  const GOLDEN = 2.399963 // spreads pins that start on exactly the same spot evenly around it
  for (let round = 0; round < 250; round++) {
    let moved = false
    movable.forEach((p, i) => {
      fixed.forEach((q, k) => {
        const need = p.r + q.r + pad
        let dx = p.x - q.x
        let dy = p.y - q.y
        let d = Math.hypot(dx, dy)
        if (d >= need) return
        if (d < 0.5) { dx = Math.cos((i + k + 1) * GOLDEN); dy = Math.sin((i + k + 1) * GOLDEN); d = 0 } else { dx /= d; dy /= d }
        p.x += dx * (need - d)
        p.y += dy * (need - d)
        moved = true
      })
      for (let j = i + 1; j < movable.length; j++) {
        const q = movable[j]
        const need = p.r + q.r + pad
        let dx = p.x - q.x
        let dy = p.y - q.y
        let d = Math.hypot(dx, dy)
        if (d >= need) continue
        if (d < 0.5) { dx = Math.cos((i * 7 + j) * GOLDEN); dy = Math.sin((i * 7 + j) * GOLDEN); d = 0 } else { dx /= d; dy /= d }
        const half = (need - d) / 2 // both move apart
        p.x += dx * half; p.y += dy * half
        q.x -= dx * half; q.y -= dy * half
        moved = true
      }
    })
    if (!moved) break
  }
  return movable
}
