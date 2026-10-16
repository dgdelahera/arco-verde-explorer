// @vitest-environment node
import { expect, it } from 'vitest'
import { categoryOf, overpassToPois } from './prepare-pois.ts'

const track: GeoJSON.MultiLineString = { type: 'MultiLineString', coordinates: [[[-3.8, 40.5], [-3.79, 40.5]]] }
// ~0.0027° of latitude ≈ 300 m
const el = (id: number, lat: number, tags: Record<string, string>, type: 'node' | 'way' = 'node') =>
  type === 'node' ? { type, id, lat, lon: -3.795, tags } : { type, id, center: { lat, lon: -3.795 }, tags }

it('maps tags to the three categories and ignores the rest', () => {
  expect(categoryOf({ amenity: 'drinking_water' })).toBe('fuente')
  expect(categoryOf({ amenity: 'drinking_water', drinking_water: 'no' })).toBeNull()
  expect(categoryOf({ tourism: 'picnic_site' })).toBe('descanso')
  expect(categoryOf({ amenity: 'shelter', shelter_type: 'picnic_shelter' })).toBe('descanso')
  expect(categoryOf({ amenity: 'shelter', shelter_type: 'public_transport' })).toBeNull()
  expect(categoryOf({ railway: 'station', station: 'light_rail' })).toBe('transporte')
  expect(categoryOf({ railway: 'station', station: 'funicular' })).toBeNull()
  expect(categoryOf({ amenity: 'bench' })).toBeNull()
})

it('keeps features within 300 m of a track, using way centres and osm ids', () => {
  const pois = overpassToPois({
    elements: [
      el(1, 40.5005, { amenity: 'drinking_water' }),
      el(2, 40.5040, { amenity: 'drinking_water' }),
      el(3, 40.4990, { tourism: 'picnic_site', name: ' Merendero del Río ' }, 'way'),
      el(4, 40.5, { amenity: 'bench' }),
      { type: 'node', id: 5, tags: { amenity: 'drinking_water' } },
    ],
  }, [track])
  expect(pois).toEqual([
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-3.795, 40.5005] }, properties: { id: 'node/1', name: null, category: 'fuente' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-3.795, 40.499] }, properties: { id: 'way/3', name: 'Merendero del Río', category: 'descanso' } },
  ])
})
