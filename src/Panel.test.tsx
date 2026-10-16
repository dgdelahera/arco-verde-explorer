import '@testing-library/jest-dom/vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { act } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { emptyFilters, filterRoutes, parseRoutes } from './filters'
import { Panel, type LocateStatus, type Planner, type PoiPanel } from './Panel'
import type { PoiFeature } from './pois'
import { fixture } from './test/fixture'
import { parseElevation, type ElevationData } from './elevation'
import { buildNetwork } from './network'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear() })

const data = parseRoutes(fixture)
const network = buildNetwork(data.routes.map((r) => r.geometry))
const long = 'Texto largo. '.repeat(40)
const withProps = (id: string, extra: object) => ({
  ...data,
  routes: data.routes.map((r) => (r.properties.id === id ? { ...r, properties: { ...r.properties, ...extra } } : r)),
})

const noPois: PoiPanel = { active: new Set(), toggle: () => {}, status: 'idle', metadata: null, matches: [], focus: () => {} }

function Harness({ onSelect = () => {}, selectedId = 'RL2', d = data, distances = null, locateStatus = 'idle', planner = null, onPlan = () => {}, pois = noPois, elevation = null }: {
  onSelect?: (id: string | null) => void; selectedId?: string | null; d?: typeof data; distances?: Map<string, number> | null; locateStatus?: LocateStatus
  planner?: Planner | null; onPlan?: (seed?: number[][]) => void; pois?: PoiPanel; elevation?: ElevationData | null
}) {
  const [filters, setFilters] = useState(emptyFilters)
  return (
    <Panel data={d} visible={filterRoutes(d.routes, filters)} filters={filters} onFiltersChange={setFilters}
      selectedId={selectedId} onSelect={onSelect} distances={distances} locateStatus={locateStatus} onLocate={() => {}} planner={planner} onPlan={onPlan} network={network} pois={pois} elevation={elevation} />
  )
}

it('filters the list and reports selection', () => {
  const onSelect = vi.fn()
  render(<Harness onSelect={onSelect} />)
  expect(screen.getAllByRole('listitem')).toHaveLength(2)
  expect(screen.getByText(/Cruce de carretera/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Plano (PDF)' })).toHaveAttribute('href', 'https://example.org/rl2.pdf')

  fireEvent.change(screen.getByLabelText('Municipio'), { target: { value: 'Las Rozas' } })
  expect(screen.getAllByRole('listitem')).toHaveLength(1)
  expect(screen.getByText('1 de 2 rutas')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: /Senda del Arroyo/ }))
  expect(onSelect).toHaveBeenCalledWith('RC1')
})

