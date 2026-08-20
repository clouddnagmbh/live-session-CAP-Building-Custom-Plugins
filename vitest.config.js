import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // `describe`/`it`/`expect` as globals — the style used throughout the
    // CAP docs and by `cds.test`.
    globals: true,
    // one CAP server per file, so tests never share a database
    fileParallelism: false,
    testTimeout: 20000
  }
})
