import { norm, type Metadata } from './filters'

export type PoiCategory = 'fuente' | 'descanso' | 'transporte'
export type PoiProps = { id: string; name: string | null; category: PoiCategory }
export type PoiFeature = GeoJSON.Feature<GeoJSON.Point, PoiProps>
export type PoisData = { pois: PoiFeature[]; metadata: Metadata | null }

export const POI_CATEGORIES: Record<PoiCategory, { label: string; one: string; letter: string; color: string }> = {
  fuente: { label: 'Fuentes', one: 'Fuente de agua potable', letter: 'F', color: '#0e7490' },
  descanso: { label: 'Merenderos y refugios', one: 'Merendero o refugio', letter: 'M', color: '#7c4a03' },
  transporte: { label: 'Estaciones', one: 'Estación de tren o metro', letter: 'T', color: '#5b21b6' },
}

export const osmUrl = (id: string) => `https://www.openstreetmap.org/${id}`

export function parsePois(json: unknown): PoisData {
  const fc = json as { type?: string; features?: PoiFeature[]; metadata?: Metadata }
  if (fc?.type !== 'FeatureCollection' || !Array.isArray(fc.features)) throw new Error('El fichero de puntos de interés no es válido')
  const pois = fc.features.filter((f) => {
    const c = f?.geometry?.coordinates
    return f?.geometry?.type === 'Point' && Number.isFinite(c?.[0]) && Number.isFinite(c?.[1]) && typeof f.properties?.id === 'string' && f.properties.category in POI_CATEGORIES
  })
  return { pois, metadata: fc.metadata ?? null }
}

/** Named POIs whose name contains the query (same normalisation as the route search). */
export function searchPois(pois: PoiFeature[], q: string, limit = 8): PoiFeature[] {
  const n = norm(q.trim())
  if (n.length < 3) return []
  return pois.filter((f) => f.properties.name && norm(f.properties.name).includes(n)).slice(0, limit)
}
