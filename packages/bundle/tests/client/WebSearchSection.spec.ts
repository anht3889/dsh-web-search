// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { WebSearchApi, type WebSearchConfigView } from '../../src/client/api.ts'
import { WebSearchStore } from '../../src/client/store.ts'
import { WebSearchSection } from '../../src/client/WebSearchSection.tsx'
import { zh } from '../../src/client/locales.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount()
  })
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

test('switching engines renders only fields owned by the selected engine', async () => {
  stubApi(view({ engine: null }))
  const { container } = await renderSection(new WebSearchApi())

  await change(select(container), 'searxng')
  expect(field(container, 'searxngBase')).not.toBeNull()
  expect(field(container, 'apiKey')).toBeNull()
  expect(field(container, 'tavilyBase')).toBeNull()

  await change(select(container), 'brave')
  expect(field(container, 'apiKey')).not.toBeNull()
  expect(field(container, 'braveBase')).not.toBeNull()
  expect(field(container, 'searxngBase')).toBeNull()
})

test('drafting SearXNG reports no API key state even when another engine has a key', async () => {
  stubApi(view({
    engine: 'searxng',
    engines: { searxng: { baseURL: 'http://127.0.0.1:8080' } },
    secrets: {
      TAVILY_API_KEY: { configured: false },
      BRAVE_API_KEY: { configured: true },
    },
  }))
  const { container } = await renderSection(new WebSearchApi())

  expect(field(container, 'apiKey')).toBeNull()
  expect(container.textContent).not.toContain(zh.apiKey)
  expect(container.textContent).toContain(zh.statusUrlReady)
})

test('keeps unsaved drafts through a section remount and Discard restores the latest server state', async () => {
  let server = view({
    engine: 'tavily',
    engines: { tavily: { baseURL: 'https://old.example' } },
  })
  stubApi(() => server)
  const api = new WebSearchApi()
  const first = await renderSection(api)

  await change(field(first.container, 'tavilyBase'), 'https://draft.example')
  await change(field(first.container, 'apiKey'), 'typed-secret')
  act(() => { first.root.unmount() })
  roots.splice(roots.indexOf(first.root), 1)
  first.container.remove()

  server = view({
    engine: 'tavily',
    engines: { tavily: { baseURL: 'https://latest.example' } },
  })
  const second = await renderSection(api)
  expect(value(field(second.container, 'tavilyBase'))).toBe('https://draft.example')
  expect(value(field(second.container, 'apiKey'))).toBe('typed-secret')

  await click(second.container, zh.discard)
  expect(value(field(second.container, 'tavilyBase'))).toBe('https://latest.example')
  expect(value(field(second.container, 'apiKey'))).toBe('')
})

test('retains edits made after a save captured its drafts', async () => {
  let server = view({
    engine: 'tavily',
    engines: { tavily: { baseURL: 'https://old.example' } },
  })
  const putStarted = Promise.withResolvers<void>()
  const releasePut = Promise.withResolvers<void>()
  const api = fakeApi({
    getConfig: async () => server,
    putConfig: async (catalog) => {
      putStarted.resolve()
      await releasePut.promise
      server = view({ engine: catalog.engine, engines: catalog.engines })
      return server
    },
  })
  const store = new WebSearchStore(api)
  await store.load()
  store.update({ tavilyBase: 'https://saved.example' })

  const saving = store.save()
  await putStarted.promise
  expect(store.getSnapshot().saving).toBe(true)
  store.update({ tavilyBase: 'https://later-edit.example' })
  releasePut.resolve()
  await saving

  expect(store.getSnapshot().catalog.engines.tavily?.baseURL).toBe('https://saved.example')
  expect(store.getSnapshot().drafts.tavilyBase).toBe('https://later-edit.example')
  expect(store.getSnapshot().dirty).toBe(true)
  expect(store.getSnapshot().saving).toBe(false)
})

