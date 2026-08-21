# Multi-engine web search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@anht3889/dsh-web-search-bundle`, an out-of-tree DeepSeek Harness profile bundle that registers one `WebSearchProvider` (`dsh-web-search`) wrapping Tavily, Brave, and SearXNG, with a Settings form over `/web-search/*`.

**Architecture:** A single bundle package (Host `./manager` + empty stub + `./client`) inserts into the web profile and replaces the `web` row `config` with `searchProvider: dsh-web-search`. Catalog and secrets live under `$DSH_HOME/web-search/`. The provider reads catalog + keys per search. The browser never uses harness `settings.*`.

**Tech Stack:** TypeScript ESM, Cordis plugins, Vitest, React 18 (Settings section), Schemastery, `@deepseek-ai/dsh-web` `WebError` / `WebSearchProvider`.

**Spec:** [docs/design.md](../../design.md)

## Global Constraints

- Out-of-tree only: no edits under `deepseek-harness/`.
- npm name: `@anht3889/dsh-web-search-bundle`; provider id: `dsh-web-search`.
- HTTP prefix: `/web-search`. Credentialed fetch uses `redirect: 'error'`.
- Secret refs: `TAVILY_API_KEY`, `BRAVE_API_KEY`. Never persist secrets in `config.json` or GET JSON.
- Default bases: Tavily `https://api.tavily.com`, Brave `https://api.search.brave.com`. SearXNG has no default URL.
- Product UI copy is Chinese (`zh`) with `en` fallback; code comments English.
- Align published harness peers with `dsh-mcp-management` (`@deepseek-ai/dsh-home-paths` / `dsh-invariants` `0.1.0-rc.6`); typecheck client against the sibling `../deepseek-harness` checkout like that repo.
- `autoInstallPeers: false` in `pnpm-workspace.yaml`.
- Files end with one trailing newline. Commits are conventional (`feat:`, `test:`, `docs:`).

## File structure

```text
dsh-web-search/
  package.json
  pnpm-workspace.yaml
  tsconfig.json
  tsconfig.base.json
  vitest.config.ts
  .gitignore
  README.md
  docs/design.md                          # already written
  packages/bundle/
    package.json
    cordis.patch.yml
    tsconfig.json                         # client + stub
    tsconfig.manager.json
    tsdown.config.ts
    src/index.ts                          # empty Host stub
    src/invariant.ts
    src/css-modules.d.ts
    src/manager/types.ts
    src/manager/catalog.ts
    src/manager/secrets.ts
    src/manager/http.ts                   # redirect-error fetch + abort
    src/manager/engines/tavily.ts
    src/manager/engines/brave.ts
    src/manager/engines/searxng.ts
    src/manager/provider.ts
    src/manager/runtime.ts
    src/manager/http-api.ts
    src/manager/index.ts                  # Cordis apply
    src/client/api.ts
    src/client/store.ts
    src/client/locales.ts
    src/client/WebSearchSection.tsx
    src/client/WebSearchSection.module.css
    src/client/index.ts
    tests/manager/*.spec.ts
    tests/client/*.spec.ts
    tests/support/ui-primitives.ts
```

---

### Task 1: Workspace + catalog persistence

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `tsconfig.base.json`, `vitest.config.ts`, `.gitignore`
- Create: `packages/bundle/package.json`, `packages/bundle/tsconfig.manager.json`
- Create: `packages/bundle/src/manager/types.ts`, `packages/bundle/src/manager/catalog.ts`
- Test: `packages/bundle/tests/manager/catalog.spec.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `SearchEngineId`, `WebSearchCatalog`, `EMPTY_CATALOG`, `loadCatalog(path)`, `saveCatalog(path, catalog)`, `validateCatalog(catalog)`, `TAVILY_DEFAULT_BASE_URL`, `BRAVE_DEFAULT_BASE_URL`

- [ ] **Step 1: Scaffold the workspace**

Root `package.json`:

```json
{
  "name": "dsh-web-search",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.7.0",
  "engines": { "node": "^22.19 || >=24" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -b",
    "build": "pnpm -r run build"
  },
  "devDependencies": {
    "typescript": "^7.0.2",
    "vitest": "^4.1.10"
  }
}
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - 'packages/*'
autoInstallPeers: false
```

`tsconfig.base.json`: copy `dsh-mcp-management/tsconfig.base.json` (`strict`, `NodeNext`, `ES2022`, `declaration`, `skipLibCheck`).

Root `tsconfig.json`: `{ "files": [], "references": [{ "path": "./packages/bundle/tsconfig.manager.json" }] }`.

`.gitignore`: `node_modules`, `lib`, `dist`, `*.tsbuildinfo`, `.DS_Store`.

`packages/bundle/package.json` (minimal for this task): `"name": "@anht3889/dsh-web-search-bundle"`, `"type": "module"`, `"exports"` for `./manager` pointing at `./src/manager/index.ts` until build exists, `"devDependencies": { "@types/node": "^26.2.0" }`.

`packages/bundle/tsconfig.manager.json`: extend `../../tsconfig.base.json`, `rootDir` `src/manager`, `outDir` `lib/manager`, `declarationDir` `lib/types/manager`, `rewriteRelativeImportExtensions: true`, `types: ["node"]`, include `src/manager`.

`vitest.config.ts`: `test.include: ['packages/*/tests/**/*.spec.ts']`, alias `@anht3889/dsh-web-search-bundle/manager` is unnecessary if tests import relative `../../src/manager/...`.

Run: `pnpm install` from repo root.

- [ ] **Step 2: Write the failing catalog tests**

```ts
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { EMPTY_CATALOG, loadCatalog, saveCatalog } from '../../src/manager/catalog.ts'

