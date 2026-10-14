import { describe, expect, it } from 'vitest'
import { haversineMeters, lengthMeters, lines } from './geo'

const line = (coordinates: number[][]): GeoJSON.LineString => ({ type: 'LineString', coordinates })
const multi = (coordinates: number[][][]): GeoJSON.MultiLineString => ({ type: 'MultiLineString', coordinates })

describe('haversineMeters', () => {
  it('measures Puerta del Sol to Cibeles', () => {
    expect(Math.abs(haversineMeters([-3.7038, 40.4168], [-3.6921, 40.4193]) - 1030)).toBeLessThan(20)
  })
})

describe('lines', () => {
  it('normalises geometries', () => {
    expect(lines(line([[0, 0], [1, 1]]))).toEqual([[[0, 0], [1, 1]]])
    expect(lines(multi([[[0, 0]], [[1, 1]]]))).toEqual([[[0, 0]], [[1, 1]]])
    expect(lines({ type: 'Point', coordinates: [0, 0] })).toEqual([])
  })
})

describe('lengthMeters', () => {
  it('does not bridge MultiLineString parts', () => {
    const a = [[0, 0], [0, 0.01]]
    const b = [[10, 10], [10, 10.01]]
    expect(lengthMeters(multi([a, b]))).toBeCloseTo(lengthMeters(line(a)) + lengthMeters(line(b)), 6)
  })
})