test('ignores Discard during save and restores normally after the save settles', async () => {
  let server = view({
    engine: 'tavily',
    engines: { tavily: { baseURL: 'https://old.example' } },
  })
  const putStarted = Promise.withResolvers<void>()
  const releasePut = Promise.withResolvers<void>()
  const api = fakeApi({
    getConfig: async () => server,
    putConfig: async (catalog) => {
      putStarted.resolve()
      await releasePut.promise
      server = view({ engine: catalog.engine, engines: catalog.engines })
      return server
    },
  })
  const store = new WebSearchStore(api)
  await store.load()
  store.update({ tavilyBase: 'https://saved.example' })

  const saving = store.save()
  await putStarted.promise
  store.discard()
  expect(store.getSnapshot().drafts.tavilyBase).toBe('https://saved.example')
  expect(store.getSnapshot().dirty).toBe(true)

  releasePut.resolve()
  await saving
  expect(store.getSnapshot().catalog.engines.tavily?.baseURL).toBe('https://saved.example')
  expect(store.getSnapshot().drafts.tavilyBase).toBe('https://saved.example')
  expect(store.getSnapshot().dirty).toBe(false)

  store.update({ tavilyBase: 'https://temporary.example' })
  store.discard()
  expect(store.getSnapshot().drafts.tavilyBase).toBe('https://saved.example')
  expect(store.getSnapshot().dirty).toBe(false)
})

test('a remount load waits for an active save before refreshing Discard state', async () => {
  const initial = view({
    engine: 'tavily',
    engines: { tavily: { baseURL: 'https://old.example' } },
  })
  let server = initial
  const putStarted = Promise.withResolvers<void>()
  const releasePut = Promise.withResolvers<void>()
  const getConfig = vi.fn(async () => server)
  const api = fakeApi({
    getConfig,
    putConfig: async (catalog) => {
      putStarted.resolve()
      await releasePut.promise
      server = view({ engine: catalog.engine, engines: catalog.engines })
      return server
    },
  })
  const store = new WebSearchStore(api)
  await store.load()
  store.update({ tavilyBase: 'https://saved.example' })

  const saving = store.save()
  await putStarted.promise
  const remountLoad = store.load()
  await Promise.resolve()
  expect(getConfig).toHaveBeenCalledTimes(1)

  releasePut.resolve()
  await Promise.all([saving, remountLoad])
  store.update({ tavilyBase: 'https://temporary.example' })
  store.discard()

  expect(getConfig).toHaveBeenCalledTimes(3)
  expect(store.getSnapshot().drafts.tavilyBase).toBe('https://saved.example')
})

test('serializes overlapping saves in invocation order', async () => {
  let server = view({ engine: 'tavily' })
  const firstStarted = Promise.withResolvers<void>()
  const releaseFirst = Promise.withResolvers<void>()
  const persisted: string[] = []
  const api = fakeApi({
    getConfig: async () => server,
    putConfig: async (catalog) => {
      const baseURL = catalog.engines.tavily?.baseURL ?? ''
      persisted.push(baseURL)
      if (persisted.length === 1) {
        firstStarted.resolve()
        await releaseFirst.promise
      }
      server = view({ engine: catalog.engine, engines: catalog.engines })
      return server
    },
  })
  const store = new WebSearchStore(api)
  await store.load()
  store.update({ tavilyBase: 'https://first.example' })

  const first = store.save()
  await firstStarted.promise
  store.update({ tavilyBase: 'https://second.example' })
  const second = store.save()
  await Promise.resolve()
  expect(persisted).toEqual(['https://first.example'])

  releaseFirst.resolve()
  await Promise.all([first, second])

  expect(persisted).toEqual(['https://first.example', 'https://second.example'])
  expect(store.getSnapshot().catalog.engines.tavily?.baseURL).toBe('https://second.example')
  expect(store.getSnapshot().dirty).toBe(false)
})

test('continues the save queue after an earlier workflow rejects', async () => {
  let server = view({ engine: 'tavily' })
  const firstStarted = Promise.withResolvers<void>()
  const rejectFirst = Promise.withResolvers<void>()
  let writes = 0
  const api = fakeApi({
    getConfig: async () => server,
    putConfig: async (catalog) => {
      writes += 1
      if (writes === 1) {
        firstStarted.resolve()
        await rejectFirst.promise
      }
      server = view({ engine: catalog.engine, engines: catalog.engines })
      return server
    },
  })
  const store = new WebSearchStore(api)
  await store.load()
  store.update({ tavilyBase: 'https://first.example' })
  const first = store.save()
  await firstStarted.promise
  store.update({ tavilyBase: 'https://recovery.example' })
  const recovery = store.save()
  await Promise.resolve()
  expect(writes).toBe(1)

  rejectFirst.reject(new Error('catalog write failed'))
  await Promise.all([first, recovery])

  expect(writes).toBe(2)
  expect(store.getSnapshot().catalog.engines.tavily?.baseURL).toBe('https://recovery.example')
  expect(store.getSnapshot().error).toBeUndefined()
})

