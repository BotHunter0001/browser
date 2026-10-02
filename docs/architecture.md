# System Architecture

## Tech Stack

- Frontend: static HTML, CSS, and browser JavaScript in `public/`; Tailwind CSS is loaded from its CDN.
- Backend: Node.js with Express, using CommonJS modules.
- Data storage: none; API caches and rate-limit state are held in process memory.
- Authentication: none.
- External integrations: registered provider adapters and guarded HTTP requests through Axios/fetch utilities.

## Request Flow

1. The Express app in `server.js` serves `public/` and exposes the JSON API and media proxy routes.
2. API routes validate inputs, apply rate limits, and use in-memory TTL caches where configured.
3. `providers.js` coordinates provider registration, search, details, and stream lookup; provider implementations live in root-level adapter files and under `vega-dist/`.
4. `lib/` contains shared cache, media normalization, network guard, and season parsing utilities.
5. The browser UI in `public/app.js` calls the API and renders results, details, and playback controls; `public/style.css` contains custom styling.

# System Architecture

## Technology and Runtime

- Runtime: Node.js with CommonJS modules.
- HTTP server: Express 5; `server.js` serves the static app and JSON/media routes.
- Browser UI: plain HTML/CSS/JavaScript. Tailwind CSS and hls.js are loaded from CDNs; `public/style.css` supplies custom styles. There is no frontend compile step.
- Integrations: Axios, native `fetch`, Cheerio, native provider classes, and dynamically loaded Vega modules.
- Persistence: none. Caches, rate-limit counters, and the Vega `kvStore` are process-local memory.
- Authentication: none. The API is not scoped to users.

## Runtime Flow

1. `server.js` binds to `HOST`/`PORT`, applies basic security headers and JSON body limits, then serves `public/`.
2. The browser code in `public/app.js` calls the API for provider lists, search, details, episodes, and sources.
3. `providers.js` owns the registry and orchestrates parallel search, provider-priority sorting, details, and stream fallbacks.
4. Native provider classes and `VegaAdapter` translate provider-specific data into the shared catalog, details, and release shapes consumed by the UI.
5. Media endpoints fetch/probe upstream resources using `safeFetch`, then stream or transform the response for browser playback, download, HLS, subtitles, or posters.

## Component Map

| Path | Responsibility |
| --- | --- |
| `server.js` | Express configuration, validation, rate limits, caches, API routes, proxies, shutdown handling. |
| `providers.js` | Registry, genre normalization, search ordering, and details/stream/episode fallback orchestration. |
| `adapt.js`, `addons.js`, `circleftp.js`, `dhakaflix.js`, `fourkdhhub.js` | Native provider and compatibility integrations. |
| `vega-manifest.json` | Vega provider IDs, names, categories, and enabled/disabled flags. |
| `vegaAdapter.js` | Loads per-provider Vega modules and normalizes search, metadata, and stream results. |
| `vegaContext.js` | Shared Axios/Cheerio/header/key-value context passed to Vega modules; seeds local base URLs. |
| `vega-dist/<provider-id>/` | Vega `posts.js`, `meta.js`, `stream.js`, optional `episodes.js`, and optional catalog/settings modules. |
| `vega-dist/providerContext.js` | Bundled provider runtime support; treat as generated/vendor-like code and avoid unrelated edits. |
| `lib/cache.js` | Bounded TTL cache with LRU refresh and in-flight request de-duplication. |
| `lib/netGuard.js` | Validates proxy destinations and revalidates redirect hops before server-side fetches. |
| `lib/mediaUtils.js` | Shared media field parsing, result mapping, and deduplication helpers. |
| `lib/seasonParser.js` | Standalone season/episode normalizer with optional episode-link expansion and language-variant merging; no current imports were found outside this module. |
| `public/index.html` | Static UI structure and CDN dependencies. |
| `public/app.js` | Search/detail/source workflows, filtering, playback controls, HLS, and provider fallback UI. |
| `public/style.css` | Custom UI styles. |
| `index.js` | CLI multi-provider search; query is the first argument and defaults to `Inception`. |
| `docs/` | Agent notes, product requirements, and architecture documentation. |

