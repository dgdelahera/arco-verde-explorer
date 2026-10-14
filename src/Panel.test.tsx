import '@testing-library/jest-dom/vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { act } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { emptyFilters, filterRoutes, parseRoutes } from './filters'
import { Panel, type LocateStatus } from './Panel'
import { fixture } from './test/fixture'

afterEach(cleanup)

const data = parseRoutes(fixture)
const long = 'Texto largo. '.repeat(40)
const withProps = (id: string, extra: object) => ({
  ...data,
  routes: data.routes.map((r) => (r.properties.id === id ? { ...r, properties: { ...r.properties, ...extra } } : r)),
})

function Harness({ onSelect = () => {}, selectedId = 'RL2', d = data, distances = null, locateStatus = 'idle' }: {
  onSelect?: (id: string | null) => void; selectedId?: string | null; d?: typeof data; distances?: Map<string, number> | null; locateStatus?: LocateStatus
}) {
  const [filters, setFilters] = useState(emptyFilters)
  return (
    <Panel data={d} visible={filterRoutes(d.routes, filters)} filters={filters} onFiltersChange={setFilters}
      selectedId={selectedId} onSelect={onSelect} onShowAll={() => {}} distances={distances} locateStatus={locateStatus} onLocate={() => {}} />
  )
}

it('filters the list and reports selection', () => {
  const onSelect = vi.fn()
  render(<Harness onSelect={onSelect} />)
  const list = screen.getByRole('list')
  expect(list.querySelectorAll('li')).toHaveLength(2)
  expect(screen.getByText(/Cruce de carretera/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Plano (PDF)' })).toHaveAttribute('href', 'https://example.org/rl2.pdf')

  fireEvent.change(screen.getByLabelText('Municipio'), { target: { value: 'Las Rozas' } })
  expect(list.querySelectorAll('li')).toHaveLength(1)
  expect(screen.getByText('1 de 2 rutas')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: /Senda del Arroyo/ }))
  expect(onSelect).toHaveBeenCalledWith('RC1')
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
  expect(screen.getByText('Corta · Circular · desnivel 80 m · a 12,3 km')).toBeInTheDocument()
  expect(screen.getByText('Categoría', { selector: 'dt' })).toBeInTheDocument()
  expect(screen.getByText(/14 de octubre de 2026/)).toBeInTheDocument()
  expect(screen.getByText('2 de 2 rutas')).toHaveAttribute('aria-live', 'polite')
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
  render(<Panel data={data} visible={data.routes} filters={emptyFilters} onFiltersChange={() => {}} selectedId={null} onSelect={() => {}}
    onShowAll={() => {}} distances={null} locateStatus="loading" onLocate={onLocate} />)
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
