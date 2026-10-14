import { describe, expect, it } from 'vitest'
import { emptyFilters, filterRoutes, parseRoutes } from './filters'
import { fixture } from './test/fixture'

const { routes } = parseRoutes(fixture)
const ids = (f: Partial<typeof emptyFilters>) => filterRoutes(routes, { ...emptyFilters, ...f }).map((r) => r.properties.id)

describe('parseRoutes', () => {
  it('skips features without valid geometry', () => {
    expect(routes.map((r) => r.properties.id)).toEqual(['RC1', 'RL2'])
  })
  it('rejects non-FeatureCollections', () => {
    expect(() => parseRoutes({ foo: 1 })).toThrow()
    expect(() => parseRoutes(null)).toThrow()
  })
})

describe('filterRoutes', () => {
  it('returns everything with empty filters', () => expect(ids({})).toEqual(['RC1', 'RL2']))
  it('searches name and municipality ignoring accents and case', () => {
    expect(ids({ q: 'arroyo' })).toEqual(['RC1'])
    expect(ids({ q: 'las rozas' })).toEqual(['RC1'])
    expect(ids({ q: 'ALCÓBENDAS' })).toEqual(['RL2'])
  })
  it('filters by municipality, category and type', () => {
    expect(ids({ municipality: 'Alcobendas' })).toEqual(['RL2'])
    expect(ids({ category: 'corta' })).toEqual(['RC1'])
    expect(ids({ type: 'Lineal' })).toEqual(['RL2'])
  })
  it('filters by distance range and max elevation gain', () => {
    expect(ids({ minKm: '10' })).toEqual(['RL2'])
    expect(ids({ maxKm: '10' })).toEqual(['RC1'])
    expect(ids({ maxGain: '100' })).toEqual(['RC1'])
  })
})
