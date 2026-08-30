import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Unmount anything a test rendered, so cases cannot leak DOM into each other.
afterEach(() => {
  cleanup()
  localStorage.clear()
})
