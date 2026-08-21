import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import {
  EMPTY_CATALOG,
  loadCatalog,
  saveCatalog,
  type WebSearchCatalog,
} from '../../src/manager/catalog.ts'

test('missing file loads as empty catalog', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'dsh-ws-')), 'missing.json')
  expect(await loadCatalog(path)).toEqual(EMPTY_CATALOG)
})

test('round-trips a valid catalog without writing secrets', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'dsh-ws-')), 'config.json')
  const catalog = {
    engine: 'tavily' as const,
    engines: { tavily: { baseURL: 'https://api.tavily.com' } },
  }
  await saveCatalog(path, catalog)
  expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(catalog)
  expect(await loadCatalog(path)).toEqual(catalog)
})

test('rejects secret-like top-level fields instead of persisting them', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'dsh-ws-')), 'config.json')
  await expect(saveCatalog(path, {
    engine: 'tavily',
    engines: { tavily: { baseURL: 'https://api.tavily.com' } },
    TAVILY_API_KEY: 'sk-test',
  } as unknown as WebSearchCatalog)).rejects.toThrow(/key/i)
})

test('rejects secret-like engine endpoint fields instead of persisting them', async () => {
  await expect(saveCatalog('/tmp/unused.json', {
    engine: 'tavily',
    engines: { tavily: { baseURL: 'https://api.tavily.com', apiKey: 'sk-test' } },
  } as unknown as WebSearchCatalog)).rejects.toThrow(/key/i)
})

test('rejects unknown engine ids under engines', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'dsh-ws-')), 'config.json')
  await writeFile(path, JSON.stringify({
    engine: null,
    engines: { bing: { baseURL: 'https://api.bing.com' } },
  }))
  await expect(loadCatalog(path)).rejects.toThrow(/invalid/i)
})

test('rejects null engine endpoint entries', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'dsh-ws-')), 'config.json')
  await writeFile(path, JSON.stringify({ engine: null, engines: { tavily: null } }))
  await expect(loadCatalog(path)).rejects.toThrow(/invalid/i)
})

test('rejects array engine endpoint entries', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'dsh-ws-')), 'config.json')
  await writeFile(path, JSON.stringify({ engine: null, engines: { brave: [] } }))
  await expect(loadCatalog(path)).rejects.toThrow(/invalid/i)
})

test('refuses an unknown engine', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'dsh-ws-')), 'config.json')
  await writeFile(path, JSON.stringify({ engine: 'bing', engines: {} }))
  await expect(loadCatalog(path)).rejects.toThrow(/invalid/i)
})

test('refuses missing SearXNG URL when that engine is selected', async () => {
  await expect(saveCatalog('/tmp/unused.json', {
    engine: 'searxng',
    engines: {},
  })).rejects.toThrow(/url/i)
})

test('refuses an unparseable SearXNG URL when that engine is selected', async () => {
  await expect(saveCatalog('/tmp/unused.json', {
    engine: 'searxng',
    engines: { searxng: { baseURL: 'not-a-url' } },
  })).rejects.toThrow(/url/i)
})

test('refuses invalid Tavily baseURL', async () => {
  await expect(saveCatalog('/tmp/unused.json', {
    engine: 'tavily',
    engines: { tavily: { baseURL: 'not-a-url' } },
  })).rejects.toThrow(/url/i)
})

test('refuses invalid Brave baseURL', async () => {
  await expect(saveCatalog('/tmp/unused.json', {
    engine: 'brave',
    engines: { brave: { baseURL: 'not-a-url' } },
  })).rejects.toThrow(/url/i)
})

test('load validation errors include the catalog path', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'dsh-ws-')), 'config.json')
  await writeFile(path, JSON.stringify({ engine: 'bing', engines: {} }))
  await expect(loadCatalog(path)).rejects.toThrow(path)
})

test('save leaves no temporary file after success', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-ws-'))
  const path = join(dir, 'config.json')
  await saveCatalog(path, {
    engine: 'tavily',
    engines: { tavily: { baseURL: 'https://api.tavily.com' } },
  })
  await expect(readdir(dir)).resolves.toEqual(['config.json'])
})
