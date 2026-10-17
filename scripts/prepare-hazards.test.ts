// @vitest-environment node
import { expect, it } from 'vitest'
import { between, build, snap } from './prepare-hazards.ts'

// West→east along 40.5° N, one vertex every 0.01° (~850 m)
const track: GeoJSON.MultiLineString = { type: 'MultiLineString', coordinates: [[[-3.8, 40.5], [-3.79, 40.5], [-3.78, 40.5], [-3.77, 40.5]]] }
const route = (id: string, warnings: string) => [id, { type: 'Feature' as const, geometry: track, properties: { id, warnings, description: null } }] as const
const routes = new Map([route('RL1', 'Cuidado en el vado del arroyo. Resto sin problemas.'), route('RL2', 'Otra cosa.')])
const spec = { id: 'vado', routes: ['RL1', 'RL2'], title: 'Vado', text: 'Cuidado en el vado del arroyo.', from: '' }

it('snaps the closest anchor vertex onto the track', () => {
  const s = snap([[-3.7849, 40.501], [-3.7, 40.6]], track)
  expect(s.at[0]).toBeCloseTo(-3.7849, 6)
  expect(s.at[1]).toBeCloseTo(40.5, 6)
  expect(s).toMatchObject({ part: 0, i: 2 })
  expect(s.m).toBeGreaterThan(100)
  expect(s.m).toBeLessThan(120)
})

it('cuts the stretch between two anchors in track order, whichever is given first', () => {
  const a = snap([[-3.795, 40.5]], track)
  const b = snap([[-3.775, 40.5]], track)
  const want = [[-3.795, 40.5], [-3.79, 40.5], [-3.78, 40.5], [-3.775, 40.5]]
  for (const p of [between(track, a, b), between(track, b, a)]) p.forEach((q, i) => { expect(q[0]).toBeCloseTo(want[i][0], 9); expect(q[1]).toBeCloseTo(want[i][1], 9) })
})

it('builds a point on the route that quotes the official text', () => {
  const f = build(spec, routes, [[-3.785, 40.5005]])
  expect(f.geometry.coordinates).toEqual([-3.785, 40.5])
  expect(f.properties).toEqual({ id: 'vado', title: 'Vado', text: spec.text, routes: ['RL1', 'RL2'], path: null })
})

it('marks a stretch at its middle vertex', () => {
  const f = build(spec, routes, [[-3.799, 40.5]], [[-3.771, 40.5]])
  expect(f.properties.path).toHaveLength(4)
  expect(f.geometry.coordinates).toEqual([-3.78, 40.5])
})

it('refuses text the official page no longer has, far anchors and routes that miss the spot', () => {
  expect(() => build({ ...spec, text: 'Texto inventado.' }, routes, [[-3.785, 40.5]])).toThrow(/no longer/)
  expect(() => build(spec, routes, [[-3.785, 40.51]])).toThrow(/m from RL1/)
  const far = new Map([...routes, ['RL2', { ...routes.get('RL2')!, geometry: { type: 'MultiLineString' as const, coordinates: [[[-3.8, 40.6], [-3.7, 40.6]]] } }]])
  expect(() => build(spec, far, [[-3.785, 40.5]])).toThrow(/RL2 does not pass/)
})
