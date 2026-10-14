/// <reference types="geojson" />

export type Position = number[]

export function haversineMeters(a: Position, b: Position): number {
  const rad = Math.PI / 180
  const dLat = (b[1] - a[1]) * rad
  const dLon = (b[0] - a[0]) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2
  return 2 * 6371008.8 * Math.asin(Math.sqrt(h))
}

export function lines(geometry: GeoJSON.Geometry): Position[][] {
  if (geometry.type === 'LineString') return [geometry.coordinates]
  if (geometry.type === 'MultiLineString') return geometry.coordinates
  return []
}

export function lengthMeters(geometry: GeoJSON.Geometry): number {
  let total = 0
  for (const line of lines(geometry))
    for (let i = 1; i < line.length; i++) total += haversineMeters(line[i - 1], line[i])
  return total
}
