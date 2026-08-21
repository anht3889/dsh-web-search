/**
 * Applies the shipped `cordis.patch.yml` through the Harness patch API.
 *
 * Limitation: mounting the composed entry list needs the `dsh` launcher's
 * profile tree (an installed profile directory, the installation module
 * fallback, and this package's built `lib/`), none of which exist in a clean
 * checkout of this repository. This test therefore covers everything up to
 * mount: the real include YAML dialect parses the shipped file, the real
 * `applyEntryPatches` composes it over a base `web` row, the loader's own
 * `interpolate` evaluates its `!!js` config, and the manager plugin's schema
 * accepts the result. Mounting the built package is covered by
 * `tests/pack-smoke.mjs`, and the plugin lifecycle by `loader.spec.ts`.
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { applyEntryPatches, entryListSchema, type PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { interpolate, isJsExpr } from '@deepseek-ai/cordis-plugin-loader'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import * as yaml from 'js-yaml'
import { expect, test } from 'vitest'
import { Config as ManagerConfig } from '../../src/manager/index.ts'
import { WEB_SEARCH_PROVIDER_ID } from '../../src/manager/provider.ts'

const packageRoot = new URL('../../', import.meta.url)

interface BundleManifest {
  name: string
  exports: Record<string, unknown>
  dsh: { bundle: { patch: string } }
}

async function readManifest(): Promise<BundleManifest> {
  return JSON.parse(await readFile(new URL('package.json', packageRoot), 'utf8')) as BundleManifest
}

async function readShippedPatches(): Promise<PatchOptions[]> {
  const manifest = await readManifest()
  const content = await readFile(new URL(manifest.dsh.bundle.patch, packageRoot), 'utf8')
  const parsed = yaml.load(content, { schema: entryListSchema })
  expect(Array.isArray(parsed)).toBe(true)
  for (const entry of parsed as unknown[]) {
    expect(typeof entry === 'object' && entry !== null && !Array.isArray(entry)).toBe(true)
  }
  return parsed as PatchOptions[]
}

/** Composes the shipped patch over a base tree pinned at the in-box provider. */
async function compose(warnings: string[] = []): Promise<EntryOptions[]> {
  const base: EntryOptions[] = [{
    id: 'web',
    name: '@deepseek-ai/dsh-web',
    config: { searchProvider: 'deepseek-official' },
  }]
  const composed = applyEntryPatches(
    base,
    structuredClone(await readShippedPatches()),
    (message: string, ...args: unknown[]) => {
      let index = 0
      warnings.push(message.replace(/%C/g, () => JSON.stringify(args[index++])))
    },
  )
  expect(warnings).toEqual([])
  return composed
}

test('the shipped patch repins the web row at this package provider id', async () => {
  const composed = await compose()

  expect(composed.find(entry => entry.id === 'web')?.config)
    .toEqual({ searchProvider: WEB_SEARCH_PROVIDER_ID })
})

test('every inserted entry name resolves against this package exports', async () => {
  const manifest = await readManifest()

  const inserted = (await compose()).filter(entry => entry.id !== 'web')

  expect(inserted.length).toBeGreaterThan(0)
  for (const entry of inserted) {
    expect(entry.name.startsWith(manifest.name)).toBe(true)
    const subpath = entry.name === manifest.name ? '.' : `.${entry.name.slice(manifest.name.length)}`
    const declared = manifest.exports[subpath] as { default?: string } | undefined
    expect(declared?.default, `${entry.name} is not a declared export`).toMatch(/^\.\/lib\/.+\.js$/)
    const source = declared!.default!.replace(/^\.\/lib\//, 'src/').replace(/\.js$/, '.ts')
    await expect(readFile(new URL(source, packageRoot), 'utf8')).resolves.toContain('export')
  }
})

test('the inserted manager entry keeps loader-evaluable !!js storage paths', async () => {
  const manager = (await compose()).find(entry => entry.name.endsWith('/manager'))
  const config = manager?.config as Record<string, unknown>

  expect(isJsExpr(config.catalogPath)).toBe(true)
  expect(isJsExpr(config.secretsPath)).toBe(true)

  const evaluated = interpolate({ dshHomePath }, config) as Record<string, string>

  expect(evaluated.catalogPath).toBe(dshHomePath('web-search', 'config.json'))
  expect(evaluated.secretsPath).toBe(dshHomePath('web-search', 'secrets.yaml'))
  expect(ManagerConfig(evaluated)).toEqual(evaluated)
})

test('the shipped patch file is the one the bundle manifest declares', async () => {
  const manifest = await readManifest()

  expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
  expect(fileURLToPath(new URL(manifest.dsh.bundle.patch, packageRoot)))
    .toBe(fileURLToPath(new URL('cordis.patch.yml', packageRoot)))
  expect(manifest.exports['./cordis.patch.yml']).toBe('./cordis.patch.yml')
})
