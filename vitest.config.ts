import { defineConfig } from 'vitest/config'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const source = (path: string): string => fileURLToPath(new URL(path, import.meta.url))
const installed = createRequire(source('./packages/bundle/package.json'))

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@deepseek-ai\/dsh-client-ui-primitives$/, replacement: source('./packages/bundle/tests/support/ui-primitives.ts') },
      { find: /^clsx$/, replacement: installed.resolve('clsx') },
      { find: /^react$/, replacement: installed.resolve('react') },
      { find: /^react\/jsx-runtime$/, replacement: installed.resolve('react/jsx-runtime') },
      { find: /^react\/jsx-dev-runtime$/, replacement: installed.resolve('react/jsx-dev-runtime') },
      { find: /^react-dom$/, replacement: installed.resolve('react-dom') },
      { find: /^react-dom\/client$/, replacement: installed.resolve('react-dom/client') },
    ],
  },
  test: {
    include: ['packages/*/tests/**/*.spec.ts'],
  },
})