test('saving an empty API key updates the catalog without writing secrets', async () => {
  const fetchMock = stubApi(view({ engine: 'tavily' }))
  const { container } = await renderSection(new WebSearchApi())

  await change(field(container, 'tavilyBase'), 'https://api.example')
  await click(container, zh.save)

  expect(requests(fetchMock, 'PUT')).toEqual(['/web-search/config'])
  expect(requestBody(fetchMock, '/web-search/config')).toEqual({
    engine: 'tavily',
    engines: { tavily: { baseURL: 'https://api.example' } },
  })
})

test('saving a typed API key writes the engine secret and clears the draft key', async () => {
  const fetchMock = stubApi(view({ engine: 'brave' }))
  const { container } = await renderSection(new WebSearchApi())

  await change(field(container, 'apiKey'), 'brave-secret')
  await click(container, zh.save)

  expect(requests(fetchMock, 'PUT')).toEqual(['/web-search/config', '/web-search/secrets'])
  expect(requestBody(fetchMock, '/web-search/secrets')).toEqual({ BRAVE_API_KEY: 'brave-secret' })
  expect(value(field(container, 'apiKey'))).toBe('')
})

test('shows configured state without putting secret values into the key control', async () => {
  stubApi(view({
    engine: 'tavily',
    secrets: {
      TAVILY_API_KEY: { configured: true },
      BRAVE_API_KEY: { configured: false },
    },
  }))
  const { container } = await renderSection(new WebSearchApi())

  expect(container.textContent).toContain(zh.apiKeyConfigured)
  expect(value(field(container, 'apiKey'))).toBe('')
  await change(select(container), 'brave')
  expect(container.textContent).toContain(zh.apiKeyEmpty)
})

test('describes persisted engine readiness while a different engine is drafted', async () => {
  stubApi(view({
    engine: 'tavily',
    secrets: {
      TAVILY_API_KEY: { configured: true },
      BRAVE_API_KEY: { configured: false },
    },
  }))
  const { container } = await renderSection(new WebSearchApi())

  await change(select(container), 'brave')

  expect(container.textContent).toContain(`${zh.statusCurrent}: ${zh.engineTavily}`)
  expect(container.textContent).toContain(zh.statusKeyReady)
  expect(container.textContent).toContain(zh.statusProviderReady)
  expect(container.textContent).toContain(zh.statusNext)
  expect(container.textContent).not.toContain(`${zh.statusCurrent}: ${zh.engineBrave}`)
  expect(container.textContent).toContain(zh.dirty)
})

test('reports authoritative unavailability despite a configured credential', async () => {
  stubApi(view({
    engine: 'tavily',
    available: false,
    secrets: {
      TAVILY_API_KEY: { configured: true },
      BRAVE_API_KEY: { configured: false },
    },
  }))
  const { container } = await renderSection(new WebSearchApi())

  expect(container.textContent).toContain(`${zh.statusCurrent}: ${zh.engineTavily}`)
  expect(container.textContent).toContain(zh.statusKeyReady)
  expect(container.textContent).toContain(zh.statusProviderUnavailable)
  expect(container.textContent).toContain(zh.statusFailure)
  expect(container.textContent).not.toContain(zh.statusNext)
})

test('disables Save and Discard while a workflow is active', async () => {
  const putStarted = Promise.withResolvers<void>()
  const releasePut = Promise.withResolvers<void>()
  const current = view({ engine: 'tavily' })
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    if (input === '/web-search/config' && init?.method === 'PUT') {
      putStarted.resolve()
      await releasePut.promise
    }
    return json(current)
  }))
  const { container } = await renderSection(new WebSearchApi())
  await change(field(container, 'tavilyBase'), 'https://saved.example')

  const saveButton = button(container, zh.save)
  const discardButton = button(container, zh.discard)
  act(() => { saveButton.click() })
  await putStarted.promise
  expect(saveButton.disabled).toBe(true)
  expect(discardButton.disabled).toBe(true)

  releasePut.resolve()
  await act(async () => { await Promise.resolve() })
})

