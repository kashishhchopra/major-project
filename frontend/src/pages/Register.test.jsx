import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Register from './Register.jsx'

vi.mock('../api', () => ({ default: { post: vi.fn() } }))
vi.mock('../auth.jsx', () => ({ useAuth: () => ({ login: vi.fn() }) }))
import api from '../api'

const renderPage = () => render(<MemoryRouter><Register /></MemoryRouter>)

beforeEach(() => vi.resetAllMocks())

function fillIdentityAndAdvance(documentType = 'aadhaar') {
  fireEvent.change(screen.getByPlaceholderText('Enter Full Name'), { target: { value: 'Aarav Sharma' } })
  fireEvent.change(screen.getByLabelText(/Select Verification Method/i), { target: { value: documentType } })
  fireEvent.click(screen.getByText('Next'))
}

describe('Register', () => {
  it('starts on the Identity step', () => {
    renderPage()
    expect(screen.getByText(/Step 1 of/)).toBeInTheDocument()
    expect(screen.getByText(/— Identity/)).toBeInTheDocument()
  })

  it('an aadhaar registration never shows a Visa & Travel step', () => {
    renderPage()
    fillIdentityAndAdvance('aadhaar')
    // Document step
    expect(screen.getByText(/— Document/)).toBeInTheDocument()
    expect(screen.queryByText('Visa & Travel')).not.toBeInTheDocument()
  })

  it('a passport registration inserts the Visa & Travel step after Document', () => {
    renderPage()
    fillIdentityAndAdvance('passport')
    expect(screen.getByText(/— Document/)).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Enter document number'), { target: { value: 'TK1234567' } })
    fireEvent.change(screen.getByPlaceholderText('+91-90000-00000'), { target: { value: '+81-90-0000-0000' } })
    fireEvent.change(screen.getByLabelText(/Country of Citizenship/i), { target: { value: 'JP' } })
    fireEvent.click(screen.getByText('Next'))

    expect(screen.getByText(/— Visa & Travel/)).toBeInTheDocument()
  })

  it('cannot advance past the Visa step without visa type and expiry', () => {
    renderPage()
    fillIdentityAndAdvance('passport')
    fireEvent.change(screen.getByPlaceholderText('Enter document number'), { target: { value: 'TK1234567' } })
    fireEvent.change(screen.getByPlaceholderText('+91-90000-00000'), { target: { value: '+81-90-0000-0000' } })
    fireEvent.change(screen.getByLabelText(/Country of Citizenship/i), { target: { value: 'JP' } })
    fireEvent.click(screen.getByText('Next'))
    expect(screen.getByText(/— Visa & Travel/)).toBeInTheDocument()

    // Visa Type/Expiry carry the `required` HTML attribute, so a browser
    // blocks the click via native constraint validation before this app's
    // own JS validator ever runs -- same pattern as every other required
    // field in this form. Assert we're still on the same step either way.
    fireEvent.click(screen.getByText('Next'))
    expect(screen.getByText(/— Visa & Travel/)).toBeInTheDocument()
  })

  it('sends visa fields in the submission payload for a passport registration', async () => {
    api.post.mockResolvedValue({ data: { digital_id: 'STS-TEST', trip_end: '2026-12-01T00:00:00' } })
    renderPage()
    fillIdentityAndAdvance('passport')

    fireEvent.change(screen.getByPlaceholderText('Enter document number'), { target: { value: 'TK1234567' } })
    fireEvent.change(screen.getByPlaceholderText('+91-90000-00000'), { target: { value: '+81-90-0000-0000' } })
    fireEvent.change(screen.getByLabelText(/Country of Citizenship/i), { target: { value: 'JP' } })
    fireEvent.click(screen.getByText('Next'))

    fireEvent.change(screen.getByLabelText(/Visa Type/i), { target: { value: 'Tourist' } })
    fireEvent.change(screen.getByLabelText(/Visa Expiry/i), { target: { value: '2026-12-31' } })
    fireEvent.click(screen.getByText('Next'))  // -> Trip step

    fireEvent.change(screen.getByLabelText(/Trip Start/i), { target: { value: '2026-11-01T09:00' } })
    fireEvent.change(screen.getByLabelText(/Trip End/i), { target: { value: '2026-11-10T09:00' } })
    fireEvent.click(screen.getByText('Next'))  // -> Emergency Contact
    fireEvent.click(screen.getByText('Next'))  // -> Account
    fireEvent.click(screen.getByText(/Get Your Unique Blockchain ID/))

    expect(api.post).toHaveBeenCalled()
    const [path, payload] = api.post.mock.calls[0]
    expect(path).toBe('/tourists')
    expect(payload.nationality).toBe('Japan')
    expect(payload.visa_type).toBe('Tourist')
    expect(payload.visa_expiry).toContain('2026-12-31')
  })

  it('an aadhaar submission never includes visa fields', async () => {
    api.post.mockResolvedValue({ data: { digital_id: 'STS-TEST', trip_end: '2026-12-01T00:00:00' } })
    renderPage()
    fillIdentityAndAdvance('aadhaar')

    fireEvent.change(screen.getByPlaceholderText('Enter document number'), { target: { value: 'XXXX-1234' } })
    fireEvent.change(screen.getByPlaceholderText('+91-90000-00000'), { target: { value: '+91-90000-00000' } })
    fireEvent.click(screen.getByText('Next'))  // -> Trip

    fireEvent.change(screen.getByLabelText(/Trip Start/i), { target: { value: '2026-11-01T09:00' } })
    fireEvent.change(screen.getByLabelText(/Trip End/i), { target: { value: '2026-11-10T09:00' } })
    fireEvent.click(screen.getByText('Next'))  // -> Emergency
    fireEvent.click(screen.getByText('Next'))  // -> Account
    fireEvent.click(screen.getByText(/Get Your Unique Blockchain ID/))

    const [, payload] = api.post.mock.calls[0]
    expect(payload.visa_type).toBeUndefined()
    expect(payload.visa_expiry).toBeUndefined()
  })
})
