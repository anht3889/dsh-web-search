# dsh-web-search

Out-of-tree multi-engine web search for DeepSeek Harness. The installable bundle registers one `dsh-web-search` provider that can use Tavily, Brave Search, or a private SearXNG instance.

## Prerequisites

- The `dsh` CLI and a Web profile.
- For a source checkout: Node.js `^22.19` or `>=24`, pnpm, and a sibling `../deepseek-harness` checkout. Client typecheck and `tsdown` extend that tree; published installs use the prebuilt package and do not need it.
- A Tavily or Brave API key for that engine, or a private SearXNG instance you operate or trust.

## Install

From a local source checkout:

```sh
pnpm install && pnpm run build
dsh plugin --profile web add ./packages/bundle
```

After the package is published, install its prebuilt npm package instead:

```sh
dsh plugin --profile web add @anht3889/dsh-web-search-bundle
```

Restart the Web profile after either install:

```sh
dsh --profile web
```

Open **Settings → 网络搜索** (**Web search** in the English locale), select an engine, enter its required key or URL, and save. Engine changes apply to the next search without another restart.

## Engines

| Engine | Default base URL | Required configuration |
|---|---|---|
| Tavily | `https://api.tavily.com` | `TAVILY_API_KEY` |
| Brave Search | `https://api.search.brave.com` | `BRAVE_API_KEY` |
| SearXNG | None | Private instance base URL |

The initial engine is unselected, so the pinned provider is unavailable until an engine is configured. SearXNG has no public default: use a private instance you operate or trust, and enable JSON responses in its settings. Searches request `format=json`; a 403 response usually means the instance does not allow `format: json`.

## Configuration and secrets

| Data | Default location |
|---|---|
| Engine selection and base URLs; no secret values | `$DSH_HOME/web-search/config.json` |
| Fallback key storage | `$DSH_HOME/web-search/secrets.yaml` |
| Key references | `TAVILY_API_KEY`, `BRAVE_API_KEY` |

Secret resolution uses the first non-empty value from the mounted `ctx.credentials` service, the private fallback file, then the process environment. Settings writes keys through `ctx.credentials` when it is mounted; otherwise it writes the fallback file. The HTTP API and Settings status expose only whether each key is configured, never its value.

If no Host webserver is mounted, the provider still supports headless searches, but the Settings UI and management HTTP routes are unavailable. Configure the same catalog and secret locations before starting that composition.

## Runtime behavior

The bundle pins `web.searchProvider` to `dsh-web-search`. DeepSeek's `deepseek-official` provider remains installed but is unused while that pin is active; an unavailable wrapper does not silently fall back to it.

The Host management API serves:

- `GET` and `PUT /web-search/config`
- `GET` and `PUT /web-search/secrets`

Secret writes are write-only; omitted or empty values leave existing keys unchanged.

## Restore DeepSeek search

Put this exact layer in the Web profile patch at `$DSH_HOME/profiles/web/cordis.patch.yml`:

```yaml
- id: web
  config:
    searchProvider: deepseek-official
```

Restart the Web profile. A patch row replaces the complete `web` config, so add any other required `web` config keys to the same mapping.

## Troubleshooting

- **`WEB_PROVIDER_CONFIGURED_UNAVAILABLE`:** Select an engine. For SearXNG, also provide a valid absolute private-instance URL. There is no automatic DeepSeek fallback.
- **Missing Tavily or Brave key:** Set the matching key in Settings, `ctx.credentials`, the fallback secrets file, or the process environment. The provider can appear available before key resolution, but the search call fails with `WEB_PROVIDER_ERROR` when the key is absent.
- **SearXNG HTTP 403:** Enable JSON output (`format: json`) in the instance settings and confirm you are using your private instance.
- **Corrupt `config.json`:** Host startup fails if `$DSH_HOME/web-search/config.json` exists but is not valid JSON or fails catalog validation (unknown keys, invalid engine, or SearXNG selected without an absolute URL). Delete the file to restore the empty catalog, or fix the JSON. Do not put secrets in this file.

Package-specific exports are listed in [`packages/bundle/README.md`](packages/bundle/README.md).
