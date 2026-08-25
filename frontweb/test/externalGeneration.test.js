import { describe, it, expect } from 'vitest'
import { externalGenerationAPI } from '@/api/externalGeneration'
describe('external generation API', () => { it('exposes job and session methods', () => { expect(typeof externalGenerationAPI.createJob).toBe('function'); expect(typeof externalGenerationAPI.attachSession).toBe('function') }) })