test('missing file loads as empty catalog', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'dsh-ws-')), 'missing.json')
  expect(await loadCatalog(path)).toEqual({ engine: null, engines: {} })
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

test('refuses an unknown engine', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'dsh-ws-')), 'config.json')
  await writeFile(path, JSON.stringify({ engine: 'bing', engines: {} }))
  await expect(loadCatalog(path)).rejects.toThrow(/invalid/i)
})

test('refuses an unparseable SearXNG URL when that engine is selected', async () => {
  await expect(saveCatalog('/tmp/unused.json', {
    engine: 'searxng',
    engines: { searxng: { baseURL: 'not-a-url' } },
  })).rejects.toThrow(/url/i)
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm exec vitest run packages/bundle/tests/manager/catalog.spec.ts`

Expected: FAIL (module not found).

- [ ] **Step 4: Implement types and catalog**

`types.ts`:

```ts
export type SearchEngineId = 'tavily' | 'brave' | 'searxng'

export interface EngineEndpoints {
  tavily?: { baseURL?: string }
  brave?: { baseURL?: string }
  searxng?: { baseURL?: string }
}

export interface WebSearchCatalog {
  engine: SearchEngineId | null
  engines: EngineEndpoints
}

export const EMPTY_CATALOG: WebSearchCatalog = { engine: null, engines: {} }
export const TAVILY_DEFAULT_BASE_URL = 'https://api.tavily.com'
export const BRAVE_DEFAULT_BASE_URL = 'https://api.search.brave.com'
export const ENGINE_IDS: readonly SearchEngineId[] = ['tavily', 'brave', 'searxng']
```

`catalog.ts`: `loadCatalog` — missing file (`error.code === 'ENOENT'`) → `EMPTY_CATALOG`; JSON parse / validate failures throw `Error` including the path. `validateCatalog`: `engine` is `null` or in `ENGINE_IDS`; if `engine === 'searxng'`, `engines.searxng.baseURL` must be a non-empty string for which `URL.canParse` is true; optional Tavily/Brave `baseURL` values, when present, must `URL.canParse`. `saveCatalog`: validate, `mkdir(dirname(path), { recursive: true })`, write temp file then `rename` (same atomic pattern as `dsh-mcp-management` catalog).

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run packages/bundle/tests/manager/catalog.spec.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.json tsconfig.base.json vitest.config.ts .gitignore packages/bundle
git commit -m "$(cat <<'EOF'
feat: add web-search catalog persistence

EOF
)"
```

---

### Task 2: Secret store

**Files:**
- Create: `packages/bundle/src/manager/secrets.ts`
- Test: `packages/bundle/tests/manager/secrets.spec.ts`

**Interfaces:**
- Consumes: nothing from catalog
- Produces: `TAVILY_API_KEY_REF = 'TAVILY_API_KEY'`, `BRAVE_API_KEY_REF = 'BRAVE_API_KEY'`, `SecretRef`, `CredentialsApi` (same four methods as MCP: `resolve` / `describe` / `set` / `unset`), `createSecretStore({ credentials?, filePath, env })` returning `{ get, set, describe }`

Resolution for `get`/`describe`: credentials value if the service is present **and** returns a non-empty value; else YAML/file map; else `env()[ref]` when non-empty. `set` with `value.length === 0` is a no-op (does not wipe). File mode: YAML `Record<string, string>` like MCP fallback (`key: value` lines); `chmod` `0o600` after write. Serialize mutations with a promise queue (copy the MCP `createMutationQueue` helper into this file).

- [ ] **Step 1: Write the failing tests**

```ts
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { BRAVE_API_KEY_REF, TAVILY_API_KEY_REF, createSecretStore } from '../../src/manager/secrets.ts'

test('falls back to env when file and credentials are empty', async () => {
  const filePath = join(await mkdtemp(join(tmpdir(), 'dsh-ws-')), 'secrets.yaml')
  const store = createSecretStore({
    filePath,
    env: () => ({ [TAVILY_API_KEY_REF]: 'from-env' }),
  })
  expect(await store.get(TAVILY_API_KEY_REF)).toBe('from-env')
  expect(await store.describe(TAVILY_API_KEY_REF)).toEqual({ configured: true })
})

test('file values win over env', async () => {
  const filePath = join(await mkdtemp(join(tmpdir(), 'dsh-ws-')), 'secrets.yaml')
  const store = createSecretStore({ filePath, env: () => ({ [TAVILY_API_KEY_REF]: 'env' }) })
  await store.set(TAVILY_API_KEY_REF, 'file')
  expect(await store.get(TAVILY_API_KEY_REF)).toBe('file')
  expect(await readFile(filePath, 'utf8')).not.toMatch(/env/)
})

test('empty set does not wipe', async () => {
  const filePath = join(await mkdtemp(join(tmpdir(), 'dsh-ws-')), 'secrets.yaml')
  const store = createSecretStore({ filePath, env: () => ({}) })
  await store.set(TAVILY_API_KEY_REF, 'keep')
  await store.set(TAVILY_API_KEY_REF, '')
  expect(await store.get(TAVILY_API_KEY_REF)).toBe('keep')
})

test('credentials win when they return a value', async () => {
  const filePath = join(await mkdtemp(join(tmpdir(), 'dsh-ws-')), 'secrets.yaml')
  const store = createSecretStore({
    filePath,
    env: () => ({ [BRAVE_API_KEY_REF]: 'env' }),
    credentials: {
      resolve: async (ref) => ref === BRAVE_API_KEY_REF ? { value: 'cred' } : undefined,
      describe: async (ref) => ({ configured: ref === BRAVE_API_KEY_REF }),
      set: async () => {},
      unset: async () => {},
    },
  })
  expect(await store.get(BRAVE_API_KEY_REF)).toBe('cred')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run packages/bundle/tests/manager/secrets.spec.ts`

Expected: FAIL.

- [ ] **Step 3: Implement `createSecretStore`**

YAML without a new dependency: store `Record<string, string>` as lines `` `${key}: ${JSON.stringify(value)}\n` `` and parse by splitting on first `: `, `JSON.parse` the remainder. Missing file → `{}`. `mkdir` parent before write.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run packages/bundle/tests/manager/secrets.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/bundle/src/manager/secrets.ts packages/bundle/tests/manager/secrets.spec.ts
git commit -m "$(cat <<'EOF'
feat: add web-search secret store with env fallback

EOF
)"
```

---

### Task 3: Redirect-error HTTP helper

**Files:**
- Create: `packages/bundle/src/manager/http.ts`
- Test: `packages/bundle/tests/manager/http.spec.ts`

**Interfaces:**
- Consumes: `@deepseek-ai/dsh-web` `WebError` (add peer + vitest alias to `../deepseek-harness/packages/web/web/src/index.ts`; also alias `@deepseek-ai/dsh-llm` if `WebError` extends `HarnessError`)
- Produces: `isAbortError(error: unknown): boolean`, `providerFetch(url, init, label): Promise<Response>` where `init` always sets `redirect: 'error'`, abort → `new WebError(\`${label} aborted\`, 'WEB_ABORTED', { cause })`, other network errors → `new WebError(\`${label} request failed: ${String(error)}\`, 'WEB_PROVIDER_ERROR', { cause })`

`isAbortError`: `error instanceof DOMException && error.name === 'AbortError'` (same as Exa).

Add to `vitest.config.ts` aliases:

```ts
{ find: '@deepseek-ai/dsh-web', replacement: source('../deepseek-harness/packages/web/web/src/index.ts') },
{ find: '@deepseek-ai/dsh-llm', replacement: source('../deepseek-harness/packages/llm/llm/src/index.ts') },
```

Add `@deepseek-ai/dsh-web` as a `peerDependency: "*"` and a `devDependency` `link:../../../deepseek-harness/packages/web/web` on the bundle (same link style as MCP client peers).

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test, vi } from 'vitest'
import { WebError } from '@deepseek-ai/dsh-web'
import { providerFetch } from '../../src/manager/http.ts'

test('passes redirect: error to fetch', async () => {
  const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  await providerFetch('https://example.test/search', { method: 'GET' }, 'Tavily search')
  expect(fetchMock).toHaveBeenCalledWith(
    'https://example.test/search',
    expect.objectContaining({ redirect: 'error' }),
  )
})

test('maps AbortError to WEB_ABORTED', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => {
    throw new DOMException('aborted', 'AbortError')
  }))
  await expect(providerFetch('https://example.test', {}, 'Brave search'))
    .rejects.toMatchObject({ code: 'WEB_ABORTED' } satisfies Partial<WebError>)
})
```

Unstub fetch in `afterEach` (`vi.unstubAllGlobals()`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run packages/bundle/tests/manager/http.spec.ts`

