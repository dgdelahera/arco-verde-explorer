export const fixture = {
  type: 'FeatureCollection',
  metadata: { source: 'Comunidad de Madrid', sourceUrl: 'https://www.comunidad.madrid/medio-ambiente/arco-verde', extractedAt: '2026-10-14' },
  features: [
    {
      type: 'Feature',
      geometry: { type: 'MultiLineString', coordinates: [[[-3.9, 40.5], [-3.89, 40.51]]] },
      properties: {
        id: 'RC1', name: 'Senda del Arroyo', category: 'corta', municipalities: ['Majadahonda', 'Las Rozas'],
        distanceKm: 6.2, elevationGainM: 80, type: 'Circular', sector: '1', warnings: null,
        description: 'Primer párrafo.\n\nSegundo párrafo.', gpxUrl: 'https://example.org/rc1.gpx', planUrl: null, computedLengthKm: 6.4,
      },
    },
    {
      type: 'Feature',
      geometry: { type: 'MultiLineString', coordinates: [[[-3.7, 40.6], [-3.6, 40.65]]] },
      properties: {
        id: 'RL2', name: 'Camino de Alcobendas', category: 'larga', municipalities: ['Alcobendas'],
        distanceKm: 18, elevationGainM: 250, type: 'Lineal', sector: '2', warnings: 'Cruce de carretera',
        description: null, gpxUrl: 'https://example.org/rl2.gpx', planUrl: 'https://example.org/rl2.pdf', computedLengthKm: 17.6,
      },
    },
    {
      type: 'Feature',
      geometry: null,
      properties: {
        id: 'RL3', name: 'Ruta sin track', category: 'larga', municipalities: ['Getafe'],
        distanceKm: 20, elevationGainM: null, type: null, sector: null, warnings: null,
        description: null, gpxUrl: 'https://example.org/rl3.gpx', planUrl: null, computedLengthKm: 0,
      },
    },
  ],
}
