/**
 * Durable web-search catalog types shared by the Host manager and the browser
 * Settings section. Type-only for browser consumers; the constants below are
 * Host-side defaults.
 * @module @anht3889/dsh-web-search-bundle/manager/types
 */

/** Identifier of a supported search engine. */
export type SearchEngineId = 'tavily' | 'brave' | 'searxng'

/** Per-engine endpoint overrides; an absent entry uses the engine default. */
export interface EngineEndpoints {
  /** Tavily API base URL override. */
  tavily?: { baseURL?: string }
  /** Brave Search API base URL override. */
  brave?: { baseURL?: string }
  /** Required base URL of the private SearXNG instance. */
  searxng?: { baseURL?: string }
}

/** Durable, non-secret web-search selection stored in the catalog file. */
export interface WebSearchCatalog {
  /** Selected engine, or `null` while no engine is configured. */
  engine: SearchEngineId | null
  /** Endpoint overrides for each engine. */
  engines: EngineEndpoints
}

/** Catalog used before an operator selects an engine. */
export const EMPTY_CATALOG: WebSearchCatalog = { engine: null, engines: {} }

/** Tavily API base URL used when the catalog omits an override. */
export const TAVILY_DEFAULT_BASE_URL = 'https://api.tavily.com'

/** Brave Search API base URL used when the catalog omits an override. */
export const BRAVE_DEFAULT_BASE_URL = 'https://api.search.brave.com'

/** Every supported engine id, in Settings presentation order. */
export const ENGINE_IDS: readonly SearchEngineId[] = ['tavily', 'brave', 'searxng']
