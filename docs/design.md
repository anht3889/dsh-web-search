# Multi-engine web search for DeepSeek Harness — Design

**Date:** 2026-08-21
**Repo:** `dsh-web-search` (out-of-tree only; **no** changes to `deepseek-harness`)

## Goal

Ship an installable DeepSeek Harness profile bundle that registers **one** `WebSearchProvider` (`id: dsh-web-search`) wrapping Tavily, Brave Search, and SearXNG. After install, the Web profile’s `web.searchProvider` pin points at that wrapper. Operators pick the engine and supply keys (or a SearXNG URL) in **Settings → Web search**. The model still calls `dsh-tool-web`; only the Host backend changes.

## Non-goals (v1)

- Any edit to `deepseek-harness` (apiproxy allowlists, Plugin configuration cards, `web.searchProvider` UI).
- Using Host `settings.*` for persistence or UI.
- Wrapping in-tree Exa or Perplexity providers.
- Registering one seam provider per engine.
- `web_fetch`, extra Tavily/Brave/SearXNG knobs (depth, country, safesearch, extra_snippets).
- Runtime switch back to `deepseek-official` without a composition patch and restart.
- MCP-style CRUD of N backends, connection logs, or OAuth.
- Multi-user / remote (non-loopback) secret administration.

## Constraints

| Constraint | Implication |
|---|---|
| Zero harness source changes | Profile bundle + plugins only |
| Plugin configuration allowlist is in-repo | Do not use `installSettingsSection` for the GUI |
| `settings.section` exists | Register a Settings nav item; no shell fork |
| Base profile pins `searchProvider: deepseek-official` | Bundle patch replaces that `web` row `config` with `searchProvider: dsh-web-search` |
| `WebRuntime` reads the pin at construction | Changing wrapper vs DeepSeek requires restart |
| Cordis patches assign `config` wholesale | The `web` patch must include the full intended `web` config object (today that is only `searchProvider`) |
| Two usable seam providers with no pin → `WEB_PROVIDER_AMBIGUOUS` | Wrapper registers exactly one id; DeepSeek may stay mounted and unused |
| Credential stores are async | `available()` does not require a resolved key; missing keys fail inside `search()` |
| Sibling harness checkout may lack built JS | Runtime harness deps use published releases; workspace links stay type-only |

## Architecture

```text
┌─ browser (Settings → Web search) ──────────────────────┐
│  bundle/client  (dsh.client)                           │
│    engine picker / keys / base URLs / Save             │
└─────────────── HTTP /web-search/* ─────────────────────┘
                         │
┌─ Host (profile bundle) ────────────────────────────────┐
│  bundle/manager                                        │
│       ├─ catalog   ($DSH_HOME/web-search/config.json)  │
│       ├─ secrets   (ctx.credentials when live)         │
│       └─ ctx.web.registerSearchProvider(dsh-web-search)│
│              └─ per search: Tavily | Brave | SearXNG   │
└────────────────────────────────────────────────────────┘
```

**Rules**

- Bundle inserts Host manager + UI stub; `client-modules` discovers `dsh.client`.
- UI talks only to `/web-search/*`, never harness `settings.*`.
- DeepSeek search stays mounted; it does not run while the pin is `dsh-web-search`.
- Secrets never appear in `config.json` or GET bodies (flags only).
- The provider projects catalog + credentials **per search**, so an engine change applies on the next `web_search` without restart.

## Package layout

```text
packages/
  bundle/    # Installable surface: patch + ./manager + ./client
```

One package: `@anht3889/dsh-web-search-bundle`. Exports: `.` (empty Host stub for `dsh.client` discovery), `./manager` (provider + HTTP), `./client` (Settings section), `./cordis.patch.yml`.

**Peers / deps (align to a documented harness release):** `@deepseek-ai/cordis`, `@deepseek-ai/dsh-web`, `@deepseek-ai/dsh-host-webserver`, `@deepseek-ai/dsh-credentials` (optional at runtime), `@deepseek-ai/dsh-home-paths`, `@deepseek-ai/schemastery`, client slot/locale/UI peers as required by the Settings section pattern.

## Data model

### Durable catalog

Path: `$DSH_HOME/web-search/config.json` (manager config `catalogPath`). No secrets.

```ts
type SearchEngineId = 'tavily' | 'brave' | 'searxng'

type WebSearchCatalog = {
  engine: SearchEngineId | null
  engines: {
    tavily?: { baseURL?: string }
    brave?: { baseURL?: string }
    searxng?: { baseURL?: string }
  }
}
```

Install default: `{ engine: null, engines: {} }`. With the `web` pin, that makes the wrapper registered but `available() === false` → `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` until the operator selects an engine (and, for SearXNG, a URL). There is no silent fallback to DeepSeek.

Default bases (used when the catalog omits `baseURL`): Tavily `https://api.tavily.com`, Brave `https://api.search.brave.com`. SearXNG has **no** default public instance.

### Secrets

Never stored in `config.json`.

| Ref | Engine |
|---|---|
| `TAVILY_API_KEY` | Tavily |
| `BRAVE_API_KEY` | Brave |

Resolution order per search: `ctx.credentials` when mounted, else `$DSH_HOME/web-search/secrets.yaml` (`secretsPath`), else process environment. SearXNG has no key.

Describe APIs report `{ configured: boolean }` only.

### Plugin Config (Loader)

`catalogPath` and `secretsPath` only. Engine choice is catalog state so the Settings form does not fight a frozen cordis entry.

### Provider

```ts
// id registered with ctx.web
'dsh-web-search'
```

