import { lengthMeters, snapToNetwork, type Position } from './geo'

export const MAX_POINTS = 200
const KEY = 'arco-verde-plan'
const PAIR = /^-?\d{1,3}(\.\d+)?,-?\d{1,3}(\.\d+)?$/

export const round5 = (n: number) => Math.round(n * 1e5) / 1e5
export const planLine = (points: Position[]): GeoJSON.LineString => ({ type: 'LineString', coordinates: points })
export const planMeters = (points: Position[]) => lengthMeters(planLine(points))

export const planHash = (points: Position[]) => `#plan=${points.map(([lon, lat]) => `${round5(lat)},${round5(lon)}`).join(';')}`

export function decodePlan(hash: string): Position[] | null {
  let s = hash.replace(/^#/, '')
  try { s = decodeURIComponent(s) } catch { return null }
  if (!s.startsWith('plan=')) return null
  s = s.slice(5)
  if (!s) return []
  const pairs = s.split(';')
  if (pairs.length > MAX_POINTS) return null
  const points: Position[] = []
  for (const pair of pairs) {
    if (!PAIR.test(pair)) return null
    const [lat, lon] = pair.split(',').map(Number)
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
    points.push([lon, lat])
  }
  return points
}

export const onNetwork = (points: Position[], tracks: GeoJSON.Geometry[]) => points.every((p) => snapToNetwork(p, tracks))

export function loadDraft(): Position[] {
  try { return decodePlan(localStorage.getItem(KEY) ?? '') ?? [] } catch { return [] }
}

/** The saved draft, or null when it has points off the network and cannot be opened. */
export function openableDraft(tracks: GeoJSON.Geometry[]): Position[] | null {
  const draft = loadDraft()
  return onNetwork(draft, tracks) ? draft : null
}

export function saveDraft(points: Position[]) {
  try { localStorage.setItem(KEY, planHash(points)) } catch { /* storage unavailable */ }
}