test('reports a partial save failure and refreshes the catalog state', async () => {
  const saved = view({
    engine: 'tavily',
    engines: { tavily: { baseURL: 'https://saved.example' } },
  })
  let catalogSaved = false
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    if (input === '/web-search/config' && init?.method === 'PUT') {
      catalogSaved = true
      return json(saved)
    }
    if (input === '/web-search/secrets' && init?.method === 'PUT') {
      return new Response(JSON.stringify({ error: 'credential store unavailable' }), { status: 500 })
    }
    return json(catalogSaved ? saved : view({ engine: 'tavily' }))
  })
  vi.stubGlobal('fetch', fetchMock)
  const { container } = await renderSection(new WebSearchApi())

  await change(field(container, 'tavilyBase'), 'https://saved.example')
  await change(field(container, 'apiKey'), 'tavily-secret')
  await click(container, zh.save)

  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Catalog saved')
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('credential store unavailable')
  expect(value(field(container, 'tavilyBase'))).toBe('https://saved.example')
  expect(value(field(container, 'apiKey'))).toBe('tavily-secret')
  expect(requests(fetchMock, 'GET')).toHaveLength(2)
})

type ViewOverrides = Partial<WebSearchConfigView['catalog']> & Pick<Partial<WebSearchConfigView>, 'secrets' | 'available'>

function view(overrides: ViewOverrides = {}): WebSearchConfigView {
  return {
    catalog: {
      engine: overrides.engine ?? null,
      engines: overrides.engines ?? {},
    },
    available: overrides.available ?? (overrides.engine !== null && overrides.engine !== undefined),
    secrets: overrides.secrets ?? {
      TAVILY_API_KEY: { configured: false },
      BRAVE_API_KEY: { configured: false },
    },
  }
}

function stubApi(response: WebSearchConfigView | (() => WebSearchConfigView)): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const current = typeof response === 'function' ? response() : response
    if (input === '/web-search/secrets' && init?.method === 'PUT') {
      const body = JSON.parse(init.body as string) as Record<string, string>
      return json({
        TAVILY_API_KEY: { configured: body.TAVILY_API_KEY !== undefined || current.secrets.TAVILY_API_KEY.configured },
        BRAVE_API_KEY: { configured: body.BRAVE_API_KEY !== undefined || current.secrets.BRAVE_API_KEY.configured },
      })
    }
    return json(current)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

function fakeApi(overrides: {
  getConfig: () => Promise<WebSearchConfigView>
  putConfig: (catalog: WebSearchConfigView['catalog']) => Promise<WebSearchConfigView>
}): WebSearchApi {
  return {
    getConfig: overrides.getConfig,
    putConfig: overrides.putConfig,
    putSecrets: async () => ({
      TAVILY_API_KEY: { configured: false },
      BRAVE_API_KEY: { configured: false },
    }),
  } as unknown as WebSearchApi
}

async function renderSection(api: WebSearchApi): Promise<{ container: HTMLElement; root: Root }> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(createElement(WebSearchSection, { api, t: key => zh[key] }))
  })
  return { container, root }
}

async function change(control: HTMLInputElement | HTMLSelectElement | null, next: string): Promise<void> {
  if (control === null) throw new Error('form control is missing')
  await act(async () => {
    const prototype = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(control, next)
    control.dispatchEvent(new Event('change', { bubbles: true }))
    control.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function click(container: HTMLElement, label: string): Promise<void> {
  await act(async () => { button(container, label).click() })
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const control = [...container.querySelectorAll('button')].find(candidate => candidate.textContent === label)
  if (control === undefined) throw new Error(`no button labelled ${label}`)
  return control
}

function select(container: HTMLElement): HTMLSelectElement {
  const control = container.querySelector('select[name="engine"]')
  if (control === null) throw new Error('engine select is missing')
  return control as HTMLSelectElement
}

function field(container: HTMLElement, name: string): HTMLInputElement | null {
  return container.querySelector(`input[name="${name}"]`)
}

function value(control: HTMLInputElement | null): string {
  if (control === null) throw new Error('form control is missing')
  return control.value
}

function requests(fetchMock: { mock: { calls: unknown[][] } }, method: string): string[] {
  return fetchMock.mock.calls
    .filter(([, init]) => ((init as RequestInit | undefined)?.method ?? 'GET') === method)
    .map(([path]) => path as string)
}

function requestBody(fetchMock: { mock: { calls: unknown[][] } }, path: string): unknown {
  const call = fetchMock.mock.calls.find(([input, init]) =>
    input === path && (init as RequestInit | undefined)?.body !== undefined)
  if (call === undefined) throw new Error(`no request for ${path}`)
  return JSON.parse((call[1] as RequestInit).body as string)
}
