import { describe, expect, it } from 'vitest'
import { haversineMeters, type Position } from './geo'
import { buildNetwork } from './network'
import routesJson from '../public/data/routes.geojson?raw'

const line = (coordinates: Position[]): GeoJSON.LineString => ({ type: 'LineString', coordinates })
const north = (p: Position, m: number): Position => [p[0], p[1] + m / 111_195]
const O: Position = [-3.7, 40.4]
const E: Position = [-3.69, 40.4]

describe('buildNetwork', () => {
  it('joins tracks that cross without a shared vertex', () => {
    const net = buildNetwork([line([O, E]), line([[-3.695, 40.395], [-3.695, 40.405]])])
    expect(net.components).toHaveLength(1)
    const leg = net.leg(O, [-3.695, 40.405])!
    expect(leg.path.some((p) => haversineMeters(p, [-3.695, 40.4]) < 1)).toBe(true)
    expect(leg.m).toBeCloseTo(haversineMeters(O, [-3.695, 40.4]) + haversineMeters([-3.695, 40.4], [-3.695, 40.405]), 0)
  })

  it('joins a track ending within the tolerance of another one (T-junction), but not beyond it', () => {
    const stem = [north([-3.695, 40.4], 12), north([-3.695, 40.4], 800)]
    expect(buildNetwork([line([O, E]), line(stem)]).leg(O, stem[1])).not.toBeNull()
    expect(buildNetwork([line([O, E]), line(stem)], 10).leg(O, stem[1])).toBeNull()
  })

  it('joins near-parallel tracks within the tolerance', () => {
    const other = [north([-3.698, 40.4], 15), north([-3.68, 40.4], 15)]
    const net = buildNetwork([line([O, E]), line(other)])
    expect(net.components).toHaveLength(1)
    expect(net.leg(O, other[1])!.m).toBeLessThan(haversineMeters(O, other[1]) + 30)
  })

  it('closes a loop whose ends almost meet, without shortcutting along the track', () => {
    const a = north(O, 1000), b = [-3.69, 40.409], end = north(O, -11)
    const net = buildNetwork([line([O, a, b, E, end])])
    expect(net.leg(north(O, 500), E)!.m).toBeLessThan(1400)
    expect(buildNetwork([line([O, a, b, E, end])], 5).leg(north(O, 500), E)!.m).toBeGreaterThan(2300)
    expect(net.leg(O, north(O, 30))!.m).toBeCloseTo(30, 0)
  })

  it('keeps distant tracks in separate components', () => {
    const net = buildNetwork([line([O, E]), line([[-3.6, 40.5], [-3.59, 40.5]])])
    expect(net.components).toHaveLength(2)
    expect(net.leg(O, [-3.6, 40.5])).toBeNull()
    expect(net.route([O, E, [-3.6, 40.5]])).toBeNull()
  })
})

describe('routing', () => {
  const short = line([O, north(O, 200), E])
  const detour = line([O, [-3.7, 40.42], [-3.69, 40.42], E])
  const net = buildNetwork([short, detour])

  it('takes the shortest path and starts and ends on the snapped points', () => {
    const leg = net.leg(O, E)!
    expect(leg.m).toBeCloseTo(haversineMeters(O, north(O, 200)) + haversineMeters(north(O, 200), E), 0)
    expect(leg.path[0]).toEqual(O)
    expect(leg.path.at(-1)).toEqual(E)
  })

  it('joins two points on the same segment directly', () => {
    const a: Position = [-3.698, 40.42], b: Position = [-3.692, 40.42]
    const leg = net.leg(a, b)!
    expect(leg.path).toHaveLength(2)
    expect(leg.m).toBeCloseTo(haversineMeters(a, b), 3)
  })

  it('rejects points farther than 300 m from the network', () => {
    expect(net.leg(O, north(E, -400))).toBeNull()
    expect(net.route([north(E, -400)])).toBeNull()
    expect(net.route([])).toEqual([])
  })

  it('caches legs and joins them into one path', () => {
    const mid = north(O, 100)
    expect(net.leg(O, mid)).toBe(net.leg(O, mid))
    const path = net.route([O, mid, E])!
    expect(path).toEqual([...net.leg(O, mid)!.path, ...net.leg(mid, E)!.path.slice(1)])
  })

  it('never repeats a vertex, even for repeated points or points on a vertex', () => {
    const corner = north(O, 200)
    expect(net.leg(O, O)!.path).toEqual([O])
    const path = net.route([O, O, corner, E])!
    expect(path.length).toBeGreaterThan(2)
    expect(path.every((p, i) => i === 0 || `${p}` !== `${path[i - 1]}`)).toBe(true)
  })
})

describe('official network', () => {
  const data = JSON.parse(routesJson) as GeoJSON.FeatureCollection<GeoJSON.Geometry, { id: string }>
  const net = buildNetwork(data.features.map((f) => f.geometry))
  const start = (id: string) => (data.features.find((f) => f.properties.id === id)!.geometry as GeoJSON.MultiLineString).coordinates[0][0]

  it('builds three components: the main network, RC4, and RC8 with RL10', () => {
    expect(net.components).toHaveLength(3)
    expect(net.components[0]).toBeGreaterThan(5 * net.components[1])
    expect(net.leg(start('RL19'), start('RL20'))).not.toBeNull()
    expect(net.leg(start('RC8'), start('RL10'))).not.toBeNull()
    expect(net.leg(start('RL19'), start('RC4'))).toBeNull()
    expect(net.leg(start('RL19'), start('RL10'))).toBeNull()
  })
})
