import { expect, it } from 'vitest'
import { parsePois, searchPois, type PoiFeature } from './pois'

const poi = (id: string, name: string | null, category = 'fuente'): PoiFeature =>
  ({ type: 'Feature', geometry: { type: 'Point', coordinates: [-3.8, 40.5] }, properties: { id, name, category } }) as PoiFeature

it('parses the file and drops invalid features', () => {
  const { pois, metadata } = parsePois({
    type: 'FeatureCollection',
    metadata: { source: '© OpenStreetMap contributors, ODbL', sourceUrl: 'https://www.openstreetmap.org/copyright', extractedAt: '2026-10-16' },
    features: [poi('node/1', 'A'), poi('node/2', 'B', 'bar'), { ...poi('node/3', 'C'), geometry: { type: 'Point', coordinates: [null, 40] } }],
  })
  expect(pois.map((f) => f.properties.id)).toEqual(['node/1'])
  expect(metadata?.extractedAt).toBe('2026-10-16')
  expect(() => parsePois({ type: 'Feature' })).toThrow()
})

it('matches names ignoring accents, case and hyphens, from 3 characters', () => {
  const all = [poi('node/1', 'Estación de Las Matas', 'transporte'), poi('node/2', null), poi('node/3', 'Área Recreativa Las Islillas', 'descanso')]
  expect(searchPois(all, 'las-matas').map((f) => f.properties.id)).toEqual(['node/1'])
  expect(searchPois(all, 'AREA').map((f) => f.properties.id)).toEqual(['node/3'])
  expect(searchPois(all, 'la')).toEqual([])
  expect(searchPois(all, 'las', 1)).toHaveLength(1)
})
