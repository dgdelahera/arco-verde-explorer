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

export function distanceToGeometryMeters(point: Position, geometry: GeoJSON.Geometry): number {
  const k = Math.cos((point[1] * Math.PI) / 180)
  const flat = (q: Position) => [q[0] * k, q[1]]
  let best = Infinity
  for (const line of lines(geometry))
    for (let i = 1; i < line.length; i++) {
      const c = closestOnSegment(flat(point), flat(line[i - 1]), flat(line[i]))
      best = Math.min(best, haversineMeters(point, [c[0] / k, c[1]]))
    }
  return best
}

export function startDirectionsUrl(geometry: GeoJSON.Geometry): string | null {
  const start = lines(geometry)[0]?.[0]
  return start ? `https://www.google.com/maps/dir/?api=1&destination=${start[1]},${start[0]}&travelmode=walking` : null
}
