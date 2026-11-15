import { describe, expect, it } from 'vitest'
import { CORE_VERSION } from '@core/index'

describe('core', () => {
  it('expone una versión', () => {
    expect(CORE_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
