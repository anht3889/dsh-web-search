import type {
  SearchEngineId,
  WebSearchApi,
  WebSearchCatalog,
  WebSearchConfigView,
  WebSearchSecretDescriptions,
  WebSearchSecretRef,
} from './api.ts'

/** Editable values retained independently from section component lifetime. */
export interface WebSearchDrafts {
  engine: SearchEngineId | null
  tavilyKey: string
  braveKey: string
  tavilyBase: string
  braveBase: string
  searxngBase: string
}

/** State rendered by the web-search Settings section. */
export interface WebSearchSnapshot {
  catalog: WebSearchCatalog
  secrets: WebSearchSecretDescriptions
  available: boolean
  drafts: WebSearchDrafts
  dirty: boolean
  saving: boolean
  error?: string
}

const EMPTY_VIEW: WebSearchConfigView = {
  catalog: { engine: null, engines: {} },
  available: false,
  secrets: {
    TAVILY_API_KEY: { configured: false },
    BRAVE_API_KEY: { configured: false },
  },
}

const stores = new WeakMap<WebSearchApi, WebSearchStore>()

/**
 * Returns the API-scoped store whose drafts survive section remounts.
 * @param api - Stable client injected by the browser plugin.
 * @returns the retained store for that client.
 */
export function webSearchStoreFor(api: WebSearchApi): WebSearchStore {
  const existing = stores.get(api)
  if (existing !== undefined) return existing
  const store = new WebSearchStore(api)
  stores.set(api, store)
  return store
}

/** Retains web-search server state and unsaved form drafts. */
export class WebSearchStore {
  private loaded = EMPTY_VIEW
  private state: WebSearchSnapshot = snapshotFrom(EMPTY_VIEW)
  private listeners = new Set<() => void>()
  private loadGeneration = 0
  private appliedLoadGeneration = 0
  private draftRevision = 0
  private activeSaves = 0
  private saveTail: Promise<void> = Promise.resolve()

  /**
   * @param api - HTTP client for the local management API.
   */
  constructor(private readonly api: WebSearchApi) {}

  /** @returns the current immutable render snapshot. */
  getSnapshot = (): WebSearchSnapshot => this.state

  /**
   * @param listener - observer notified after state changes.
   * @returns a disposer.
   */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Loads the latest server view without replacing dirty drafts. */
  async load(): Promise<void> {
    const saveBarrier = this.saveTail
    await saveBarrier
    const generation = ++this.loadGeneration
    try {
      const view = await this.api.getConfig()
      if (this.activeSaves > 0) {
        await this.saveTail
        return await this.load()
      }
      this.applyLoaded(generation, view, {
        drafts: this.state.dirty ? this.state.drafts : draftsFrom(view.catalog),
        dirty: this.state.dirty,
      })
    } catch (error: unknown) {
      if (generation < this.appliedLoadGeneration) return
      this.publish({ ...this.state, error: message(error) })
    }
  }

  /**
   * Updates one draft field.
   * @param patch - changed draft values.
   */
  update(patch: Partial<WebSearchDrafts>): void {
    this.draftRevision += 1
    this.publish({
      ...clearError(this.state),
      drafts: { ...this.state.drafts, ...patch },
      dirty: true,
    })
  }

  /** Restores the latest loaded catalog and clears all typed keys. */
  discard(): void {
    if (this.state.saving) return
    this.draftRevision += 1
    this.publish({ ...snapshotFrom(this.loaded), saving: this.state.saving })
  }

  /** Saves the catalog, then any non-empty typed keys, and refreshes server state. */
  save(): Promise<void> {
    const capture = {
      drafts: this.state.drafts,
      revision: this.draftRevision,
    }
    this.activeSaves += 1
    this.publish({ ...clearError(this.state), saving: true })

    const workflow = this.saveTail.then(async () => {
      await this.runSave(capture)
    })
    const completed = workflow.finally(() => {
      this.activeSaves -= 1
      this.publish({ ...this.state, saving: this.activeSaves > 0 })
    })
    this.saveTail = completed.then(() => undefined, () => undefined)
    return completed
  }

