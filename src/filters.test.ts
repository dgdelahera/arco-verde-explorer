import { describe, expect, it } from 'vitest'
import { emptyFilters, filterRoutes, lengthMismatch, parseRoutes, routeIdFromHash } from './filters'
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
    expect(ids({ maxKm: '10,5' })).toEqual(['RC1'])
    expect(ids({ maxKm: 'abc' })).toHaveLength(ids({}).length)
    expect(ids({ maxGain: '100' })).toEqual(['RC1'])
  })
})

describe('search normalisation', () => {
  it('ignores spaces and hyphens in query and haystack', () => {
    expect(ids({ q: 'las-rozas' })).toEqual(['RC1'])
    expect(ids({ q: 'camino  de alcobendas' })).toEqual(['RL2'])
    expect(ids({ q: 'rl 2' })).toEqual(['RL2'])
    expect(ids({ q: 'senda-del arroyo' })).toEqual(['RC1'])
  })
})

describe('routeIdFromHash', () => {
  const all = ['RC1', 'RL20', 'RL4b']
  it('matches case-insensitively and ignores unknown ids', () => {
    expect(routeIdFromHash('#rl20', all)).toBe('RL20')
    expect(routeIdFromHash('#RL4B', all)).toBe('RL4b')
    expect(routeIdFromHash('#nope', all)).toBeNull()
    expect(routeIdFromHash('', all)).toBeNull()
    expect(routeIdFromHash('#%E0%A4%A', all)).toBeNull()
  })
})

describe('lengthMismatch', () => {
  const p = routes[0].properties
  it('flags differences over 10% of the official distance', () => {
    expect(lengthMismatch({ ...p, distanceKm: 10, computedLengthKm: 11.1 })).toBe(true)
    expect(lengthMismatch({ ...p, distanceKm: 10, computedLengthKm: 8.9 })).toBe(true)
    expect(lengthMismatch({ ...p, distanceKm: 10, computedLengthKm: 10.9 })).toBe(false)
    expect(lengthMismatch({ ...p, distanceKm: null, computedLengthKm: 5 })).toBe(false)
  })
})
