/**
 * Live catalog and secret state for the web-search manager.
 * @module @anht3889/dsh-web-search-bundle/manager/runtime
 */

import { loadCatalog, saveCatalog } from './catalog.ts'
import { MultiEngineSearchProvider } from './provider.ts'
import {
  BRAVE_API_KEY_REF,
  TAVILY_API_KEY_REF,
  createSecretStore,
  type CredentialsAccessor,
  type SecretDescription,
  type SecretRef,
  type SecretStore,
} from './secrets.ts'
import type { WebSearchCatalog } from './types.ts'

/** Value-free configuration state for every supported API key. */
export type SecretDescriptions = Record<SecretRef, SecretDescription>

type CatalogPersistence = (path: string, catalog: WebSearchCatalog) => Promise<void>

/** Construction inputs for the managed web-search runtime. */
export interface WebSearchRuntimeOptions {
  /** Durable catalog file path. */
  catalogPath: string
  /** Private fallback secret file path. */
  secretsPath: string
  /**
   * Reads the harness credential service on every secret operation, so a
   * credential service mounted or removed after this runtime was created is
   * used, or abandoned, without reloading the manager.
   */
  credentials?: CredentialsAccessor
  /** Process environment accessor used after credential and file lookup. */
  env?: () => NodeJS.Dict<string>
  /** @internal Deterministic persistence seam for runtime tests. */
  persistCatalogForTest?: CatalogPersistence
}

/** Owns live web-search configuration and one stable provider instance. */
export class WebSearchRuntime {
  readonly #catalogPath: string
  readonly #persistCatalog: CatalogPersistence
  readonly #mutateCatalog = createMutationQueue()
  readonly #secretStore: SecretStore
  readonly #provider: MultiEngineSearchProvider
  #catalog: WebSearchCatalog

  private constructor(
    catalogPath: string,
    catalog: WebSearchCatalog,
    secretStore: SecretStore,
    persistCatalog: CatalogPersistence,
  ) {
    this.#catalogPath = catalogPath
    this.#catalog = catalog
    this.#secretStore = secretStore
    this.#persistCatalog = persistCatalog
    this.#provider = new MultiEngineSearchProvider({
      catalog: () => this.#catalog,
      resolveKey: async ref => await this.#secretStore.get(ref),
    })
  }

  /**
   * Loads durable state and constructs a runtime.
   *
   * @param options - Catalog, secret, credential, and environment inputs.
   * @returns A runtime backed by the loaded catalog.
   */
  static async create(options: WebSearchRuntimeOptions): Promise<WebSearchRuntime> {
    const catalog = await loadCatalog(options.catalogPath)
    const secretStore = createSecretStore({
      credentials: options.credentials,
      filePath: options.secretsPath,
      env: options.env ?? (() => process.env),
    })
    return new WebSearchRuntime(
      options.catalogPath,
      catalog,
      secretStore,
      options.persistCatalogForTest ?? saveCatalog,
    )
  }

  /** @returns The current in-memory catalog. */
  getCatalog(): WebSearchCatalog {
    return this.#catalog
  }

  /**
   * Persists and then publishes a replacement catalog.
   *
   * @param catalog - Validated catalog candidate.
   * @returns The catalog after durable persistence succeeds.
   */
  async putCatalog(catalog: WebSearchCatalog): Promise<WebSearchCatalog> {
    return await this.#mutateCatalog(async () => {
      await this.#persistCatalog(this.#catalogPath, catalog)
      this.#catalog = catalog
      return this.#catalog
    })
  }

  /** @returns Configured flags for every supported secret. */
  async describeSecrets(): Promise<SecretDescriptions> {
    const [tavily, brave] = await Promise.all([
      this.#secretStore.describe(TAVILY_API_KEY_REF),
      this.#secretStore.describe(BRAVE_API_KEY_REF),
    ])
    return {
      [TAVILY_API_KEY_REF]: tavily,
      [BRAVE_API_KEY_REF]: brave,
    }
  }

  /**
   * Stores provided non-empty secret values, leaving omitted values unchanged.
   *
   * @param partial - Supported secret values to update.
   */
  async putSecrets(partial: Partial<Record<SecretRef, string>>): Promise<void> {
    await Promise.all([
      setWhenPresent(this.#secretStore, TAVILY_API_KEY_REF, partial[TAVILY_API_KEY_REF]),
      setWhenPresent(this.#secretStore, BRAVE_API_KEY_REF, partial[BRAVE_API_KEY_REF]),
    ])
  }

  /** @returns The stable provider backed by live runtime state. */
  provider(): MultiEngineSearchProvider {
    return this.#provider
  }
}

async function setWhenPresent(store: SecretStore, ref: SecretRef, value: string | undefined): Promise<void> {
  if (value === undefined || value.length === 0) return
  await store.set(ref, value)
}

function createMutationQueue(): <T>(operation: () => Promise<T>) => Promise<T> {
  let tail = Promise.resolve()
  return async <T>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation, operation)
    tail = result.then(() => undefined, () => undefined)
    return await result
  }
}
