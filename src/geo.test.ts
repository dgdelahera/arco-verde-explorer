import { describe, expect, it } from 'vitest'
import { directionsUrls, distanceToGeometryMeters, routeEnds, toGpx, haversineMeters, lengthMeters, lines, minDistanceToLines } from './geo'

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

describe('routeEnds', () => {
  it('takes the first point of the first line and the last point of the last line', () => {
    expect(routeEnds(multi([[[-3.9, 40.5], [-3.8, 40.6]], [[1, 2], [3, 4]]]))).toEqual({ start: [-3.9, 40.5], end: [3, 4] })
  })
  it('is null without coordinates', () => {
    expect(routeEnds(multi([]))).toBeNull()
    expect(routeEnds(multi([[]]))).toBeNull()
  })
})

describe('directionsUrls', () => {
  const linear = multi([[[-3.9, 40.5], [-3.8, 40.6]]])
  it('asks for public transport to the start and back from the end of a one-way route', () => {
    expect(directionsUrls(linear, 'Lineal')).toEqual({
      toStart: 'https://www.google.com/maps/dir/?api=1&travelmode=transit&destination=40.5,-3.9',
      fromEnd: 'https://www.google.com/maps/dir/?api=1&travelmode=transit&origin=40.6,-3.8',
    })
  })
  it('only adds the return link for linear routes, even when a loop track does not close', () => {
    expect(directionsUrls(linear, 'Circular')!.fromEnd).toBeNull()
    expect(directionsUrls(linear, 'Ida y vuelta')!.fromEnd).toBeNull()
    expect(directionsUrls(linear, null)!.fromEnd).toBeNull()
  })
  it('is null without coordinates', () => {
    expect(directionsUrls(multi([]), 'Lineal')).toBeNull()
  })
})

describe('toGpx', () => {
  it('writes a named track with one segment per line and escapes the name', () => {
    const out = toGpx('RC1 Senda <A & B>', multi([[[-3.9, 40.5], [-3.8, 40.6]], [[1, 2], [3, 4]]]))
    expect(out).toContain('<trk><name>RC1 Senda &#60;A &#38; B&#62;</name><trkseg><trkpt lat="40.5" lon="-3.9"/><trkpt lat="40.6" lon="-3.8"/></trkseg><trkseg>')
    expect(out.match(/<trkseg>/g)).toHaveLength(2)
    expect(out).not.toContain('<ele>')
    expect(new DOMParser().parseFromString(out, 'application/xml').querySelector('parsererror')).toBeNull()
  })
})