it('groups routes under Rutas cortas and Rutas largas and hides an empty group', () => {
  render(<Harness />)
  const group = (name: RegExp) => screen.getByRole('heading', { level: 3, name }).closest('section')!
  expect(within(group(/^Rutas cortas \(1\)$/)).getByRole('button', { name: /Senda del Arroyo/ })).toBeInTheDocument()
  expect(within(group(/^Rutas largas \(1\)$/)).getByRole('button', { name: /Camino de Alcobendas/ })).toBeInTheDocument()
  expect(screen.getByText('2 de 2 rutas')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Categoría'), { target: { value: 'corta' } })
  expect(screen.getByRole('heading', { name: 'Rutas cortas (1)' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: /Rutas largas/ })).toBeNull()
})

it('renders Crear ruta as its own section before Rutas', () => {
  render(<Harness />)
  const heading = screen.getByRole('heading', { level: 2, name: 'Crear ruta' })
  const section = within(heading.closest('section')!)
  expect(section.getByText('Dibuja tu propio recorrido sobre los caminos de Arco Verde.')).toBeInTheDocument()
  expect(section.getByRole('button', { name: 'Crear ruta' })).toBeInTheDocument()
  expect(section.queryByRole('button', { name: 'Cerca de mí' })).toBeNull()
  expect(heading.compareDocumentPosition(screen.getByRole('heading', { name: 'Rutas' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

it('deselects when the selected item is pressed again', () => {
  const onSelect = vi.fn()
  render(<Harness onSelect={onSelect} />)
  const item = screen.getByRole('button', { name: /Camino de Alcobendas/ })
  expect(item).toHaveAttribute('aria-expanded', 'true')
  fireEvent.click(item)
  expect(onSelect).toHaveBeenCalledWith(null)
})

it('shows the empty state and clears filters', () => {
  render(<Harness />)
  fireEvent.change(screen.getByLabelText(/Buscar/), { target: { value: 'zzz' } })
  expect(screen.getByText('Ninguna ruta coincide con los filtros')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }))
  expect(screen.getAllByRole('listitem')).toHaveLength(2)
})

it('searches ignoring spaces and hyphens', () => {
  render(<Harness />)
  fireEvent.change(screen.getByLabelText(/Buscar/), { target: { value: 'Las-Rozas' } })
  expect(screen.getAllByRole('listitem')).toHaveLength(1)
})

it('shows category as text, intro, landmarks and Spanish date', () => {
  render(<Harness distances={new Map([['RC1', 12.34]])} />)
  expect(screen.getByRole('main')).toBeInTheDocument()
  expect(screen.getByText(/2 rutas oficiales del Arco Verde de la Comunidad de Madrid/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Fuente oficial' })).toHaveAttribute('href', data.metadata!.sourceUrl)
  expect(screen.getByText('Filtros', { selector: 'summary' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Rutas' })).toBeInTheDocument()
  expect(screen.getByText('Corta · Circular · dif. altitud 80 m (oficial) · a 12,3 km')).toBeInTheDocument()
  expect(screen.getByText('Categoría', { selector: 'dt' })).toBeInTheDocument()
  expect(screen.getAllByText(/14 de octubre de 2026/)).toHaveLength(2)
  expect(screen.getByText('2 de 2 rutas')).toHaveAttribute('aria-live', 'polite')
})

it('shows a map legend without the length colour code', () => {
  render(<Harness />)
  const legend = screen.getByText('Red oficial').closest('p')!
  expect(legend).toHaveTextContent('Red oficial Ruta seleccionada Inicio / Fin')
  expect(screen.queryByRole('button', { name: 'Ver todas' })).toBeNull()
})

it('shows the data source and extraction date in the ficha', () => {
  render(<Harness />)
  const note = screen.getByText(/^Datos oficiales:/, { selector: '.details p' })
  expect(note).toHaveTextContent('extraídos el 14 de octubre de 2026')
  expect(note).toHaveTextContent('La longitud calculada es un cálculo propio')
  expect(within(note).getByRole('link', { name: 'Comunidad de Madrid' })).toHaveAttribute('href', data.metadata!.sourceUrl)
})

it('renders notice above precauciones, directions and the Strava hint', () => {
  render(<Harness d={withProps('RL2', { notice: 'TEMPORALMENTE NO SEÑALIZADA' })} />)
  const notice = screen.getByText(/TEMPORALMENTE NO SEÑALIZADA/).closest('p')!
  const warn = screen.getByText(/Cruce de carretera/).closest('p')!
  expect(notice.compareDocumentPosition(warn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Cómo llegar al inicio' })).toHaveAttribute('href', expect.stringMatching(/travelmode=transit&destination=40.6,-3.7$/))
  expect(screen.getByRole('link', { name: 'Volver desde el final' })).toHaveAttribute('href', expect.stringMatching(/travelmode=transit&origin=40.65,-3.6$/))
  expect(screen.getByText(/importarlo en Strava/)).toBeInTheDocument()
})

it('downloads a named GPX and keeps the original as a secondary link', async () => {
  let blob: Blob | undefined
  Object.assign(URL, { createObjectURL: (b: Blob) => { blob = b; return 'blob:gpx' }, revokeObjectURL: () => {} })
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    expect(this.download).toBe('arco-verde-RL2.gpx')
    expect(this.href).toBe('blob:gpx')
  })
  render(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: 'Descargar GPX' }))
  expect(click).toHaveBeenCalledOnce()
  expect(await blob!.text()).toContain('<trk><name>RL2 Camino de Alcobendas</name>')
  expect(screen.getByRole('link', { name: 'GPX original' })).toHaveAttribute('href', 'https://example.org/rl2.gpx')
  click.mockRestore()
})

it('filters by route type with always-visible options', () => {
  render(<Harness />)
  expect(screen.getByRole('radio', { name: 'Todas' })).toBeChecked()
  fireEvent.click(screen.getByRole('radio', { name: 'Circular' }))
  expect(screen.getAllByRole('listitem')).toHaveLength(1)
  expect(screen.getByRole('button', { name: /Senda del Arroyo/ })).toBeInTheDocument()
  expect(screen.getByText('Filtros', { selector: 'summary' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('radio', { name: 'Todas' }))
  expect(screen.getAllByRole('listitem')).toHaveLength(2)
})

it('counts active filters in the summary', () => {
  render(<Harness />)
  fireEvent.change(screen.getByLabelText(/Buscar/), { target: { value: 'Rozas' } })
  fireEvent.change(screen.getByLabelText('Categoría'), { target: { value: 'corta' } })
  expect(screen.getByText('Filtros (2)', { selector: 'summary' })).toBeInTheDocument()
})

it('moves focus to the route list after clearing filters', () => {
  render(<Harness />)
  fireEvent.change(screen.getByLabelText(/Buscar/), { target: { value: 'zzz' } })
  fireEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }))
  expect(screen.getByRole('heading', { name: 'Rutas' })).toHaveFocus()
})

it('keeps Cerca de mí focusable while locating and ignores clicks', () => {
  const onLocate = vi.fn()
  render(<Panel data={data} visible={data.routes} filters={emptyFilters} onFiltersChange={() => {}} selectedId={null} onSelect={() => {}} distances={null} locateStatus="loading" onLocate={onLocate} planner={null} onPlan={() => {}} network={network} pois={noPois} />)
  const btn = screen.getByRole('button', { name: 'Cerca de mí' })
  expect(btn).not.toBeDisabled()
  expect(btn).toHaveAttribute('aria-disabled', 'true')
  fireEvent.click(btn)
  expect(onLocate).not.toHaveBeenCalled()
})

it('flags a length mismatch only above 10%', () => {
  const msg = /no coincide con la distancia publicada/
  const { unmount } = render(<Harness />)
  expect(screen.queryByText(msg)).toBeNull()
  unmount()
  render(<Harness d={withProps('RL2', { computedLengthKm: 10 })} />)
  expect(screen.getByText(msg)).toBeInTheDocument()
})

it('collapses long descriptions behind Leer más', () => {
  render(<Harness d={withProps('RL2', { description: long })} />)
  const btn = screen.getByRole('button', { name: 'Leer más' })
  expect(btn).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(btn)
  expect(screen.getByRole('button', { name: 'Leer menos' })).toHaveAttribute('aria-expanded', 'true')
})

it('copies the share link when navigator.share is missing', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.assign(navigator, { clipboard: { writeText }, share: undefined })
  render(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: 'Compartir' }))
  expect(await screen.findByText('Enlace copiado')).toBeInTheDocument()
  expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/#RL2$/))
})

const share = () => fireEvent.click(screen.getByRole('button', { name: 'Compartir' }))

it('falls back to clipboard when navigator.share rejects with a non-abort error', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.assign(navigator, { clipboard: { writeText }, share: vi.fn().mockRejectedValue(new Error('boom')) })
  render(<Harness />)
  share()
  expect(await screen.findByText('Enlace copiado')).toBeInTheDocument()
})

it('does nothing when the share sheet is dismissed', async () => {
  const writeText = vi.fn()
  Object.assign(navigator, { clipboard: { writeText }, share: vi.fn().mockRejectedValue(new DOMException('x', 'AbortError')) })
  render(<Harness />)
  share()
  await act(async () => {})
  expect(writeText).not.toHaveBeenCalled()
})

it('prompts with the link and reports failure when the clipboard is unavailable', async () => {
  const prompt = vi.spyOn(window, 'prompt').mockReturnValue(null)
  Object.assign(navigator, { clipboard: undefined, share: undefined })
  render(<Harness />)
  share()
  expect(await screen.findByText('No se pudo copiar el enlace')).toBeInTheDocument()
  expect(prompt).toHaveBeenCalledWith('Copia el enlace', expect.stringMatching(/#RL2$/))
  prompt.mockRestore()
})

it('clears the share message after 3 seconds', async () => {
  vi.useFakeTimers()
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) }, share: undefined })
  render(<Harness />)
  share()
  await act(async () => {})
  expect(screen.getByText('Enlace copiado')).toBeInTheDocument()
  act(() => { vi.advanceTimersByTime(3000) })
  expect(screen.queryByText('Enlace copiado')).toBeNull()
  vi.useRealTimers()
})

it('keeps one live region for locate status and announces success', () => {
  const { rerender } = render(<Harness />)
  const region = screen.getAllByRole('status').find((el) => el.classList.contains('locate-msg'))!
  rerender(<Harness locateStatus="done" />)
  expect(region).toHaveTextContent('Rutas ordenadas por cercanía')
  rerender(<Harness locateStatus="denied" />)
  expect(region).toHaveTextContent(/denegado/)
})

it('uses a fixed label with aria-pressed for the size toggle', () => {
  render(<Harness />)
  const btn = screen.getByRole('button', { name: 'Ampliar panel' })
  expect(btn).toHaveAttribute('aria-pressed', 'false')
  fireEvent.click(btn)
  expect(screen.getByRole('button', { name: 'Ampliar panel' })).toHaveAttribute('aria-pressed', 'true')
})

it('offers the planner and seeds it from the selected route start', () => {
  const onPlan = vi.fn()
  render(<Harness onPlan={onPlan} />)
  fireEvent.click(screen.getByRole('button', { name: 'Crear ruta' }))
  expect(onPlan).toHaveBeenCalledWith()
  fireEvent.click(screen.getByRole('button', { name: 'Empezar desde esta ruta' }))
  expect(onPlan).toHaveBeenLastCalledWith([[-3.7, 40.6]])
})

it('shows planner metrics, labels and controls', async () => {
  const points = [[-3.7038, 40.4168], [-3.6921, 40.4193]]
  const planner = { points, path: [points[0], [-3.7038, 40.4258], points[1]], canUndo: false, undo: vi.fn(), clear: vi.fn(), exit: vi.fn(), addCenter: vi.fn() }
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.assign(navigator, { clipboard: { writeText }, share: undefined })
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
  render(<Harness selectedId={null} planner={planner} />)
  const section = within(screen.getByRole('region', { name: 'Crear ruta' }))
  expect(section.getByText(/Distancia: 2,2 km/).closest('p')).toHaveTextContent('Distancia: 2,2 km · 2 puntos')
  expect(section.getByText(/Desnivel estimado/)).toHaveTextContent('Desnivel estimado: calculando…')
  expect(await section.findByText(/no se pudo consultar el modelo del terreno/, undefined, { timeout: 2000 })).toHaveTextContent('Desnivel estimado: no disponible')
  expect(section.getByText(/Duración estimada: 35 min/)).toHaveTextContent('a 4 km/h')
  expect(section.getByRole('note')).toHaveTextContent('Trazado manual — no es una ruta validada. Sigue los tracks oficiales de Arco Verde, que pueden incluir tramos por carretera o variantes')
  expect(section.getByRole('note')).not.toHaveTextContent(/línea recta/)
  expect(section.getByText(/se une al anterior siguiendo los caminos oficiales/)).toBeInTheDocument()
  let blob: Blob | undefined
  Object.assign(URL, { createObjectURL: (b: Blob) => { blob = b; return 'blob:gpx' }, revokeObjectURL: () => {} })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  fireEvent.click(section.getByRole('button', { name: 'Descargar GPX' }))
  const gpx = await blob!.text()
  expect(gpx.match(/<trkpt /g)).toHaveLength(3)
  expect(gpx).toContain('<trkpt lat="40.4258" lon="-3.7038"/>')
  expect(section.getByRole('button', { name: 'Deshacer' })).toBeDisabled()
  fireEvent.click(section.getByRole('button', { name: 'Borrar' }))
  fireEvent.click(section.getByRole('button', { name: 'Salir' }))
  expect(planner.clear).toHaveBeenCalledOnce()
  expect(planner.exit).toHaveBeenCalledOnce()
  fireEvent.click(section.getByRole('button', { name: 'Compartir' }))
  expect(await section.findByText('Enlace copiado')).toBeInTheDocument()
  expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/#plan=40\.4168,-3\.7038;40\.4193,-3\.6921$/))
})

it('adds a planner point at the map centre from the keyboard', () => {
  const planner = { points: [], path: [], canUndo: false, undo: vi.fn(), clear: vi.fn(), exit: vi.fn(), addCenter: vi.fn() }
  const { rerender } = render(<Harness selectedId={null} planner={planner} />)
  expect(screen.queryByText(/Desnivel estimado/)).not.toBeInTheDocument()
  const add = screen.getByRole('button', { name: 'Añadir punto en el centro del mapa' })
  add.focus()
  fireEvent.click(add)
  expect(planner.addCenter).toHaveBeenCalledOnce()
  rerender(<Harness selectedId={null} planner={{ ...planner, points: Array.from({ length: 200 }, () => [-3.7, 40.4]) }} />)
  expect(screen.getByRole('button', { name: 'Añadir punto en el centro del mapa' })).toBeDisabled()
})

it('toggles POI categories, lists matching places and credits OpenStreetMap', () => {
  const fuente: PoiFeature = { type: 'Feature', geometry: { type: 'Point', coordinates: [-3.8, 40.5] }, properties: { id: 'node/1', name: 'Fuente del Pino', category: 'fuente' } }
  const pois = { ...noPois, active: new Set(['transporte'] as const), toggle: vi.fn(), focus: vi.fn(), status: 'error' as const, matches: [fuente], metadata: data.metadata }
  render(<Harness pois={pois} />)
  const chips = within(screen.getByRole('group', { name: 'Puntos de interés' }))
  expect(chips.getByRole('checkbox', { name: /Estaciones/ })).toBeChecked()
  fireEvent.click(chips.getByRole('checkbox', { name: /Fuentes/ }))
  expect(pois.toggle).toHaveBeenCalledWith('fuente')
  expect(chips.getByRole('status')).toHaveTextContent('No se pudieron cargar los puntos de interés')
  fireEvent.click(within(screen.getByRole('list', { name: 'Lugares cercanos a las rutas' })).getByRole('button', { name: /Fuente del Pino/ }))
  expect(pois.focus).toHaveBeenCalledWith(fuente)
  fireEvent.change(screen.getByLabelText(/Buscar/), { target: { value: 'zzz' } })
  expect(screen.getByText(/Ninguna ruta coincide con los filtros, pero hay un lugar con ese nombre/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'OpenStreetMap contributors' })).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright')
  expect(screen.getByText(/ODbL, extraídos el 14 de octubre de 2026/)).toBeInTheDocument()
})

