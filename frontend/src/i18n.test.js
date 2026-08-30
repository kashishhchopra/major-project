import { describe, it, expect } from 'vitest'
import en from './locales/en.json'
import hi from './locales/hi.json'
import as_ from './locales/as.json'
import bn from './locales/bn.json'
import ta from './locales/ta.json'
import te from './locales/te.json'
import mr from './locales/mr.json'
import gu from './locales/gu.json'
import kn from './locales/kn.json'
import ml from './locales/ml.json'
import pa from './locales/pa.json'

// Every locale must define exactly the same key paths as the English source.
// A missing key doesn't error at runtime -- i18next just falls back silently
// to English (or the raw key), so the gap would only surface as a user in
// that language quietly seeing the wrong copy. This test catches it at build
// time instead.
function keyPaths(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k
    return typeof v === 'object' && v !== null ? keyPaths(v, path) : [path]
  })
}

const LOCALES = { hi, as: as_, bn, ta, te, mr, gu, kn, ml, pa }
const englishKeys = new Set(keyPaths(en))

describe('locale key parity', () => {
  it('the English source has the expected key count (sanity check)', () => {
    expect(englishKeys.size).toBeGreaterThan(20)
  })

  it.each(Object.entries(LOCALES))('%s defines exactly the English key set', (_code, locale) => {
    const keys = new Set(keyPaths(locale))
    const missing = [...englishKeys].filter((k) => !keys.has(k))
    const extra = [...keys].filter((k) => !englishKeys.has(k))
    expect({ missing, extra }).toEqual({ missing: [], extra: [] })
  })

  it.each(Object.entries(LOCALES))('%s has no empty translation values', (_code, locale) => {
    const empty = keyPaths(locale).filter((path) => {
      const value = path.split('.').reduce((o, k) => o?.[k], locale)
      return typeof value !== 'string' || value.trim() === ''
    })
    expect(empty).toEqual([])
  })

  it.each(Object.entries(LOCALES))('%s preserves every {{placeholder}} the English string uses', (_code, locale) => {
    const placeholderRe = /\{\{(\w+)\}\}/g
    const mismatches = []
    for (const path of englishKeys) {
      const enValue = path.split('.').reduce((o, k) => o?.[k], en)
      const locValue = path.split('.').reduce((o, k) => o?.[k], locale)
      if (typeof enValue !== 'string' || typeof locValue !== 'string') continue
      const enPlaceholders = [...enValue.matchAll(placeholderRe)].map((m) => m[1]).sort()
      const locPlaceholders = [...locValue.matchAll(placeholderRe)].map((m) => m[1]).sort()
      if (JSON.stringify(enPlaceholders) !== JSON.stringify(locPlaceholders)) {
        mismatches.push({ path, enPlaceholders, locPlaceholders })
      }
    }
    expect(mismatches).toEqual([])
  })
})
