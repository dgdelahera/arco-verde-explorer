/// <reference types="geojson" />

export type Position = number[]

export function haversineMeters(a: Position, b: Position): number {
  const rad = Math.PI / 180
  const dLat = (b[1] - a[1]) * rad
  const dLon = (b[0] - a[0]) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2
  return 2 * 6371008.8 * Math.asin(Math.sqrt(h))
}

export function lines(geometry: GeoJSON.Geometry): Position[][] {
  if (geometry.type === 'LineString') return [geometry.coordinates]
  if (geometry.type === 'MultiLineString') return geometry.coordinates
  return []
}

export function lengthMeters(geometry: GeoJSON.Geometry): number {
  let total = 0
  for (const line of lines(geometry))
    for (let i = 1; i < line.length; i++) total += haversineMeters(line[i - 1], line[i])
  return total
}

function closestOnSegment(p: Position, a: Position, b: Position): Position {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2))
  return [a[0] + t * dx, a[1] + t * dy]
}

export function minDistanceToLines(p: Position, polylines: Position[][]): number {
  let best = Infinity
  for (const line of polylines)
    for (let i = 1; i < line.length; i++) {
      const c = closestOnSegment(p, line[i - 1], line[i])
      best = Math.min(best, Math.hypot(p[0] - c[0], p[1] - c[1]))
    }
  return best
}

function nearestOnGeometry(point: Position, geometry: GeoJSON.Geometry): { at: Position | null; m: number } {
  const k = Math.cos((point[1] * Math.PI) / 180)
  const flat = (q: Position) => [q[0] * k, q[1]]
  let best: { at: Position | null; m: number } = { at: null, m: Infinity }
  for (const line of lines(geometry))
    for (let i = 1; i < line.length; i++) {
      const c = closestOnSegment(flat(point), flat(line[i - 1]), flat(line[i]))
      const at = [c[0] / k, c[1]]
      const m = haversineMeters(point, at)
      if (m < best.m) best = { at, m }
    }
  return best
}

export function distanceToGeometryMeters(point: Position, geometry: GeoJSON.Geometry): number {
  return nearestOnGeometry(point, geometry).m
}

export const SNAP_M = 300
const bboxes = new WeakMap<GeoJSON.Geometry, number[]>()
const bboxOf = (g: GeoJSON.Geometry) => {
  let b = bboxes.get(g)
  if (!b) {
    b = [Infinity, Infinity, -Infinity, -Infinity]
    for (const l of lines(g)) for (const [x, y] of l) b = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)]
    bboxes.set(g, b)
  }
  return b
}

/** Nearest point on any of the tracks, or null when none is within `maxM`. */
export function snapToNetwork(point: Position, tracks: GeoJSON.Geometry[], maxM = SNAP_M): Position | null {
  const dLat = maxM / 111_000
  const dLon = dLat / Math.cos((point[1] * Math.PI) / 180)
  let best: { at: Position | null; m: number } = { at: null, m: maxM }
  for (const g of tracks) {
    const [x0, y0, x1, y1] = bboxOf(g)
    if (point[0] < x0 - dLon || point[0] > x1 + dLon || point[1] < y0 - dLat || point[1] > y1 + dLat) continue
    const n = nearestOnGeometry(point, g)
    if (n.m <= best.m) best = n
  }
  return best.at
}

export function routeEnds(geometry: GeoJSON.Geometry): { start: Position; end: Position } | null {
  const ls = lines(geometry).filter((l) => l.length > 0)
  if (!ls.length) return null
  const last = ls[ls.length - 1]
  return { start: ls[0][0], end: last[last.length - 1] }
}

/** Track ends to mark: loops and out-and-back tracks share one marker only when they really close (within 200 m). */
export function endMarkers(geometry: GeoJSON.Geometry, type: string | null): { at: Position; label: 'Inicio' | 'Fin' | 'Inicio y fin' }[] {
  const ends = routeEnds(geometry)
  if (!ends) return []
  const loop = type === 'Circular' || type === 'Ida y vuelta'
  if (loop && haversineMeters(ends.start, ends.end) <= 200) return [{ at: ends.start, label: 'Inicio y fin' }]
  if (!loop && type !== 'Lineal') return [{ at: ends.start, label: 'Inicio' }]
  return [{ at: ends.start, label: 'Inicio' }, { at: ends.end, label: 'Fin' }]
}

/** fitBounds padding that clears the corner controls and the bottom sheet, but never leaves less than `min` px of map height. */
export function fitPadding(width: number, height: number, ctl: [number, number], sheet: number, min = 120): { tl: [number, number]; br: [number, number] } {
  const [w, h] = ctl
  const cap = (top: number) => Math.max(0, Math.min(sheet, height - 72 - top - min))
  // Padding is a rectangle, so clear the corner controls along whichever side costs less of the visible map.
  const [left, top] = w / width < h / (height - cap(0)) ? [w, 0] : [0, h]
  return { tl: [24 + left, 48 + top], br: [24, 24 + cap(top)] }
}

const MAPS_DIR ='https://www.google.com/maps/dir/?api=1&travelmode=transit'
const latLon = (p: Position) => `${p[1]},${p[0]}`

/** Google Maps transit directions to the start and, for linear routes, back from the end. Loops and out-and-back tracks don't always close, so the official type decides. */
export function directionsUrls(geometry: GeoJSON.Geometry, type: string | null): { toStart: string; fromEnd: string | null } | null {
  const ends = routeEnds(geometry)
  if (!ends) return null
  return {
    toStart: `${MAPS_DIR}&destination=${latLon(ends.start)}`,
    fromEnd: type === 'Lineal' ? `${MAPS_DIR}&origin=${latLon(ends.end)}` : null,
  }
}

const xml = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`)

export function toGpx(name: string, geometry: GeoJSON.Geometry): string {
  const segments = lines(geometry)
    .map((l) => `<trkseg>${l.map(([lon, lat]) => `<trkpt lat="${lat}" lon="${lon}"/>`).join('')}</trkseg>`)
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Arco Verde Explorer" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>${xml(name)}</name></metadata><trk><name>${xml(name)}</name>${segments}</trk></gpx>
`
}
