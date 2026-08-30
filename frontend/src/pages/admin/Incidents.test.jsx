import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import Incidents from './Incidents'

vi.mock('../../api', () => ({ default: { get: vi.fn(), patch: vi.fn() } }))
vi.mock('../../useWebSocket', () => ({ default: () => ({ connected: true }) }))

import api from '../../api'

const INCIDENTS = [
  { id: 1, type: 'sos', severity: 'critical', status: 'detected',
    description: 'A', detected_at: '2026-01-01T10:00:00', response_time_seconds: null },
  { id: 2, type: 'anomaly', severity: 'low', status: 'resolved',
    description: 'B', detected_at: '2026-01-03T10:00:00', response_time_seconds: 120 },
  { id: 3, type: 'geofence', severity: 'high', status: 'dispatched',
    description: 'C', detected_at: '2026-01-02T10:00:00', response_time_seconds: 45 },
]

beforeEach(() => {
  vi.clearAllMocks()
  api.get.mockResolvedValue({ data: INCIDENTS })
})

describe('Incidents severity filter and sort', () => {
  it('lists every incident with no filter applied', async () => {
    render(<Incidents />)
    await waitFor(() => expect(screen.getByText('A')).toBeInTheDocument())
    expect(screen.getByText('B')).toBeInTheDocument()
    expect(screen.getByText('C')).toBeInTheDocument()
  })

  it('defaults to newest-first ordering', async () => {
    render(<Incidents />)
    await waitFor(() => expect(screen.getByText('A')).toBeInTheDocument())
    const ids = screen.getAllByText(/^#\d$/).map((el) => el.textContent)
    expect(ids).toEqual(['#2', '#3', '#1']) // Jan 3, Jan 2, Jan 1
  })

  it('sorts by severity when selected', async () => {
    render(<Incidents />)
    await waitFor(() => expect(screen.getByText('A')).toBeInTheDocument())

    const selects = screen.getAllByRole('combobox')
    const sortSelect = selects[2] // status, severity, sort — in that render order
    fireEvent.change(sortSelect, { target: { value: 'severity' } })

    const ids = screen.getAllByText(/^#\d$/).map((el) => el.textContent)
    expect(ids).toEqual(['#1', '#3', '#2']) // critical, high, low
  })

  it('filters by severity client-side', async () => {
    render(<Incidents />)
    await waitFor(() => expect(screen.getByText('A')).toBeInTheDocument())

    const selects = screen.getAllByRole('combobox')
    fireEvent.change(selects[1], { target: { value: 'high' } }) // severity select
    expect(screen.getByText('C')).toBeInTheDocument()
    expect(screen.queryByText('A')).not.toBeInTheDocument()
    expect(screen.queryByText('B')).not.toBeInTheDocument()
  })

  it('re-fetches from the server when the status filter changes', async () => {
    render(<Incidents />)
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/incidents'))

    const selects = screen.getAllByRole('combobox')
    fireEvent.change(selects[0], { target: { value: 'resolved' } }) // status select
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/incidents?status=resolved'))
  })

  it('shows an empty-state message when the filter matches nothing', async () => {
    render(<Incidents />)
    await waitFor(() => expect(screen.getByText('A')).toBeInTheDocument())

    const selects = screen.getAllByRole('combobox')
    fireEvent.change(selects[1], { target: { value: 'critical' } })
    fireEvent.change(selects[1], { target: { value: 'low' } })
    fireEvent.change(selects[1], { target: { value: 'medium' } })
    expect(screen.getByText(/no incidents match this filter/i)).toBeInTheDocument()
  })

  it('disables CSV export when the visible list is empty', async () => {
    render(<Incidents />)
    await waitFor(() => expect(screen.getByText('A')).toBeInTheDocument())
    const selects = screen.getAllByRole('combobox')
    fireEvent.change(selects[1], { target: { value: 'medium' } })
    expect(screen.getByText(/export csv/i)).toBeDisabled()
  })
})
