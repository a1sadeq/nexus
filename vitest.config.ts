import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    testTimeout: 30000,
    hookTimeout: 30000,
    retry: 3,
    maxWorkers: 1,
    minWorkers: 1,
  },
})