`available()` (sync, no network): `engine` is a known id; selected engine’s base URL parses as an absolute URL; SearXNG requires a catalog `baseURL`. Keys are not checked here.

`search()` reads the current catalog, resolves the key, dispatches to the selected adapter. Missing Tavily/Brave key → `WEB_PROVIDER_ERROR` with an actionable message. `engine: null` should not reach `search()` if selection honors `available()`; if it does, fail the same way.

## Engine adapters

Private modules inside `./manager`. Shared HTTP: `redirect: 'error'`; abort → `WEB_ABORTED`; other failures → `WEB_PROVIDER_ERROR`. Deduplicate sources by URL. Drop entries with no `url`. Honor `request.maxResults` when the API has a count knob; the seam still truncates.

### Tavily

- `POST {baseURL}/search`
- `Authorization: Bearer <key>` (not a body `api_key`)
- Body: `{ query, max_results, include_answer: true }` (`max_results` from `request.maxResults` when set)
- Map: `content` ← `answer` when non-empty; `results[]` → `url`, `title`, `snippet` ← `content`, `publishedAt` ← `published_date` when present

### Brave

- `GET {baseURL}/res/v1/web/search?q=&count=`
- `X-Subscription-Token: <key>`
- `count` = `min(maxResults ?? 10, 20)` (API cap 20)
- Map: `web.results[]` → `url`, `title`, `snippet` ← `description`. No `content`. Ignore news/video/extra_snippets.

### SearXNG

Self-hosted metasearch (not a first-party index). The instance must enable JSON (`format: json` in its `settings.yml`); otherwise HTTP 403.

- `GET {baseURL}/search?q=&format=json`
- No auth. `baseURL` required.
- No result-count parameter; seam truncates.
- Map: `results[]` → `url`, `title`, `snippet` ← `content`, `publishedAt` ← `publishedDate` when present. No `content`.
- 403 because JSON is disabled: error text tells the operator to enable `format: json`.

## HTTP API

Prefix `/web-search` on the Host webserver. Loopback-trusted like the rest of the web host. No secret values in GET bodies.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/config` | Catalog + `available` + per-engine `{ configured: boolean }` for keys |
| `PUT` | `/config` | Replace catalog (validate engine id and URLs; fail loud) |
| `GET` | `/secrets` | `{ TAVILY_API_KEY: { configured }, BRAVE_API_KEY: { configured } }` |
| `PUT` | `/secrets` | Write-only; omitted keys unchanged; empty string does not wipe |

Missing webserver: the provider still searches; Settings UI is unavailable (document).

## Settings UI

- Nav **Web search** via `settings.section`, `id: 'web-search'`, `order: 45` (after MCP’s `40` when both are installed).
- Locale namespace `settings.web-search`; Chinese product copy; `zh` + `en`.
- One form: engine select; fields for the selected engine only (Tavily/Brave: key + optional base URL; SearXNG: required instance URL, no key).
- Key control starts blank and shows configured vs not. Empty save keeps the stored secret.
- **Save** → `PUT /web-search/config` and, if a key was typed, `PUT /web-search/secrets`. **Discard** drops drafts.
- Status line: current engine, whether a key/URL is configured, and that the next `web_search` uses this wrapper.
- Restore DeepSeek: README only (`configure` `web.searchProvider` back to `deepseek-official` and restart).
- CSS Modules + `--dsw-*` tokens; no new component library.
- Drafts in a small client store so unsaved edits survive section remount.

## Install

`cordis.patch.yml`:

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

1. `dsh plugin --profile web add` the bundle (or equivalent profile `dependencies` + `dsh.profile.bundles`).
2. Restart. Settings shows **Web search**. `web_search` uses the wrapper once an engine is configured.
3. README: DeepSeek remains installed but unused; how to pin back; SearXNG JSON must be enabled; do not point SearXNG at a random public instance.

## Testing

| Layer | Coverage |
|---|---|
| Adapter fixtures | Golden JSON → `WebSearchResult`; drop missing `url`; abort → `WEB_ABORTED`; redirect not followed; HTTP/body errors → `WEB_PROVIDER_ERROR`; SearXNG 403 mentions `format: json` |
| Provider | `engine: null` → `available() === false`; catalog engine change affects the next `search()`; missing Tavily/Brave key fails the call, not `available()` |
| Catalog / secrets | No secrets in `config.json`; describe flags only; empty secret PUT does not wipe |
| HTTP | GET/PUT config and secrets on a fake `webserver.register` |
| Client | jsdom: engine fields swap; empty key does not wipe; Save hits the stub API |
| Loader | Boot the bundle patch against a test tree; provider id `dsh-web-search` is registered |

No harness `test:snapshot` in this repo.

## Error handling (summary)

- Invalid catalog write: refuse; keep last-good catalog in memory.
- Unparseable selected base URL: `available() === false`.
- Missing key / HTTP / unprocessable body: `WEB_PROVIDER_ERROR` with engine-prefixed message.
- Cancellation: `WEB_ABORTED` (including abort mid-body).
- Redirect: fail before contacting `Location`.
- Catalog I/O failure at load: fail loud (empty catalog is not a silent DeepSeek fallback).

## Success criteria

1. With only this bundle installed (no harness edits), Web Settings shows **Web search** and can select Tavily, Brave, or SearXNG and store keys without putting secrets in `config.json`.
2. After restart, `ctx.web.search()` uses `dsh-web-search`, not `deepseek-official`, when the wrapper is `available()`.
3. Changing engine in Settings changes the next search without restart.
4. Tavily/Brave credentialed requests do not follow redirects; SearXNG 403 for disabled JSON is actionable.
5. README documents restore-to-DeepSeek and SearXNG instance requirements.
