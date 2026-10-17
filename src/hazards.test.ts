import { expect, it } from 'vitest'
import { parseHazards } from './hazards'

const ok = { type: 'Feature', geometry: { type: 'Point', coordinates: [-3.8, 40.6] }, properties: { id: 'a', title: 'T', text: 'X', routes: ['RL11'], path: null } }

it('keeps valid hazards and drops malformed ones', () => {
  const bad = [{ ...ok, geometry: { type: 'Point', coordinates: [null, 40] } }, { ...ok, properties: { ...ok.properties, routes: 'RL11' } }, { ...ok, geometry: { type: 'LineString', coordinates: [] } }]
  expect(parseHazards({ type: 'FeatureCollection', features: [ok, ...bad] })).toEqual([ok])
})

it('treats a missing or invalid file as no hazards', () => {
  expect(parseHazards(null)).toEqual([])
  expect(parseHazards({ type: 'Feature' })).toEqual([])
})
