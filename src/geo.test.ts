import { describe, expect, it } from 'vitest'
import { directionsUrls, distanceToGeometryMeters, endMarkers, fitPadding, routeEnds, snapToNetwork, toGpx, haversineMeters, lengthMeters, lines, minDistanceToLines } from './geo'

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

describe('endMarkers', () => {
  const closed = line([[-3.7, 40.4], [-3.71, 40.41], [-3.7001, 40.4]])
  const open = line([[-3.7, 40.4], [-3.71, 40.41], [-3.7, 40.42]])
  it('shares one marker only for loops that close within 200 m', () => {
    expect(endMarkers(closed, 'Circular').map((m) => m.label)).toEqual(['Inicio y fin'])
    expect(endMarkers(open, 'Circular')).toEqual([{ at: [-3.7, 40.4], label: 'Inicio' }, { at: [-3.7, 40.42], label: 'Fin' }])
    expect(endMarkers(open, 'Ida y vuelta').map((m) => m.label)).toEqual(['Inicio', 'Fin'])
  })
  it('marks both ends of linear routes and only the start without a type', () => {
    expect(endMarkers(closed, 'Lineal').map((m) => m.label)).toEqual(['Inicio', 'Fin'])
    expect(endMarkers(open, null).map((m) => m.label)).toEqual(['Inicio'])
    expect(endMarkers(multi([]), 'Lineal')).toEqual([])
  })
})

describe('snapToNetwork', () => {
  const a = line([[-3.7, 40.4], [-3.6, 40.4]])
  const b = line([[-3.7, 40.41], [-3.6, 40.41]])
  it('keeps points on a track and snaps nearby ones onto it', () => {
    expect(snapToNetwork([-3.65, 40.4], [a])).toEqual([-3.65, 40.4])
    const s = snapToNetwork([-3.65, 40.402], [a])!
    expect(s[0]).toBeCloseTo(-3.65, 6)
    expect(s[1]).toBeCloseTo(40.4, 6)
  })
  it('rejects points farther than the limit', () => {
    expect(snapToNetwork([-3.65, 40.404], [a])).toBeNull()
    expect(snapToNetwork([-3.65, 40.404], [a], 500)).not.toBeNull()
    expect(snapToNetwork([-3.65, 40.4], [])).toBeNull()
  })
  it('picks the nearest of several tracks', () => {
    expect(snapToNetwork([-3.65, 40.408], [a, b])![1]).toBeCloseTo(40.41, 6)
    expect(snapToNetwork([-3.65, 40.402], [b, a])![1]).toBeCloseTo(40.4, 6)
  })
})

describe('fitPadding', () => {
  it('clears the controls and the sheet when there is room', () => {
    expect(fitPadding(1000, 800, [60, 100], 0)).toEqual({ tl: [84, 48], br: [24, 24] })
    expect(fitPadding(390, 844, [150, 160], 380)).toEqual({ tl: [24, 208], br: [24, 404] })
  })
  it('caps the sheet so at least 120 px of map stay usable, even behind an expanded sheet', () => {
    const { tl, br } = fitPadding(390, 844, [150, 160], 776)
    expect(844 - tl[1] - br[1]).toBe(120)
    expect(fitPadding(390, 150, [150, 160], 776).br).toEqual([24, 24])
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
