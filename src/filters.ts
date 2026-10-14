import { lines } from './geo'

export type RouteProps = {
  id: string
  name: string
  category: 'corta' | 'larga'
  municipalities: string[]
  distanceKm: number | null
  elevationGainM: number | null
  type: string | null
  sector: string | null
  warnings: string | null
  description: string | null
  gpxUrl: string
  planUrl: string | null
  computedLengthKm: number
}
export type RouteFeature = GeoJSON.Feature<GeoJSON.MultiLineString | GeoJSON.LineString, RouteProps>
export type Metadata = { source: string; sourceUrl: string; extractedAt: string }
export type RoutesData = { routes: RouteFeature[]; metadata: Metadata | null }

export type Filters = {
  q: string
  municipality: string
  category: string
  type: string
  minKm: string
  maxKm: string
  maxGain: string
}
export const emptyFilters: Filters = { q: '', municipality: '', category: '', type: '', minKm: '', maxKm: '', maxGain: '' }

const validLine = (l: unknown) =>
  Array.isArray(l) && l.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])).length >= 2

function isValid(f: RouteFeature): boolean {
  const g = f?.geometry
  if (!g || (g.type !== 'MultiLineString' && g.type !== 'LineString') || !Array.isArray(g.coordinates)) return false
  const p = f.properties
  return typeof p?.id === 'string' && typeof p.name === 'string' && lines(g).some(validLine)
}

export function parseRoutes(json: unknown): RoutesData {
  const fc = json as { type?: string; features?: RouteFeature[]; metadata?: Metadata }
  if (fc?.type !== 'FeatureCollection' || !Array.isArray(fc.features)) throw new Error('El fichero de rutas no es una FeatureCollection válida')
  const routes = fc.features.filter(isValid).map((f) => ({
    ...f,
    properties: { ...f.properties, municipalities: Array.isArray(f.properties.municipalities) ? f.properties.municipalities : [] },
  }))
  return { routes, metadata: fc.metadata ?? null }
}

const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
const num = (s: string) => (s.trim() === '' ? null : Number(s))

export function filterRoutes(routes: RouteFeature[], f: Filters): RouteFeature[] {
  const q = norm(f.q.trim())
  const minKm = num(f.minKm)
  const maxKm = num(f.maxKm)
  const maxGain = num(f.maxGain)
  return routes.filter(({ properties: p }) => {
    const km = p.distanceKm ?? p.computedLengthKm
    if (q && !norm([p.name, p.id, ...p.municipalities].join(' ')).includes(q)) return false
    if (f.municipality && !p.municipalities.includes(f.municipality)) return false
    if (f.category && p.category !== f.category) return false
    if (f.type && p.type !== f.type) return false
    if (minKm !== null && !(km >= minKm)) return false
    if (maxKm !== null && !(km <= maxKm)) return false
    if (maxGain !== null && !(p.elevationGainM !== null && p.elevationGainM <= maxGain)) return false
    return true
  })
}

export const distinct = <T,>(values: (T | null)[]): T[] =>
  [...new Set(values.filter((v): v is T => v !== null))].sort((a, b) => String(a).localeCompare(String(b), 'es'))