Expected: FAIL.

- [ ] **Step 3: Implement `http.ts` and aliases**

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run packages/bundle/tests/manager/http.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/bundle/src/manager/http.ts packages/bundle/tests/manager/http.spec.ts packages/bundle/package.json vitest.config.ts
git commit -m "$(cat <<'EOF'
feat: reject redirects on web-search HTTP

EOF
)"
```

---

### Task 4: Tavily adapter

**Files:**
- Create: `packages/bundle/src/manager/engines/tavily.ts`
- Test: `packages/bundle/tests/manager/tavily.spec.ts`

**Interfaces:**
- Consumes: `providerFetch`, `WebSearchRequest` / `WebSearchResult` from `@deepseek-ai/dsh-web`, `TAVILY_DEFAULT_BASE_URL`
- Produces: `tavilySearch(request, options: { baseURL: string; apiKey: string }, signal?: AbortSignal): Promise<WebSearchResult>`

Request: `POST ${baseURL}/search`, headers `authorization: Bearer ${apiKey}`, `content-type: application/json`, `accept: application/json`. Body `{ query: request.query, include_answer: true, ...request.maxResults !== undefined ? { max_results: request.maxResults } : {} }`. Non-OK: `WebError` `WEB_PROVIDER_ERROR` with body `detail`/`error`/`message` when JSON, else `Tavily API error (HTTP ${status})`. OK: `content` from non-empty `answer`; map `results[]` with `url` required; `snippet` ← `content`; `publishedAt` ← `published_date`; dedupe by URL (first wins). Unparseable body: `Tavily returned an unprocessable response body: …`. Missing `apiKey` is not this function’s job (provider).

- [ ] **Step 1: Write the failing tests** (golden map + missing url dropped + 401 + abort mid-json using `isAbortError` path via `providerFetch`)

```ts
import { expect, test, vi } from 'vitest'
import { tavilySearch } from '../../src/manager/engines/tavily.ts'

