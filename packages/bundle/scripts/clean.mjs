import { rm } from 'node:fs/promises'

await Promise.all([
  'lib',
  '.cache',
  'tsconfig.tsbuildinfo',
  'tsconfig.manager.tsbuildinfo',
].map((path) => rm(new URL(`../${path}`, import.meta.url), { recursive: true, force: true })))