it('shows the computed profile and gain apart from the official desnivel, with source and limits', () => {
  const elevation = parseElevation({
    metadata: {
      source: 'MDT25 del Instituto Geográfico Nacional (PNOA-LiDAR)', sourceUrl: 'https://www.scne.es/productos.html', serviceUrl: 'https://servicios.idee.es/wcs-inspire/mdt',
      attribution: '© Instituto Geográfico Nacional', licence: 'CC BY 4.0 scne.es', licenceUrl: 'https://creativecommons.org/licenses/by/4.0/deed.es',
      resolutionM: 25, sampleSpacingM: 50, smoothing: 'media móvil de 5 muestras', retrievedAt: '2026-10-16',
    },
    routes: { RL2: { gainM: 210, lossM: 180, minM: 640, maxM: 760, profile: [[0, 650], [8.8, 760], [17.6, 680]] } },
  })
  const { rerender } = render(<Harness elevation={elevation} />)
  const details = within(screen.getByRole('article', { name: /Camino de Alcobendas/ }))
  expect(details.getByText('Desnivel oficial (diferencia de altitud)').nextElementSibling).toHaveTextContent('250 m')
  expect(details.getByText('Desnivel calculado').nextElementSibling).toHaveTextContent('+210 m / −180 m (modelo digital del terreno MDT25 del Instituto Geográfico Nacional (PNOA-LiDAR))')
  expect(details.getByText('Altitud calculada').nextElementSibling).toHaveTextContent('640 m – 760 m')
  const profile = details.getByRole('img', { name: /Perfil de elevación calculado: altitud entre 640 m y 760 m a lo largo de 17,6 km; desnivel \+210 m \/ −180 m/ })
  expect([...profile.querySelectorAll('text')].map((t) => t.textContent)).toEqual(['760 m', '640 m', '0 km', '17,6 km'])
  expect(details.getByRole('link', { name: 'CC BY 4.0 scne.es' })).toHaveAttribute('href', 'https://creativecommons.org/licenses/by/4.0/deed.es')
  expect(details.getByText(/no recoge puentes ni pasos inferiores/)).toBeInTheDocument()

  rerender(<Harness elevation={null} />)
  expect(screen.queryByText('Desnivel calculado')).not.toBeInTheDocument()
  expect(screen.getByText(/no se muestra perfil de elevación/)).toBeInTheDocument()
})