test('maps answer and results', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    answer: 'summary',
    results: [
      { url: 'https://a.example', title: 'A', content: 'snip', published_date: '2026-01-01' },
      { title: 'no url' },
      { url: 'https://a.example', title: 'dup' },
    ],
  }), { status: 200 })))
  const result = await tavilySearch(
    { query: 'q', maxResults: 3 },
    { baseURL: 'https://api.tavily.com', apiKey: 'k' },
  )
  expect(result.content).toBe('summary')
  expect(result.sources).toEqual([
    { url: 'https://a.example', title: 'A', snippet: 'snip', publishedAt: '2026-01-01' },
  ])
  expect(result.truncated).toBe(false)
})
```

Also assert fetch URL `https://api.tavily.com/search` and `Authorization` header `Bearer k`. Add a test that HTTP 401 throws `WEB_PROVIDER_ERROR`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run packages/bundle/tests/manager/tavily.spec.ts`

Expected: FAIL.

- [ ] **Step 3: Implement `tavilySearch`**

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run packages/bundle/tests/manager/tavily.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/bundle/src/manager/engines/tavily.ts packages/bundle/tests/manager/tavily.spec.ts
git commit -m "$(cat <<'EOF'
feat: map Tavily search onto WebSearchResult

EOF
)"
```

---

### Task 5: Brave adapter

**Files:**
- Create: `packages/bundle/src/manager/engines/brave.ts`
- Test: `packages/bundle/tests/manager/brave.spec.ts`

**Interfaces:**
- Consumes: `providerFetch`, `BRAVE_DEFAULT_BASE_URL`
- Produces: `braveSearch(request, options: { baseURL: string; apiKey: string }, signal?: AbortSignal): Promise<WebSearchResult>`

`GET ${baseURL}/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}` where `count = Math.min(request.maxResults ?? 10, 20)`. Header `X-Subscription-Token`. Map `web.results[]` → `url`, `title`, `snippet` ← `description`. No `content`. Dedup by URL. Missing `web.results` → empty `sources`. Errors same pattern with label `Brave search`.

- [ ] **Step 1: Write failing tests** for mapping, `count=20` when `maxResults` is 50, and token header.

- [ ] **Step 2: Run** `pnpm exec vitest run packages/bundle/tests/manager/brave.spec.ts` — expect FAIL.

- [ ] **Step 3: Implement `braveSearch`**

- [ ] **Step 4: Run tests** — expect PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/bundle/src/manager/engines/brave.ts packages/bundle/tests/manager/brave.spec.ts
git commit -m "$(cat <<'EOF'
feat: map Brave web search onto WebSearchResult

EOF
)"
```

