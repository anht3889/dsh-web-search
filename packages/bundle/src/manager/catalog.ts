/**
 * Durable web-search catalog storage: load, atomic save, and validation.
 * @module @anht3889/dsh-web-search-bundle/manager/catalog
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import {
  EMPTY_CATALOG,
  ENGINE_IDS,
  type EngineEndpoints,
  type SearchEngineId,
  type WebSearchCatalog,
} from './types.ts'

export { EMPTY_CATALOG } from './types.ts'
export type { SearchEngineId, WebSearchCatalog } from './types.ts'
export {
  BRAVE_DEFAULT_BASE_URL,
  TAVILY_DEFAULT_BASE_URL,
} from './types.ts'

const TOP_LEVEL_KEYS = ['engine', 'engines'] as const
const ENDPOINT_KEYS = ['baseURL'] as const

/**
 * Loads the durable web-search catalog from disk.
 *
 * @param path - catalog file path.
 * @returns the parsed catalog, or {@link EMPTY_CATALOG} when the file is absent.
 * @throws when the file exists but cannot be parsed or validated.
 */
export async function loadCatalog(path: string): Promise<WebSearchCatalog> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error: unknown) {
    if (isMissingFileError(error)) return EMPTY_CATALOG
    throw error
  }

  let catalog: unknown
  try {
    catalog = JSON.parse(raw)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${path} holds invalid JSON: ${message}`)
  }

  try {
    validateCatalog(catalog)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${path} holds an invalid web-search catalog: ${message}`)
  }

  return toPersistedCatalog(catalog)
}

/**
 * Atomically persists a validated web-search catalog.
 *
 * @param path - catalog file path.
 * @param catalog - catalog to store.
 */
export async function saveCatalog(
  path: string,
  catalog: WebSearchCatalog,
): Promise<void> {
  validateCatalog(catalog)
  const persisted = toPersistedCatalog(catalog)

  await mkdir(dirname(path), { recursive: true })

  const temporaryPath = join(
    dirname(path),
    `.${basename(path)}.${randomUUID()}.tmp`,
  )

  try {
    await writeFile(temporaryPath, JSON.stringify(persisted), 'utf8')
    await rename(temporaryPath, path)
  } catch (error: unknown) {
    await rm(temporaryPath, { force: true })
    throw error
  }
}

/**
 * Validates catalog shape and endpoint URLs before load or save.
 *
 * @param catalog - value to validate.
 * @throws when the catalog is invalid.
 */
export function validateCatalog(catalog: unknown): asserts catalog is WebSearchCatalog {
  if (typeof catalog !== 'object' || catalog === null || Array.isArray(catalog)) {
    throw new Error('invalid catalog: expected an object')
  }

  const record = catalog as Record<string, unknown>

  for (const key of Object.keys(record)) {
    if (!TOP_LEVEL_KEYS.includes(key as typeof TOP_LEVEL_KEYS[number])) {
      throw new Error(`invalid catalog key: ${key}`)
    }
  }

  const { engine, engines } = record

  if (engine !== null && (typeof engine !== 'string' || !ENGINE_IDS.includes(engine as SearchEngineId))) {
    throw new Error(`invalid engine: ${String(engine)}`)
  }

  if (typeof engines !== 'object' || engines === null || Array.isArray(engines)) {
    throw new Error('invalid engines: expected an object')
  }

  const engineRecord = engines as Record<string, unknown>

  for (const key of Object.keys(engineRecord)) {
    if (!ENGINE_IDS.includes(key as SearchEngineId)) {
      throw new Error(`invalid engines key: ${key}`)
    }
  }

  for (const engineId of ENGINE_IDS) {
    validateEngineEndpoint(engineRecord[engineId], engineId, engine)
  }
}

/** Validates one engine's endpoint entry, requiring a base URL for a selected SearXNG. */
function validateEngineEndpoint(
  endpoint: unknown,
  engineId: SearchEngineId,
  selectedEngine: unknown,
): void {
  if (endpoint === undefined) {
    if (selectedEngine === engineId && engineId === 'searxng') {
      validateRequiredBaseURL(undefined, engineId)
    }
    return
  }

  if (typeof endpoint !== 'object' || endpoint === null || Array.isArray(endpoint)) {
    throw new Error(`invalid ${engineId} endpoint: expected an object`)
  }

  const endpointRecord = endpoint as Record<string, unknown>

  for (const key of Object.keys(endpointRecord)) {
    if (!ENDPOINT_KEYS.includes(key as typeof ENDPOINT_KEYS[number])) {
      throw new Error(`invalid ${engineId} key: ${key}`)
    }
  }

  const baseURL = endpointRecord.baseURL

  if (selectedEngine === engineId && engineId === 'searxng') {
    validateRequiredBaseURL(baseURL, engineId)
    return
  }

  validateOptionalBaseURL(baseURL, engineId)
}

/** Accepts an absent base URL, otherwise requires an absolute URL. */
function validateOptionalBaseURL(baseURL: unknown, engine: string): void {
  if (baseURL === undefined) return
  if (typeof baseURL !== 'string' || baseURL === '' || !URL.canParse(baseURL)) {
    throw new Error(`invalid ${engine} baseURL: ${String(baseURL)}`)
  }
}

/** Requires an absolute base URL, used for the selected SearXNG instance. */
function validateRequiredBaseURL(baseURL: unknown, engine: string): void {
  if (typeof baseURL !== 'string' || baseURL === '' || !URL.canParse(baseURL)) {
    throw new Error(`${engine} requires a valid baseURL`)
  }
}

/**
 * Returns only durable catalog fields for persistence.
 *
 * @param catalog - validated catalog value.
 * @returns catalog containing only allowed keys.
 */
function toPersistedCatalog(catalog: WebSearchCatalog): WebSearchCatalog {
  const engines: EngineEndpoints = {}

  for (const engineId of ENGINE_IDS) {
    const baseURL = catalog.engines[engineId]?.baseURL
    if (baseURL !== undefined) {
      engines[engineId] = { baseURL }
    }
  }

  return {
    engine: catalog.engine,
    engines,
  }
}

/** Distinguishes an absent catalog file, which loads as {@link EMPTY_CATALOG}. */
function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
