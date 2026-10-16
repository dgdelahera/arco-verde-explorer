import { describe, expect, it } from 'vitest'
import { decodePlan, MAX_POINTS, planHash, planMeters } from './plan'

describe('plan hash', () => {
  it('round-trips points rounded to 5 decimals in lat,lon order', () => {
    const hash = planHash([[-3.703812345, 40.416812345], [-3.6921, 40.4193]])
    expect(hash).toBe('#plan=40.41681,-3.70381;40.4193,-3.6921')
    expect(decodePlan(hash)).toEqual([[-3.70381, 40.41681], [-3.6921, 40.4193]])
  })
  it('accepts an empty plan and a percent-encoded separator', () => {
    expect(decodePlan('#plan=')).toEqual([])
    expect(decodePlan('#plan=40.1,-3.2%3B40.2,-3.3')).toEqual([[-3.2, 40.1], [-3.3, 40.2]])
  })
  it('ignores route links and rejects malformed input', () => {
    for (const h of ['#RL2', '', '#plan=40.1', '#plan=40.1,', '#plan=40.1,-3.2;', '#plan=abc,def', '#plan=95,-3', '#plan=40,200', '#plan=1e3,2', '#plan=%E0%A4%A'])
      expect(decodePlan(h)).toBeNull()
  })
  it('rejects plans over the point cap', () => {
    const plan = (n: number) => '#plan=' + Array.from({ length: n }, () => '40.1,-3.2').join(';')
    expect(decodePlan(plan(MAX_POINTS))).toHaveLength(MAX_POINTS)
    expect(decodePlan(plan(MAX_POINTS + 1))).toBeNull()
  })
})

describe('planMeters', () => {
  it('sums haversine legs', () => {
    expect(planMeters([])).toBe(0)
    expect(planMeters([[-3.7038, 40.4168]])).toBe(0)
    const d = planMeters([[-3.7038, 40.4168], [-3.6921, 40.4193], [-3.7038, 40.4168]])
    expect(Math.abs(d - 2060)).toBeLessThan(40)
  })
})