## Provider Registry and Fallback Rules

- Native providers are instantiated directly in `providers.js`. Vega providers are loaded from `vega-manifest.json`; disabled entries are normally excluded, with `movieBoxWeb` explicitly force-enabled when available.
- The registry key is the API-facing provider ID. Preserve it across search result, details, and stream requests.
- Search across providers uses `Promise.allSettled` and a per-provider timeout. Individual failures are logged and contribute no results; they do not fail the entire search.
- Results are stably sorted by a selected genre priority list, or by the default list. Query text can infer a genre if no explicit genre is provided. `movieBoxWeb` is first in each configured list.
- Details/source fallback is restricted to Vega-compatible link-style IDs (root-relative paths or non-Stremio URLs). Native IDs such as Stremio IDs are provider-specific and are not interchangeable.
- `getStreams` attempts the requested provider first, then a bounded number of eligible fallbacks if the result count does not exceed `minSources`.

## Shared Data Contracts

### Search Item

```json
{
	"subjectId": "provider-specific-id-or-link",
	"title": "Example title",
	"year": 2024,
	"poster": "https://example.invalid/poster.jpg",
	"type": "movie",
	"provider": "providerId",
	"providerDisplayName": "Provider name"
}
```

Optional fields may be absent or null. `type` is normalized for the UI to `movie` or `series`.

### Details and Episodes

Details extend a search item with optional `description`, `genres`, `duration`, `rating`, and `seasons`. A season carries `seasonNumber`, `title`, `episodeCount`, and `episodes`; an episode carries `episodeNumber`, `title`, and a provider `streamId` (or a compatible `link`). Providers can have incomplete episode metadata.

### Releases and Mirrors

A release can include `provider`, `filename`, `quality`, `codec`, `language`, `sizeBytes`, `season`, `episode`, and `mirrors`. A mirror uses `label` and `resolverUrl`, with optional `directFile`, `isDash`, `headers`, `signCookie`, and subtitle metadata. The UI stores mirror objects in memory and refers to them from rendered controls by an integer index rather than embedding arbitrary source URLs in attributes.

## HTTP API

All API routes are same-origin with the browser UI. JSON route failures generally return `{ "error": "message" }`; stream/proxy routes may return upstream media or plain-text errors.

| Method and path | Inputs | Purpose and response |
| --- | --- | --- |
| `GET /api/health` | None | `{ "ok": true }`; process health only. |
| `GET /api/session` | None | Provider count and placeholder host/token fields; not real authentication/session state. |
| `POST /api/hosts/rotate` | None | Stub returning `{ "ok": true }`; no gateway rotation currently occurs. |
| `GET /api/providers` | None | `{ providers, count }`, with IDs, display names, category/type, Vega flag, and disabled state. |
| `GET /api/search` | `q` or `query`; optional `provider`, `genre` or `type` | `{ query, provider, genre, count, results }`. Query is trimmed and capped at 200 characters. Genre priorities include movies, anime, drama, Hollywood, and Bollywood plus aliases. |
| `GET /api/details/:id` | Optional `provider` | Normalized title details. IDs are capped at 500 characters. |
| `GET /api/streams/:id` | Optional `provider`, `minSources` (0-10), `maxFallbacks` (0-15) | `{ subjectId, provider, count, releases }`; source lookup and fallback. |
| `POST /api/episode-streams` | JSON `{ title, season, episode, candidates }` | Resolves matching series candidates and returns a provider/stream ID and releases, or an empty release result. Candidate input is capped at 20. |
| `GET /api/play/:id` | Optional `provider` | Backward-compatible alias for stream lookup. |
| `GET /api/resolve-source` | Required `id`; optional `provider` | Probes candidate mirrors and returns a working `source` and up to five alternatives, or 404 when none respond. |
| `GET /api/proxy-video` | Required `url`; optional `cookie`, JSON `headers`; forwards client `Range` | Streams an upstream media response with range-related headers and client-disconnect cancellation. |
| `GET /api/download` | Required `url`; optional `filename`, `cookie`, JSON `headers` | Proxies an upstream response with an attachment filename. |
| `GET /api/proxy-hls` | Required `url`; optional `cookie` | Rewrites playlist, segment, and key URIs to proxy routes for browser HLS playback. |
| `GET /api/subtitle` | Required `url` | Fetches a subtitle and converts SRT-like text to WebVTT when required. |
| `GET /api/poster` | Required `url` | Fetches and briefly caches an image response for browser display. |