---

### Task 6: SearXNG adapter

**Files:**
- Create: `packages/bundle/src/manager/engines/searxng.ts`
- Test: `packages/bundle/tests/manager/searxng.spec.ts`

**Interfaces:**
- Consumes: `providerFetch`
- Produces: `searxngSearch(request, options: { baseURL: string }, signal?: AbortSignal): Promise<WebSearchResult>`

`GET ${baseURL}/search?q=&format=json` (preserve instance path; `new URL('search', baseURL.endsWith('/') ? baseURL : baseURL + '/')`). Map `results[]` → `url`, `title`, `snippet` ← `content`, `publishedAt` ← `publishedDate`. No `content` on the result. HTTP 403 message **must** include `format: json` (exact substring). Dedup by URL. Do not send `maxResults` on the wire.

- [ ] **Step 1: Write failing tests** for mapping `publishedDate` and 403 text.

```ts
test('403 tells the operator to enable JSON', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('Forbidden', { status: 403 })))
  await expect(searxngSearch({ query: 'q' }, { baseURL: 'http://127.0.0.1:8080' }))
    .rejects.toThrow(/format: json/)
})
```

- [ ] **Step 2: Run** `pnpm exec vitest run packages/bundle/tests/manager/searxng.spec.ts` — expect FAIL.

- [ ] **Step 3: Implement `searxngSearch`**

- [ ] **Step 4: Run tests** — expect PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/bundle/src/manager/engines/searxng.ts packages/bundle/tests/manager/searxng.spec.ts
git commit -m "$(cat <<'EOF'
feat: map SearXNG JSON search onto WebSearchResult

EOF
)"
```

---

### Task 7: `MultiEngineSearchProvider`

**Files:**
- Create: `packages/bundle/src/manager/provider.ts`
- Test: `packages/bundle/tests/manager/provider.spec.ts`

**Interfaces:**
- Consumes: catalog types, secret refs, three `*Search` functions
- Produces:

```ts
export const WEB_SEARCH_PROVIDER_ID = 'dsh-web-search'

export interface ProviderDeps {
  catalog: () => WebSearchCatalog
  resolveKey: (ref: typeof TAVILY_API_KEY_REF | typeof BRAVE_API_KEY_REF) => Promise<string | undefined>
}

export class MultiEngineSearchProvider implements WebSearchProvider {
  readonly id = WEB_SEARCH_PROVIDER_ID
  constructor(private readonly deps: ProviderDeps) {}
  available(): boolean
  search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>
}
```

`resolvedBaseURL(catalog, engine)`: Tavily/Brave use catalog override or default constant; SearXNG uses catalog URL only.

`available()`: `engine !== null` && `URL.canParse(resolvedBaseURL)` (SearXNG fails when URL missing).

`search()`: if `!available()` throw `WebError` `'web-search engine is not configured'`, `'WEB_PROVIDER_ERROR'`. Tavily/Brave: empty key → `WebError` `` `${engine} search credential is missing; set ${REF} in Settings or the environment` ``, `'WEB_PROVIDER_ERROR'`. Then dispatch. Do not import `fetch` here.

- [ ] **Step 1: Write failing tests**

```ts
test('unavailable when engine is null', () => {
  const provider = new MultiEngineSearchProvider({
    catalog: () => ({ engine: null, engines: {} }),
    resolveKey: async () => 'k',
  })
  expect(provider.available()).toBe(false)
})

test('next search uses the catalog at call time', async () => {
  let engine: 'tavily' | 'brave' = 'tavily'
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('tavily')) {
      return new Response(JSON.stringify({ results: [{ url: 'https://t.example' }] }), { status: 200 })
    }
    return new Response(JSON.stringify({ web: { results: [{ url: 'https://b.example' }] } }), { status: 200 })
  }))
  const provider = new MultiEngineSearchProvider({
    catalog: () => ({ engine, engines: {} }),
    resolveKey: async () => 'k',
  })
  expect((await provider.search({ query: 'q' })).sources[0]?.url).toBe('https://t.example')
  engine = 'brave'
  expect((await provider.search({ query: 'q' })).sources[0]?.url).toBe('https://b.example')
})

