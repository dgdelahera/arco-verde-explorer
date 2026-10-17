import type { Position } from './geo'

export type HazardProps = { id: string; title: string; text: string; routes: string[]; path: Position[] | null }
export type HazardFeature = GeoJSON.Feature<GeoJSON.Point, HazardProps>

export function parseHazards(json: unknown): HazardFeature[] {
  const fc = json as { type?: string; features?: HazardFeature[] }
  if (fc?.type !== 'FeatureCollection' || !Array.isArray(fc.features)) return []
  return fc.features.filter((f) => {
    const c = f?.geometry?.coordinates
    const p = f?.properties
    return f?.geometry?.type === 'Point' && Number.isFinite(c?.[0]) && Number.isFinite(c?.[1]) && typeof p?.id === 'string' && typeof p.title === 'string' && typeof p.text === 'string' && Array.isArray(p.routes)
  })
}