Unknown `/api/*` paths return JSON 404. Other unmatched paths serve `public/index.html` as a fallback.

## Caching, Limits, and Timeouts

- Search cache: 10 minutes, maximum 300 keys.
- Details cache: 30 minutes, maximum 500 keys.
- Stream cache: 3 minutes, maximum 300 keys.
- Poster cache: 10 minutes, maximum 500 keys.
- `TTLCache` refreshes LRU order on reads, evicts the oldest entry at capacity, coalesces concurrent loads for a key, and does not store empty arrays.
- Search requests are limited to 60 per minute per limiter key. Stream/source lookup route families are configured for 40 per minute per limiter key. All limiter state is in memory.
- Provider calls have provider-level and/or orchestration-level timeouts; a timeout from one search provider is isolated from other providers.

## Network Safety and Deployment

- `safeFetch` accepts only HTTP(S), rejects URLs with embedded credentials, resolves destination addresses, and blocks loopback, link-local, unspecified, and multicast addresses. It revalidates each redirect hop and caps redirect count.
- `ALLOW_PRIVATE_NETWORKS` defaults to true so BDIX/private-network providers can work. Setting it to `false` also blocks private ranges. This tradeoff is security-sensitive: the application has no authentication, so keep it on localhost or a trusted network. Do not expose it to untrusted users with private-network access enabled.
- Proxy-supplied headers are restricted to `referer`, `origin`, `cookie`, `user-agent`, `authorization`, `accept`, and `accept-language`, with value length and CR/LF checks.
- Media proxying preserves backpressure, forwards byte-range metadata, and aborts upstream requests when the client disconnects.
- Security headers include `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and `X-Frame-Options: DENY`. The JSON body limit is 100 KB.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port. |
| `HOST` | `127.0.0.1` | Bind address. Set explicitly to `0.0.0.0` to expose on network interfaces. |
| `ALLOW_PRIVATE_NETWORKS` | Enabled unless set to `false` | Allow private destination ranges for proxy requests; required by some BDIX integrations. |
| `FOURKDH_BASE` | Defined in `fourkdhhub.js` | Override the 4KHDHub upstream base URL. |
| `MOVIEBOX_SECRET` | Empty in `.env.example` | Listed in the template but not referenced by current JavaScript source; setting it has no demonstrated runtime effect. |

The project does not load `.env` automatically. Export variables in the process environment or use deployment tooling that supplies them.

## Development and Validation

- `npm run dev`: start the server in development.
- `npm start`: start the same `server.js` entry point.
- `npm run cli -- "Title"`: run CLI search.
- `npm run lint`: run the configured ESLint file globs.
- `npm run build`: currently prints a readiness message only; it does not compile or bundle assets.
- No automated test command is configured in `package.json`.

## Repository Layout

```text
.
|-- docs/                         # Project guidance, PRD, and architecture
|   |-- AGENTS.md
|   |-- CLAUDE.md
|   |-- PRD.md
|   |-- SKILL.md
|   `-- architecture.md
|-- lib/                          # Shared server utilities
|-- public/                       # Static browser UI
|-- vega-dist/<provider-id>/      # Vega provider modules
|-- *.js                          # Server, registry, adapters, and CLI
|-- vega-manifest.json            # Provider registry metadata
|-- vega-urls.json                # Local upstream base URL map
|-- package.json                  # Dependencies and scripts
`-- .env.example                  # Environment variable template
```