const planner = (extra: Partial<Planner> = {}): Planner => ({ points: [], path: [], canUndo: false, undo: vi.fn(), clear: vi.fn(), exit: vi.fn(), addCenter: vi.fn(), ...extra })

it('labels the official figure as an altitude difference in the filter', () => {
  render(<Harness />)
  expect(screen.getByLabelText('Dif. altitud máx. (m, oficial)')).toBeInTheDocument()
})

it('hides Crear ruta while planning and moves focus into and out of the planner', () => {
  const { rerender } = render(<Harness selectedId={null} />)
  rerender(<Harness selectedId={null} planner={planner()} />)
  expect(screen.queryByRole('button', { name: 'Crear ruta' })).toBeNull()
  expect(screen.queryByText('Dibuja tu propio recorrido sobre los caminos de Arco Verde.')).toBeNull()
  expect(screen.getByRole('heading', { name: 'Crear ruta' })).toHaveFocus()
  rerender(<Harness selectedId={null} />)
  expect(screen.getByRole('button', { name: 'Crear ruta' })).toHaveFocus()
})

it('asks before a route seed replaces a saved draft', () => {
  const onPlan = vi.fn()
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  localStorage.setItem('arco-verde-plan', '#plan=40.5,-3.9;40.51,-3.89')
  render(<Harness onPlan={onPlan} />)
  fireEvent.click(screen.getByRole('button', { name: 'Empezar desde esta ruta' }))
  expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/trazado guardado de 2 puntos/))
  expect(onPlan).not.toHaveBeenCalled()
  confirm.mockReturnValue(true)
  fireEvent.click(screen.getByRole('button', { name: 'Empezar desde esta ruta' }))
  expect(onPlan).toHaveBeenCalledWith([[-3.7, 40.6]])
})

