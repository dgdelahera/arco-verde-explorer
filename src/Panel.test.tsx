import '@testing-library/jest-dom/vitest'
import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { emptyFilters, filterRoutes, parseRoutes } from './filters'
import { Panel } from './Panel'
import { fixture } from './test/fixture'

const data = parseRoutes(fixture)

function Harness({ onSelect }: { onSelect: (id: string) => void }) {
  const [filters, setFilters] = useState(emptyFilters)
  return (
    <Panel data={data} visible={filterRoutes(data.routes, filters)} filters={filters} onFiltersChange={setFilters}
      selectedId="RL2" onSelect={onSelect} onShowAll={() => {}} />
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
  expect(screen.getByText('1 de 2 rutas', { exact: false })).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: /Senda del Arroyo/ }))
  expect(onSelect).toHaveBeenCalledWith('RC1')
})