test('missing Tavily key fails search not available()', async () => {
  const provider = new MultiEngineSearchProvider({
    catalog: () => ({ engine: 'tavily', engines: {} }),
    resolveKey: async () => undefined,
  })
  expect(provider.available()).toBe(true)
  await expect(provider.search({ query: 'q' })).rejects.toThrow(/TAVILY_API_KEY/)
})
```

- [ ] **Step 2: Run** `pnpm exec vitest run packages/bundle/tests/manager/provider.spec.ts` — expect FAIL.

- [ ] **Step 3: Implement the provider**

- [ ] **Step 4: Run tests** — expect PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/bundle/src/manager/provider.ts packages/bundle/tests/manager/provider.spec.ts
git commit -m "$(cat <<'EOF'
feat: select Tavily Brave or SearXNG per search

EOF
)"
```

---

### Task 8: Runtime + HTTP API + manager plugin

**Files:**
- Create: `packages/bundle/src/manager/runtime.ts`, `packages/bundle/src/manager/http-api.ts`, `packages/bundle/src/manager/index.ts`
- Test: `packages/bundle/tests/manager/http-api.spec.ts`

**Interfaces:**
- Consumes: `loadCatalog` / `saveCatalog`, `createSecretStore`, `MultiEngineSearchProvider`
- Produces:

```ts
export class WebSearchRuntime {
  static async create(options: {
    catalogPath: string
    secretsPath: string
    credentials?: CredentialsApi
    env?: () => NodeJS.Dict<string>
  }): Promise<WebSearchRuntime>
  getCatalog(): WebSearchCatalog
  async putCatalog(catalog: WebSearchCatalog): Promise<WebSearchCatalog>
  async describeSecrets(): Promise<{ TAVILY_API_KEY: { configured: boolean }; BRAVE_API_KEY: { configured: boolean } }>
  async putSecrets(partial: Partial<Record<'TAVILY_API_KEY' | 'BRAVE_API_KEY', string>>): Promise<void>
  provider(): MultiEngineSearchProvider
}

export function registerHttpApi(webServer: { register(route: {
  kind: 'prefix' | 'exact'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}): () => void }, runtime: WebSearchRuntime): () => void
```

HTTP (prefix `/web-search`, copy MCP `respond` / `readJson` / `respondError` locally in `http-api.ts`):

| Method | Path | Behavior |
|---|---|---|
| GET | `/config` | `{ catalog, available, secrets }` where `available` is `runtime.provider().available()` and `secrets` is `describeSecrets()` |
| PUT | `/config` | body is `WebSearchCatalog`; `validateCatalog`; `putCatalog`; 200 same shape as GET |
| GET | `/secrets` | `describeSecrets()` object |
| PUT | `/secrets` | body `{ TAVILY_API_KEY?: string, BRAVE_API_KEY?: string }`; skip empty strings; 200 describe |

Unknown path: 404 `{ error: 'not found' }`. Invalid JSON/catalog: 400 `{ error: message }`.

`index.ts`:

```ts
export const name = 'dsh-web-search'
export const inject = ['web']
export interface Config { catalogPath?: string; secretsPath?: string }
export const Config: z<Config> = z.object({
  catalogPath: z.string().default(dshHomePath('web-search', 'config.json')),
  secretsPath: z.string().default(dshHomePath('web-search', 'secrets.yaml')),
})
export function apply(ctx: Context, config: Config): void
```

`apply`: `WebSearchRuntime.create` then `ctx.web.registerSearchProvider(runtime.provider())` inside `ctx.effect` so dispose unregisters; `ctx.inject(['webServer'], …)` to `registerHttpApi`. `apply` may be `async` if create is async (MCP manager is async). Default paths via `dshHomePath` — alias `@deepseek-ai/dsh-home-paths` in vitest like MCP.

- [ ] **Step 1: Write failing HTTP tests** using `node:http` `createServer` + the same `webServer.register` fake as `dsh-mcp-management/packages/bundle/tests/manager/e2e-loader.spec.ts` (`startWebServer` helper: wrap `http.createServer`, store prefix handlers, `listen(0)`). Cover: GET empty catalog `available: false`; PUT `{ engine: 'searxng', engines: { searxng: { baseURL: 'http://127.0.0.1:8888' } } }` then GET `available: true`; PUT secrets `{ TAVILY_API_KEY: 'x' }` then GET secrets configured true; PUT secrets `{ TAVILY_API_KEY: '' }` leaves configured true.