it('marks external links as unavailable offline', () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  render(<Harness />)
  for (const name of ['Cómo llegar al inicio', 'Volver desde el final', 'Plano (PDF)']) {
    const link = screen.getByRole('link', { name: `${name} (requiere conexión)` })
    expect(link).toHaveAttribute('aria-disabled', 'true')
    expect(link).not.toHaveAttribute('href')
  }
  expect(screen.getByText(/El mapa base puede estar incompleto/)).toBeInTheDocument()
})

it('collapses the expanded sheet before adding the centre point', () => {
  const p = planner()
  render(<Harness selectedId={null} planner={p} />)
  fireEvent.click(screen.getByRole('button', { name: 'Ampliar panel' }))
  fireEvent.click(screen.getByRole('button', { name: 'Añadir punto en el centro del mapa' }))
  expect(p.addCenter).toHaveBeenCalledOnce()
  expect(screen.getByRole('button', { name: 'Ampliar panel' })).toHaveAttribute('aria-pressed', 'false')
})

it('announces the plan in one debounced status and covers keyboard users in the instructions', () => {
  vi.useFakeTimers()
  const p = planner({ points: [[-3.7038, 40.4168]], path: [[-3.7038, 40.4168]] })
  const { rerender } = render(<Harness selectedId={null} planner={p} />)
  const region = screen.getAllByRole('status').find((el) => el.classList.contains('visually-hidden'))!
  rerender(<Harness selectedId={null} planner={{ ...p, points: [[-3.7038, 40.4168], [-3.6921, 40.4193]], path: [[-3.7038, 40.4168], [-3.6921, 40.4193]] }} />)
  act(() => { vi.advanceTimersByTime(900) })
  expect(region).toBeEmptyDOMElement()
  act(() => { vi.advanceTimersByTime(100) })
  expect(region).toHaveTextContent('2 puntos, 1 km')
  expect(screen.getByText(/Distancia: 1 km/).closest('p')).not.toHaveAttribute('aria-live')
  expect(screen.getByText(/Toca o haz clic en el mapa, o usa «Añadir punto en el centro del mapa»/)).toBeInTheDocument()
  vi.useRealTimers()
})

