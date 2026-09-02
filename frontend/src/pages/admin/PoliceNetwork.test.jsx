import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, fireEvent, waitFor } from '@testing-library/react'
import MockAdapter from 'axios-mock-adapter'
import api from '../../api'
import PoliceNetwork from './PoliceNetwork'

// react-leaflet's Polygon/Polyline layers need a real SVG renderer that jsdom
// doesn't provide (same class of gap as canvas) -- every other map-using
// page in this repo is untested for exactly that reason. This page's own
// logic (KPIs, cards, modals, the activity feed) doesn't depend on Leaflet
// actually painting, so it's swapped for inert stand-ins here only.
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }) => <div>{children}</div>,
  TileLayer: () => null,
  Marker: ({ children }) => <div>{children}</div>,
  Popup: ({ children }) => <div>{children}</div>,
  Polygon: () => null,
  Polyline: () => null,
  useMap: () => ({ flyTo: () => {}, getZoom: () => 13 }),
}))

const mock = new MockAdapter(api)

beforeEach(() => mock.reset())

const dashboardBody = {
  generated_at: '2026-01-01T00:00:00',
  stations: [
    {
      id: 1, name: 'Market PS', phone: '100', contact_officer: 'Inspector Nair',
      lat: 26.16, lng: 91.75, zone_id: 2, zone_name: 'Old Market High-Risk Zone',
      open_incidents: 1, critical_incidents: 1, incident_ids: [7],
    },
    {
      id: 2, name: 'City Central PS', phone: '100', contact_officer: 'Inspector Baruah',
      lat: 26.145, lng: 91.737, zone_id: 4, zone_name: 'City Center Safe Zone',
      open_incidents: 0, critical_incidents: 0, incident_ids: [],
    },
  ],
  unassigned_incidents: [],
  total_open_incidents: 1,
}

const stationsBody = [
  { id: 1, name: 'Market PS', zone_id: 2, phone: '100', contact_officer: 'Inspector Nair', lat: 26.16, lng: 91.75 },
  { id: 2, name: 'City Central PS', zone_id: 4, phone: '100', contact_officer: 'Inspector Baruah', lat: 26.145, lng: 91.737 },
]

const zonesBody = [
  { id: 2, name: 'Old Market High-Risk Zone', risk_level: 'high', polygon: [[26.157, 91.742], [26.157, 91.758], [26.163, 91.758], [26.163, 91.742]], crime_index: 70, description: '', source: 'manual' },
  { id: 4, name: 'City Center Safe Zone', risk_level: 'low', polygon: [[26.139, 91.730], [26.139, 91.744], [26.151, 91.744], [26.151, 91.730]], crime_index: 15, description: '', source: 'manual' },
]

function mockBaseEndpoints() {
  mock.onGet('/police-network/dashboard').reply(200, dashboardBody)
  mock.onGet('/police-network/stations').reply(200, stationsBody)
  mock.onGet('/zones').reply(200, zonesBody)
  mock.onGet('/zones/crowd-density').reply(200, [
    { zone_id: 2, zone: 'Old Market High-Risk Zone', tourist_count: 5, density: 'low', overcrowded: false },
  ])
  mock.onGet('/police-units').reply(200, [])
  mock.onGet('/tourists').reply(200, [])
  mock.onGet(/\/police-network\/cameras\/nearby.*/).reply(200, [
    { id: 9, label: 'Old Market Main Gate Cam 1', zone_id: 2, lat: 26.16, lng: 91.75, status: 'active', distance_m: 12 },
  ])
}

describe('PoliceNetwork page', () => {
  it('renders the network status header, KPIs, and station cards', async () => {
    mockBaseEndpoints()
    const { findByText, findAllByText, findByRole } = render(<PoliceNetwork />)
    await findByRole('heading', { name: 'Central Safety Dashboard' })
    await findByText('NETWORK OPERATIONAL')
    expect((await findAllByText('Market PS')).length).toBeGreaterThan(0)
    expect((await findAllByText('City Central PS')).length).toBeGreaterThan(0)
  })

  it('shows the zone coverage table with real risk/tourist/camera data', async () => {
    mockBaseEndpoints()
    const { findByText } = render(<PoliceNetwork />)
    await findByText('Zone Coverage & Assignment')
    await findByText('Old Market High-Risk Zone')
  })

  it('shows the nearby CCTV grid from real camera data', async () => {
    mockBaseEndpoints()
    const { findByText } = render(<PoliceNetwork />)
    await findByText(/CAM-009/)
  })

  it('opens the station detail modal and forwards an incident', async () => {
    mockBaseEndpoints()
    mock.onPost('/police-network/incidents/7/forward').reply(200, {})

    const { findAllByText, findByText } = render(<PoliceNetwork />)
    const viewButtons = await findAllByText('View Station')
    fireEvent.click(viewButtons[0])

    await findByText('Station Commander')
    const select = await findByText('Forward to…')
    fireEvent.change(select.closest('select'), { target: { value: '2' } })
    fireEvent.click(await findByText('Send'))

    await waitFor(() => {
      expect(mock.history.post.some((r) => r.url === '/police-network/incidents/7/forward')).toBe(true)
    })
  })

  it('opens the contact modal for a station', async () => {
    mockBaseEndpoints()
    const { findAllByText, findByText } = render(<PoliceNetwork />)
    const contactButtons = await findAllByText('Contact')
    fireEvent.click(contactButtons[0])
    await findByText('Connecting…')
    await findByText('🟢 Connected')
  })

  it('runs the simulate-incident demo flow', async () => {
    mockBaseEndpoints()
    const { findByText } = render(<PoliceNetwork />)
    fireEvent.click(await findByText('🚨 Simulate Incident'))
    await findByText('ACTIVE RESPONSE IN PROGRESS')
    await findByText(/Tourist SOS raised/)
    await findByText('Mark Resolved', {}, { timeout: 6000 })
  })
})
