import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { Context } from '@deepseek-ai/cordis'
import * as manager from '@anht3889/dsh-web-search-bundle/manager'

const packArguments = ['pack', '--dry-run', '--json']
const packedManagerFiles = [
  'lib/manager/catalog.js',
  'lib/manager/engines/brave.js',
  'lib/manager/engines/searxng.js',
  'lib/manager/engines/tavily.js',
  'lib/manager/http-api.js',
  'lib/manager/http.js',
  'lib/manager/index.js',
  'lib/manager/provider.js',
  'lib/manager/runtime.js',
  'lib/manager/secrets.js',
  'lib/manager/types.js',
]
const packedDeclarationFiles = [
  'lib/types/client/WebSearchSection.d.ts',
  'lib/types/client/api.d.ts',
  'lib/types/client/index.d.ts',
  'lib/types/client/locales.d.ts',
  'lib/types/client/store.d.ts',
  'lib/types/index.d.ts',
  'lib/types/invariant.d.ts',
  'lib/types/manager/catalog.d.ts',
  'lib/types/manager/engines/brave.d.ts',
  'lib/types/manager/engines/searxng.d.ts',
  'lib/types/manager/engines/tavily.d.ts',
  'lib/types/manager/http-api.d.ts',
  'lib/types/manager/http.d.ts',
  'lib/types/manager/index.d.ts',
  'lib/types/manager/provider.d.ts',
  'lib/types/manager/runtime.d.ts',
  'lib/types/manager/secrets.d.ts',
  'lib/types/manager/types.d.ts',
].sort()
const requiredFiles = [
  'LICENSE',
  'README.md',
  'cordis.patch.yml',
  'lib/client.js',
  'lib/client.js.map',
  'lib/index.js',
  'lib/invariant.js',
  'package.json',
  ...packedManagerFiles,
  ...packedDeclarationFiles,
]
const allowedTopLevelFiles = new Set([
  'LICENSE',
  'README.md',
  'cordis.patch.yml',
  'lib/client.js',
  'lib/client.js.map',
  'lib/index.js',
  'lib/invariant.js',
  'package.json',
  ...packedManagerFiles,
])

assert.equal(typeof manager.apply, 'function')
assert.deepEqual(manager.inject, ['web'])
assert.equal(manager.name, 'dsh-web-search')

const root = await mkdtemp(join(tmpdir(), 'dsh-web-search-pack-smoke-'))
const providers = new Map()
const ctx = new Context()
const disposeWeb = ctx.provide('web', {
  registerSearchProvider(provider) {
    providers.set(provider.id, provider)
    return () => providers.delete(provider.id)
  },
})

try {
  const fiber = await ctx.plugin(manager, {
    catalogPath: join(root, 'config.json'),
    secretsPath: join(root, 'secrets.yaml'),
  })
  assert.equal(providers.has('dsh-web-search'), true)
  await fiber.dispose()
  assert.equal(providers.size, 0)
} finally {
  await disposeWeb()
  await rm(root, { recursive: true, force: true })
}

const packOptions = {
  cwd: new URL('..', import.meta.url),
  encoding: 'utf8',
}
const packed = process.env.npm_execpath
  ? spawnSync(process.execPath, [process.env.npm_execpath, ...packArguments], packOptions)
  : spawnSync('pnpm', packArguments, {
      ...packOptions,
      shell: process.platform === 'win32',
    })
assert.equal(packed.status, 0, packed.stderr || packed.stdout)

const result = JSON.parse(packed.stdout)
const manifest = Array.isArray(result) ? result[0] : result
const files = manifest.files.map((file) => file.path).sort()

for (const required of requiredFiles) {
  assert.ok(files.includes(required), `packed bundle is missing ${required}`)
}

assert.deepEqual(
  files.filter((file) => file.startsWith('lib/manager/')),
  packedManagerFiles,
  'packed manager files differ from the intended JavaScript surface',
)
assert.deepEqual(
  files.filter((file) => file.startsWith('lib/types/')),
  packedDeclarationFiles,
  'packed declarations differ from the expected source export surface',
)
assert.equal(
  files.every((file) => allowedTopLevelFiles.has(file) || packedDeclarationFiles.includes(file)),
  true,
  'packed bundle contains files outside the intended runtime and declaration surface',
)
assert.equal(files.some((file) => file.endsWith('.tsbuildinfo')), false)
assert.equal(files.some((file) => file.includes('/src/')), false)

console.log(files.join('\n'))