  private async runSave(capture: { drafts: WebSearchDrafts; revision: number }): Promise<void> {
    const catalog = catalogFrom(capture.drafts)
    const secrets = secretsFrom(capture.drafts)
    try {
      await this.api.putConfig(catalog)
    } catch (error: unknown) {
      this.publish({ ...this.state, error: message(error) })
      return
    }

    let secretError: unknown
    if (Object.keys(secrets).length > 0) {
      try {
        await this.api.putSecrets(secrets)
      } catch (error: unknown) {
        secretError = error
      }
    }

    let refreshed: WebSearchConfigView
    const generation = ++this.loadGeneration
    try {
      refreshed = await this.api.getConfig()
    } catch (error: unknown) {
      const prefix = secretError === undefined ? 'Saved, but refresh failed' : `Catalog saved, but secret update failed: ${message(secretError)}. Refresh failed`
      this.publish({ ...this.state, error: `${prefix}: ${message(error)}` })
      return
    }
    if (generation < this.appliedLoadGeneration) return

    const changedAfterCapture = this.draftRevision !== capture.revision
    const refreshedDrafts = draftsFrom(refreshed.catalog)
    const drafts = changedAfterCapture
      ? this.state.drafts
      : secretError === undefined
        ? refreshedDrafts
        : {
            ...refreshedDrafts,
            tavilyKey: capture.drafts.tavilyKey,
            braveKey: capture.drafts.braveKey,
          }
    this.applyLoaded(generation, refreshed, {
      drafts,
      dirty: changedAfterCapture ? this.state.dirty : secretError !== undefined,
      ...(secretError === undefined
        ? {}
        : { error: `Catalog saved, but secret update failed: ${message(secretError)}` }),
    })
  }

  private applyLoaded(
    generation: number,
    view: WebSearchConfigView,
    draftState: Pick<WebSearchSnapshot, 'drafts' | 'dirty'> & { error?: string },
  ): void {
    if (generation < this.appliedLoadGeneration) return
    this.appliedLoadGeneration = generation
    this.loaded = view
    this.publish({
      ...snapshotFrom(view),
      ...draftState,
      saving: this.state.saving,
    })
  }

  private publish(state: WebSearchSnapshot): void {
    this.state = state
    for (const listener of this.listeners) listener()
  }
}

function snapshotFrom(view: WebSearchConfigView): WebSearchSnapshot {
  return {
    catalog: view.catalog,
    secrets: view.secrets,
    available: view.available,
    drafts: draftsFrom(view.catalog),
    dirty: false,
    saving: false,
  }
}

function draftsFrom(catalog: WebSearchCatalog): WebSearchDrafts {
  return {
    engine: catalog.engine,
    tavilyKey: '',
    braveKey: '',
    tavilyBase: catalog.engines.tavily?.baseURL ?? '',
    braveBase: catalog.engines.brave?.baseURL ?? '',
    searxngBase: catalog.engines.searxng?.baseURL ?? '',
  }
}

function catalogFrom(drafts: WebSearchDrafts): WebSearchCatalog {
  const engines: WebSearchCatalog['engines'] = {}
  if (drafts.tavilyBase !== '') engines.tavily = { baseURL: drafts.tavilyBase }
  if (drafts.braveBase !== '') engines.brave = { baseURL: drafts.braveBase }
  if (drafts.searxngBase !== '') engines.searxng = { baseURL: drafts.searxngBase }
  return { engine: drafts.engine, engines }
}

function secretsFrom(drafts: WebSearchDrafts): Partial<Record<WebSearchSecretRef, string>> {
  return {
    ...(drafts.tavilyKey === '' ? {} : { TAVILY_API_KEY: drafts.tavilyKey }),
    ...(drafts.braveKey === '' ? {} : { BRAVE_API_KEY: drafts.braveKey }),
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function clearError(state: WebSearchSnapshot): WebSearchSnapshot {
  const next = { ...state }
  delete next.error
  return next
}