- [ ] **Step 2: Run** `pnpm exec vitest run packages/bundle/tests/manager/http-api.spec.ts` — expect FAIL.

- [ ] **Step 3: Implement runtime, HTTP API, and `apply`**

Also add `dsh-home-paths` dependency `0.1.0-rc.6` and vitest alias to harness `packages/util/home-paths/src/index.ts`. Add `@deepseek-ai/schemastery` + alias like MCP. `inject = ['web']` — tests that only hit HTTP can `ctx.provide('web', { registerSearchProvider: () => () => {} })`.

- [ ] **Step 4: Run tests** — expect PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/bundle/src/manager packages/bundle/tests/manager/http-api.spec.ts packages/bundle/package.json vitest.config.ts
git commit -m "$(cat <<'EOF'
feat: serve /web-search config and secrets

EOF
)"
```

---

### Task 9: Client Settings section

**Files:**
- Create: `packages/bundle/src/index.ts`, `packages/bundle/src/invariant.ts`, `packages/bundle/src/css-modules.d.ts`, `packages/bundle/src/client/api.ts`, `packages/bundle/src/client/store.ts`, `packages/bundle/src/client/locales.ts`, `packages/bundle/src/client/WebSearchSection.tsx`, `packages/bundle/src/client/WebSearchSection.module.css`, `packages/bundle/src/client/index.ts`
- Create: `packages/bundle/tsconfig.json`, `packages/bundle/tsdown.config.ts`, `packages/bundle/tests/support/ui-primitives.ts`
- Test: `packages/bundle/tests/client/WebSearchSection.spec.ts`
- Modify: root `tsconfig.json` to also reference `./packages/bundle`

**Interfaces:**
- Consumes: HTTP routes from Task 8
- Produces: `WebSearchApi` class with `getConfig()`, `putConfig(catalog)`, `putSecrets(partial)`; `apply(ctx)` registers `settings.section` id `web-search` order `45` locale `settings.web-search`

Copy MCP `dsh.client` manifest, peerDependencies (runtime, slots, primitives, settings, locale, web-react, react), and `tsdown.config.ts` using `clientBundle('@anht3889/dsh-web-search-bundle', ['lib/types/index.js', 'lib/types/invariant.js'])` from `../../../deepseek-harness/packages/client/tsdown.client.ts`.

`src/index.ts`: `export function apply(): void {}`

`invariant.ts`: copy MCP companion with `PACKAGE_NAME = '@anht3889/dsh-web-search-bundle'` and reason `No runtime invariant: this browser-only section owns no host event or data relationship.` Host manager does own a relationship (catalog file + provider registry) — put a **second** installer in `src/manager/invariant.ts` **or** expand bundle invariant later. For v1, manager tests already prove register/dispose; keep the MCP-style empty companion on the stub package so `dsh.client` loading does not fail if the host runs `./invariant`.

`locales.ts` keys (use these exact names): `nav`, `title`, `engine`, `engineTavily`, `engineBrave`, `engineSearxng`, `apiKey`, `apiKeyConfigured`, `apiKeyEmpty`, `baseUrl`, `searxngUrl`, `save`, `discard`, `statusUnavailable`, `statusReady`, `dirty`. Chinese `zh` values: 网络搜索, 网络搜索, 搜索引擎, Tavily, Brave, SearXNG, API 密钥, 已配置, 未配置, 接口地址, SearXNG 地址, 保存, 放弃, 尚未选择可用引擎，web_search 会失败, 下一次 web_search 将使用该引擎（DeepSeek 搜索仍已安装但不会被调用）, 有未保存的更改.

`WebSearchApi`: `baseUrl = '/web-search'`, `request` like MCP (`fetch`, json, throw on !ok).

`WebSearchStore`: snapshot `{ catalog, secrets, available, drafts: { engine, tavilyKey, braveKey, tavilyBase, braveBase, searxngBase }, dirty, error? }`; `load` GET `/config`; `save` PUT catalog then optional secrets for non-empty draft keys; `discard` resets drafts from last loaded catalog.

`WebSearchSection.tsx`: engine `<select>`; Tavily/Brave show password input + base URL; SearXNG shows required URL. Save/Discard buttons from `@deepseek-ai/dsh-client-ui-primitives` `Button`. CSS Modules with `--dsw-*` tokens only (no literal colors). Props: `{ api, t }` from inject.

Vitest aliases: copy MCP react/clsx/ui-primitives aliases. `tests/support/ui-primitives.ts` re-exports `Button` from harness `ui-primitives/src/Button.tsx`.

- [ ] **Step 1: Write failing jsdom tests**

```ts
// @vitest-environment jsdom
test('switching to SearXNG hides the API key field', async () => { /* GET config engine null; change select; query input */ })
test('empty API key save does not PUT /secrets', async () => { /* catalog already tavily; save; fetch mock must not include /secrets */ })
test('typed API key save PUTs /secrets', async () => { /* type into key field; save; expect PUT /web-search/secrets */ })
```

Use `createRoot` + `act` like MCP client tests; stub `fetch` by URL.

- [ ] **Step 2: Run** `pnpm exec vitest run packages/bundle/tests/client/WebSearchSection.spec.ts` — expect FAIL.

- [ ] **Step 3: Implement client files and complete `package.json` exports** (`./client` → `lib/client.js` after tsdown; during tests import `../../src/client/...`). Fill `files`, `dsh.bundle.patch`, `dsh.client`.

- [ ] **Step 4: Run client tests** — expect PASS. Run `pnpm --filter @anht3889/dsh-web-search-bundle run bundle` after adding the tsdown script.

- [ ] **Step 5: Commit**

```bash
git add packages/bundle/src packages/bundle/tests/client packages/bundle/tsconfig.json packages/bundle/tsdown.config.ts packages/bundle/package.json tsconfig.json vitest.config.ts
git commit -m "$(cat <<'EOF'
feat: add Web search Settings section

