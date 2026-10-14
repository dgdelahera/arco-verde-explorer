import { describe, expect, it } from 'vitest'
import { distanceToGeometryMeters, startDirectionsUrl, haversineMeters, lengthMeters, lines, minDistanceToLines } from './geo'

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

describe('minDistanceToLines', () => {
  it('measures to the segment interior and clamps at the ends', () => {
    const l = [[[0, 0], [10, 0]]]
    expect(minDistanceToLines([5, 3], l)).toBe(3)
    expect(minDistanceToLines([13, 4], l)).toBe(5)
    expect(minDistanceToLines([1, 1], [[[2, 2]]])).toBe(Infinity)
  })
})

describe('distanceToGeometryMeters', () => {
  it('uses the nearest point on the line, not the nearest vertex', () => {
    const g = line([[-3.7, 40.4], [-3.6, 40.4]])
    const d = distanceToGeometryMeters([-3.65, 40.41], g)
    expect(Math.abs(d - haversineMeters([-3.65, 40.41], [-3.65, 40.4]))).toBeLessThan(5)
  })
  it('is Infinity without lines', () => {
    expect(distanceToGeometryMeters([0, 0], { type: 'Point', coordinates: [0, 0] })).toBe(Infinity)
  })
})

describe('startDirectionsUrl', () => {
  it('points at the first coordinate of the first line as lat,lon', () => {
    expect(startDirectionsUrl(multi([[[-3.9, 40.5], [-3.8, 40.6]], [[1, 2]]]))).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=40.5,-3.9&travelmode=walking',
    )
  })
  it('is null without coordinates', () => {
    expect(startDirectionsUrl(multi([]))).toBeNull()
  })
})
