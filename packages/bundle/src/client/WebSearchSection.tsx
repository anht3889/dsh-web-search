import { useEffect, useSyncExternalStore } from 'react'
import type { ChangeEvent, FormEvent, ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SearchEngineId, WebSearchApi } from './api.ts'
import type { WebSearchSettingsKey } from './locales.ts'
import { webSearchStoreFor, type WebSearchDrafts, type WebSearchSnapshot } from './store.ts'
import styles from './WebSearchSection.module.css'

/** Secret reference shown for each engine that requires an API key. */
const KEYED_ENGINE_SECRET_REF = {
  tavily: 'TAVILY_API_KEY',
  brave: 'BRAVE_API_KEY',
} as const

/** Props injected into the web-search Settings section. */
export interface WebSearchSectionProps {
  /** API client used to load and save configuration. */
  api: WebSearchApi
  /** Localized product copy. */
  t: (key: WebSearchSettingsKey) => string
}

/** Renders the web-search Settings form. */
export function WebSearchSection({ api, t }: WebSearchSectionProps): ReactNode {
  const store = webSearchStoreFor(api)
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)

  useEffect(() => {
    void store.load()
  }, [store])

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    void store.save()
  }
  const update = (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>): void => {
    const { name, value } = event.target
    if (name === 'engine') {
      store.update({ engine: value === '' ? null : value as SearchEngineId })
      return
    }
    store.update({ [name]: value } as Partial<WebSearchDrafts>)
  }
  const { drafts } = state
  const keyedEngine = drafts.engine === 'tavily' || drafts.engine === 'brave' ? drafts.engine : undefined
  const secretConfigured = keyedEngine === undefined
    ? false
    : state.secrets[KEYED_ENGINE_SECRET_REF[keyedEngine]].configured
  const currentEngine = state.catalog.engine
  const currentEngineLabel = currentEngine === null ? t('statusNone') : engineLabel(currentEngine, t)
  const currentReadiness = readinessLabel(currentEngine, state, t)
  const providerReadiness = t(state.available ? 'statusProviderReady' : 'statusProviderUnavailable')

  return (
    <section className={styles.section}>
      <h2 className={styles.title}>{t('title')}</h2>
      <form className={styles.form} onSubmit={submit}>
        <label>
          {t('engine')}
          <select name="engine" value={drafts.engine ?? ''} onChange={update}>
            <option value="">—</option>
            <option value="tavily">{t('engineTavily')}</option>
            <option value="brave">{t('engineBrave')}</option>
            <option value="searxng">{t('engineSearxng')}</option>
          </select>
        </label>

        {keyedEngine === undefined
          ? null
          : (
              <>
                <label>
                  <span>{`${t('apiKey')} · ${secretConfigured ? t('apiKeyConfigured') : t('apiKeyEmpty')}`}</span>
                  <input
                    name="apiKey"
                    type="password"
                    autoComplete="new-password"
                    value={keyedEngine === 'tavily' ? drafts.tavilyKey : drafts.braveKey}
                    onChange={event => {
                      store.update(keyedEngine === 'tavily'
                        ? { tavilyKey: event.target.value }
                        : { braveKey: event.target.value })
                    }}
                  />
                </label>
                <label>
                  {t('baseUrl')}
                  <input
                    name={keyedEngine === 'tavily' ? 'tavilyBase' : 'braveBase'}
                    type="url"
                    value={keyedEngine === 'tavily' ? drafts.tavilyBase : drafts.braveBase}
                    onChange={update}
                  />
                </label>
              </>
            )}

        {drafts.engine === 'searxng'
          ? (
              <label>
                {t('searxngUrl')}
                <input name="searxngBase" type="url" value={drafts.searxngBase} onChange={update} required />
              </label>
            )
          : null}

        <p className={styles.status}>
          {`${t('statusCurrent')}: ${currentEngineLabel} · ${currentReadiness}`}
          {currentEngine === null
            ? null
            : ` · ${providerReadiness} · ${t(state.available ? 'statusNext' : 'statusFailure')}`}
        </p>
        {state.dirty ? <p className={styles.dirty}>{t('dirty')}</p> : null}
        {state.error === undefined ? null : <p className={styles.error} role="alert">{state.error}</p>}
        <div className={styles.actions}>
          <Button type="button" variant="outline" disabled={!state.dirty || state.saving} onClick={() => { store.discard() }}>
            {t('discard')}
          </Button>
          <Button type="submit" variant="primary" disabled={!state.dirty || state.saving}>
            {t('save')}
          </Button>
        </div>
      </form>
    </section>
  )
}

function engineLabel(engine: SearchEngineId, t: (key: WebSearchSettingsKey) => string): string {
  switch (engine) {
    case 'tavily': return t('engineTavily')
    case 'brave': return t('engineBrave')
    case 'searxng': return t('engineSearxng')
  }
}

function readinessLabel(
  engine: SearchEngineId | null,
  state: WebSearchSnapshot,
  t: (key: WebSearchSettingsKey) => string,
): string {
  switch (engine) {
    case null:
      return t('statusUnavailable')
    case 'tavily':
      return t(state.secrets.TAVILY_API_KEY.configured ? 'statusKeyReady' : 'statusKeyMissing')
    case 'brave':
      return t(state.secrets.BRAVE_API_KEY.configured ? 'statusKeyReady' : 'statusKeyMissing')
    case 'searxng':
      return t(state.catalog.engines.searxng?.baseURL === undefined ? 'statusUrlMissing' : 'statusUrlReady')
  }
}
