import { describe, it, expect, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import MockAdapter from 'axios-mock-adapter'
import api from '../api'
import DisasterBanner from './DisasterBanner'

const mock = new MockAdapter(api)

beforeEach(() => mock.reset())

describe('DisasterBanner', () => {
  it('renders nothing when there are no active advisories', async () => {
    mock.onGet('/tourists/1/disasters').reply(200, [])
    const { container, findByText } = render(<DisasterBanner touristId={1} />)
    // wait a tick for the fetch to resolve
    await new Promise((r) => setTimeout(r, 10))
    expect(container.firstChild).toBeNull()
  })

  it('shows an active advisory', async () => {
    mock.onGet('/tourists/1/disasters').reply(200, [
      { id: 1, zone_id: 2, hazard_type: 'flood', severity: 'high',
        message: 'Flash flood advisory.', source: 'simulated', active: true,
        issued_at: '2026-01-01T00:00:00', expires_at: null },
    ])
    const { findByText } = render(<DisasterBanner touristId={1} />)
    await findByText(/Flash flood advisory/)
    await findByText(/^flood advisory$/i)
  })
})
