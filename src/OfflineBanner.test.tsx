import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { OfflineBanner } from './OfflineBanner'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const go = (online: boolean) => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online)
  act(() => { dispatchEvent(new Event(online ? 'online' : 'offline')) })
}

it('shows the banner while offline and hides it when back online', () => {
  render(<OfflineBanner />)
  expect(screen.getByRole('status')).toBeEmptyDOMElement()
  go(false)
  expect(screen.getByRole('status')).toHaveTextContent('Sin conexión: mostrando datos guardados')
  go(true)
  expect(screen.getByRole('status')).toBeEmptyDOMElement()
})

it('starts visible when the page loads offline', () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  render(<OfflineBanner />)
  expect(screen.getByRole('status')).toHaveTextContent('Sin conexión')
})