EOF
)"
```

---

### Task 10: Patch, README, loader smoke

**Files:**
- Create: `packages/bundle/cordis.patch.yml`, `packages/bundle/README.md`, `README.md`
- Test: `packages/bundle/tests/manager/loader.spec.ts`

**Interfaces:**
- Consumes: `apply` from `src/manager/index.ts`, `WEB_SEARCH_PROVIDER_ID`
- Produces: installable patch

`cordis.patch.yml` exactly:

```yaml
- insert:
    - id: dsh-web-search
      name: '@anht3889/dsh-web-search-bundle/manager'
      config:
        catalogPath: !!js dshHomePath('web-search', 'config.json')
        secretsPath: !!js dshHomePath('web-search', 'secrets.yaml')
    - id: dsh-web-search-ui
      name: '@anht3889/dsh-web-search-bundle'
- id: web
  config:
    searchProvider: dsh-web-search
```

Root README: install `pnpm install && pnpm run build` then `npx @deepseek-ai/dsh plugin --profile web add ./packages/bundle`; restart; Settings → 网络搜索; DeepSeek unused; restore by profile patch `- id: web` / `searchProvider: deepseek-official`; SearXNG needs `format: json` and a private instance; secrets path table.

Bundle README: same plus package export table.

Loader test: `Context` + fake `web` with `Map` of providers + `registerSearchProvider`; `ctx.plugin(manager, { catalogPath, secretsPath })`; assert map has `dsh-web-search`; dispose fiber; map empty.

- [ ] **Step 1: Write failing loader test** (plugin not wired).

- [ ] **Step 2: Run** `pnpm exec vitest run packages/bundle/tests/manager/loader.spec.ts` — expect FAIL if `apply` does not register (should already pass if Task 8 did — if it passes, still add the assertion and docs). If Task 8 already registers, this test should be written first against the fake and pass after `apply` exists; if it already passes, do not change production code except docs/patch.

- [ ] **Step 3: Add patch + READMEs**

- [ ] **Step 4: Run** `pnpm test` and `pnpm run typecheck` (typecheck may need client refs only after `pnpm install` in bundle). Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/bundle/cordis.patch.yml packages/bundle/README.md README.md packages/bundle/tests/manager/loader.spec.ts
git commit -m "$(cat <<'EOF'
docs: document web-search bundle install and restore

EOF
)"
```

---

## Self-review (spec coverage)

| Spec section | Task |
|---|---|
| One provider id `dsh-web-search` | 7, 10 |
| Patch pin `web.searchProvider` | 10 |
| Catalog JSON, no secrets | 1, 2 |
| Secret refs + env fallback + empty PUT | 2, 8 |
| Per-search engine switch | 7 |
| Tavily / Brave / SearXNG mapping + 403 text | 4–6 |
| `redirect: 'error'` | 3 |
| `/web-search` GET/PUT | 8 |
| Settings section order 45, Chinese copy | 9 |
| Restore DeepSeek in README | 10 |
| Loader registration | 10 |
| No harness edits / no Exa wrap / no fetch | honored (no tasks) |
