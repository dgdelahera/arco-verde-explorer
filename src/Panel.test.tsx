import '@testing-library/jest-dom/vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { emptyFilters, filterRoutes, parseRoutes } from './filters'
import { Panel } from './Panel'
import { fixture } from './test/fixture'

afterEach(cleanup)

const data = parseRoutes(fixture)
const long = 'Texto largo. '.repeat(40)
const withProps = (id: string, extra: object) => ({
  ...data,
  routes: data.routes.map((r) => (r.properties.id === id ? { ...r, properties: { ...r.properties, ...extra } } : r)),
})

function Harness({ onSelect = () => {}, selectedId = 'RL2', d = data, distances = null }: {
  onSelect?: (id: string | null) => void; selectedId?: string | null; d?: typeof data; distances?: Map<string, number> | null
}) {
  const [filters, setFilters] = useState(emptyFilters)
  return (
    <Panel data={d} visible={filterRoutes(d.routes, filters)} filters={filters} onFiltersChange={setFilters}
      selectedId={selectedId} onSelect={onSelect} onShowAll={() => {}} distances={distances} locateStatus="idle" onLocate={() => {}} />
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
  expect(screen.getByRole('heading', { name: 'Filtros' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Rutas' })).toBeInTheDocument()
  expect(screen.getByText(/Corta · a 12,3 km/)).toBeInTheDocument()
  expect(screen.getByText('Categoría', { selector: 'dt' })).toBeInTheDocument()
  expect(screen.getByText(/14 de octubre de 2026/)).toBeInTheDocument()
  expect(screen.getByText('2 de 2 rutas')).toHaveAttribute('aria-live', 'polite')
})

it('renders notice above precauciones, directions and the Strava hint', () => {
  render(<Harness d={withProps('RL2', { notice: 'TEMPORALMENTE NO SEÑALIZADA' })} />)
  const notice = screen.getByText(/TEMPORALMENTE NO SEÑALIZADA/).closest('p')!
  const warn = screen.getByText(/Cruce de carretera/).closest('p')!
  expect(notice.compareDocumentPosition(warn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Cómo llegar al inicio' })).toHaveAttribute('href', expect.stringContaining('destination=40.6,-3.7'))
  expect(screen.getByText(/importarlo en Strava/)).toBeInTheDocument()
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