it('retries the planner elevation when the browser comes back online', async () => {
  const fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
  vi.stubGlobal('fetch', fetch)
  render(<Harness selectedId={null} planner={planner({ points: [[-3.7038, 40.4168], [-3.6921, 40.4193]], path: [[-3.7038, 40.4168], [-3.6921, 40.4193]] })} />)
  await screen.findByText(/no se pudo consultar el modelo del terreno/, undefined, { timeout: 2000 })
  const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  act(() => { dispatchEvent(new Event('offline')) })
  await act(() => new Promise((r) => setTimeout(r, 900)))
  const offlineCalls = fetch.mock.calls.length
  onLine.mockReturnValue(true)
  act(() => { dispatchEvent(new Event('online')) })
  await act(() => new Promise((r) => setTimeout(r, 900)))
  expect(fetch.mock.calls.length).toBeGreaterThan(offlineCalls)
})

it('shows why a point off the network was rejected', () => {
  const msg = 'Solo se pueden añadir puntos sobre los caminos de Arco Verde (a menos de 300 m)'
  render(<Harness selectedId={null} planner={planner({ message: msg })} />)
  expect(screen.getAllByRole('status').find((el) => el.textContent === msg)).toBeDefined()
  expect(screen.getByText(/se ajusta al camino oficial más cercano/)).toBeInTheDocument()
})

it('does not offer to replace a saved draft that is off the network', () => {
  const onPlan = vi.fn()
  const confirm = vi.spyOn(window, 'confirm')
  localStorage.setItem('arco-verde-plan', '#plan=40.1,-3.2;40.2,-3.3')
  render(<Harness onPlan={onPlan} />)
  fireEvent.click(screen.getByRole('button', { name: 'Empezar desde esta ruta' }))
  expect(confirm).not.toHaveBeenCalled()
  expect(onPlan).toHaveBeenCalledWith([[-3.7, 40.6]])
})
