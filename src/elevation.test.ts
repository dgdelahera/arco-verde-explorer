import { describe, expect, it, vi } from 'vitest'
import { buildProfile, gainLoss, gridAt, lookupElevations, parseAsc, parseElevation, sampleLines, smooth, tileKey, tileUrl, type Grid } from './elevation'

// Hand-written in the shape of a WCS GetCoverage multipart response from servicios.idee.es (format=application/asc); the 3x3 grid and its values are made up.
const ASC = `
--wcs
Content-Type: application/asc
Content-ID: coverage/out.asc

ncols        3
nrows        3
xllcorner    -3.750000000000
yllcorner    40.400000000000
cellsize     0.001000000000
 600 610 620
 590 600 610
 580 590 600
--wcs
Content-Type: application/asc
Content-ID: coverage/out.prj

GEOGCS["GCS_WGS_1984"]
--wcs--
`

describe('sampleLines', () => {
  it('samples every step along the line and keeps the last vertex', () => {
    const s = sampleLines([[[-3.7, 40.4], [-3.7, 40.401]]], 50) // ~111 m due north
    expect(s.map((q) => Math.round(q.d))).toEqual([0, 50, 100, 111])
    expect(s[1].p[1]).toBeCloseTo(40.4 + 0.001 * (50 / 111.2), 5)
    expect(s.at(-1)!.p).toEqual([-3.7, 40.401])
  })
  it('keeps counting distance across parts and tags each sample with its part', () => {
    const s = sampleLines([[[0, 0], [0, 0.0005]], [[1, 1], [1, 1.0005]]], 50)
    expect(s.map((q) => q.part)).toEqual([0, 0, 0, 1, 1, 1])
    expect(Math.round(s.at(-1)!.d)).toBe(111)
  })
})

describe('parseAsc / gridAt', () => {
  const g = parseAsc(ASC)
  it('reads the grid out of the multipart response', () => {
    expect(g).toMatchObject({ ncols: 3, nrows: 3, xll: -3.75, yll: 40.4, cell: 0.001 })
    expect([...g.z]).toEqual([600, 610, 620, 590, 600, 610, 580, 590, 600])
  })
  it('interpolates bilinearly between cell centres (row 0 is north)', () => {
    expect(gridAt(g, -3.7485, 40.4015)).toBeCloseTo(600) // centre cell
    expect(gridAt(g, -3.749, 40.4015)).toBeCloseTo(595) // halfway to the west cell
    expect(gridAt(g, -3.7485, 40.402)).toBeCloseTo(605) // halfway to the north cell
    expect(gridAt(g, -3.7, 40.4)).toBeNull()
  })
  it('treats nodata as missing and rejects truncated grids', () => {
    const nd = parseAsc('ncols 2\nnrows 2\nxllcorner 0\nyllcorner 0\ncellsize 1\nNODATA_value -9999\n1 2\n3 -9999')
    expect(gridAt(nd, 1, 1)).toBeNull()
    expect(() => parseAsc('ncols 2\nnrows 2\nxllcorner 0\nyllcorner 0\ncellsize 1\n1 2 3')).toThrow()
  })
})

describe('lookupElevations', () => {
  it('fetches each 0.05° tile once and caches it', async () => {
    const fetchText = vi.fn(async () => ASC.replace('xllcorner    -3.750000000000', 'xllcorner -3.7505').replace('yllcorner    40.400000000000', 'yllcorner 40.3995'))
    const cache = new Map<string, Grid>()
    const z = await lookupElevations([[-3.749, 40.401], [-3.749, 40.401]], fetchText, cache)
    expect(fetchText).toHaveBeenCalledOnce()
    expect(fetchText.mock.calls[0]).toEqual([tileUrl(tileKey([-3.749, 40.401]))])
    expect(tileUrl('-75,808')).toContain('subset=Lat(40.3995,40.4505)&subset=Long(-3.7505,-3.6995)')
    expect(z).toHaveLength(2)
  })
  it('throws when a point falls outside the data', async () => {
    await expect(lookupElevations([[-3.6, 40.44]], async () => ASC, new Map())).rejects.toThrow(/Sin datos/)
  })
})

describe('gain and loss', () => {
  it('smooths with a centred window that shrinks at the ends', () => {
    expect(smooth([0, 3, 0, 3, 0], 3)).toEqual([1.5, 1, 2, 1, 1.5])
  })
  it('sums ups and downs', () => {
    expect(gainLoss([600, 610, 605, 620])).toEqual({ gain: 25, loss: 5 })
  })
  it('lets smoothing absorb sample noise instead of inflating the gain', () => {
    const noisy = Array.from({ length: 40 }, (_, i) => 600 + i + (i % 2 ? 2 : -2))
    const samples = noisy.map((_, i) => ({ d: i * 50, p: [0, 0], part: 0 }))
    expect(gainLoss(noisy).gain).toBeGreaterThan(80)
    expect(buildProfile(samples, noisy).gainM).toBeLessThan(45)
  })
  it('does not count the jump between disjoint parts', () => {
    const samples = [0, 50, 100, 100, 150, 200].map((d, i) => ({ d, p: [0, 0], part: i < 3 ? 0 : 1 }))
    const p = buildProfile(samples, [600, 600, 600, 700, 700, 700])
    expect(p).toMatchObject({ gainM: 0, lossM: 0, minM: 600, maxM: 700 })
    expect(p.profile).toEqual([[0, 600], [0.05, 600], [0.1, 600], [0.1, 700], [0.15, 700], [0.2, 700]])
  })
  it('decimates the stored profile but keeps the end', () => {
    const z = Array.from({ length: 1001 }, () => 650)
    const p = buildProfile(z.map((_, i) => ({ d: i * 50, p: [0, 0], part: 0 })), z, 300)
    expect(p.profile.length).toBeLessThanOrEqual(301)
    expect(p.profile.at(-1)).toEqual([50, 650])
  })
})

describe('parseElevation', () => {
  it('keeps valid profiles and drops broken ones', () => {
    const ok = { gainM: 1, lossM: 2, minM: 3, maxM: 4, profile: [[0, 3], [1, 4]] }
    const parsed = parseElevation({ metadata: { source: 'MDT25' }, routes: { RC1: ok, RC2: { ...ok, profile: [[0, 1]] }, RC3: null } })
    expect(Object.keys(parsed!.routes)).toEqual(['RC1'])
    expect(parseElevation(null)).toBeNull()
    expect(parseElevation({ routes: {} })).toBeNull()
  })
})
