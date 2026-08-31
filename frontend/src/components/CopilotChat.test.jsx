import { describe, it, expect, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import MockAdapter from 'axios-mock-adapter'
import api from '../api'
import CopilotChat from './CopilotChat'

const mock = new MockAdapter(api)

beforeEach(() => mock.reset())

describe('CopilotChat', () => {
  it('is closed by default', () => {
    const { queryByPlaceholderText } = render(<CopilotChat endpoint="/copilot/ask" />)
    expect(queryByPlaceholderText(/Ask a question/)).not.toBeInTheDocument()
  })

  it('opens and shows suggestion chips', () => {
    const { getByText } = render(<CopilotChat endpoint="/copilot/ask" suggestions={['How many alerts?']} />)
    fireEvent.click(getByText('🤖'))
    expect(getByText('How many alerts?')).toBeInTheDocument()
  })

  it('clicking a suggestion sends it and shows the answer', async () => {
    mock.onPost('/copilot/ask').reply(200, { answer: 'There are 3 active alerts.', handled: true })
    const { getByText, findByText } = render(<CopilotChat endpoint="/copilot/ask" suggestions={['How many alerts?']} />)
    fireEvent.click(getByText('🤖'))
    fireEvent.click(getByText('How many alerts?'))
    await findByText('There are 3 active alerts.')
  })

  it('typing and submitting a question works', async () => {
    mock.onPost('/copilot/ask').reply(200, { answer: 'Answer text.', handled: true })
    const { getByText, getByPlaceholderText, findByText } = render(<CopilotChat endpoint="/copilot/ask" />)
    fireEvent.click(getByText('🤖'))
    fireEvent.change(getByPlaceholderText(/Ask a question/), { target: { value: 'hello?' } })
    fireEvent.submit(getByPlaceholderText(/Ask a question/).closest('form'))
    await findByText('hello?')
    await findByText('Answer text.')
  })

  it('shows a fallback message on request failure', async () => {
    mock.onPost('/copilot/ask').reply(500)
    const { getByText, getByPlaceholderText, findByText } = render(<CopilotChat endpoint="/copilot/ask" />)
    fireEvent.click(getByText('🤖'))
    fireEvent.change(getByPlaceholderText(/Ask a question/), { target: { value: 'hi' } })
    fireEvent.submit(getByPlaceholderText(/Ask a question/).closest('form'))
    await findByText(/could not process/)
  })

  it('closes when the overlay is clicked', () => {
    const { getByText, queryByPlaceholderText } = render(<CopilotChat endpoint="/copilot/ask" />)
    fireEvent.click(getByText('🤖'))
    fireEvent.click(getByText('✕'))
    expect(queryByPlaceholderText(/Ask a question/)).not.toBeInTheDocument()
  })
})
