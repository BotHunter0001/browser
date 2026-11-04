# System Architecture

## Technology and Runtime

- Runtime: Node.js with CommonJS modules.
- HTTP server: Express 5; `server.js` serves the static app and JSON/media routes.
- Browser UI: plain HTML/CSS/JavaScript. Tailwind is built into `public/tailwind.css`; hls.js 1.7.4 is vendored at `public/vendor/hls.min.js` with SRI. `public/style.css` supplies custom styles. There is no frontend bundling framework.
- Integrations: Axios, native `fetch`, Cheerio, native provider classes, and dynamically loaded Vega modules.
- Persistence: caches, rate-limit counters, and the Vega `kvStore` are process-local memory. Completed and in-progress download files plus their metadata are persisted under `DOWNLOAD_DIR` (default `./downloads`); Serverless hosting with an ephemeral filesystem is not suitable for the download manager.
- Authentication: none. The API is not scoped to users.

## Runtime Flow

1. `server.js` binds to `HOST`/`PORT`, applies basic security headers and JSON body limits, then serves `public/`.
2. The browser code in `public/app.js` calls the API for provider lists, search, details, episodes, and sources.
3. `providers.js` owns the registry and orchestrates parallel search, provider-priority sorting, details, and stream fallbacks.
4. Native provider classes and `VegaAdapter` translate provider-specific data into the shared catalog, details, and release shapes consumed by the UI.
5. Media endpoints fetch/probe upstream resources using `safeFetch`, then stream or transform the response for browser playback, download, HLS, subtitles, or posters. `lib/mediaProbe.js` validates media bytes (HTML pages, images, and invalid HLS are rejected) and detects HLS even when URLs have no extension or segments are mislabeled.

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
| `lib/netGuard.js` | Validates proxy destinations and revalidates redirect hops before server-side fetches; allows public NAT64/6to4 while rejecting embedded private IPv4. |
| `lib/mediaProbe.js` | Probes playable bytes, rejects challenge/HTML/image responses, and distinguishes direct media from HLS. |
| `lib/downloads.js` | Disk-backed download queue with pause/resume/cancel, metadata persistence, and safe file serving. |
| `lib/mediaUtils.js` | Shared media field parsing, result mapping, and deduplication helpers. |
| `lib/seasonParser.js` | Standalone season/episode normalizer with optional episode-link expansion and language-variant merging; no current imports were found outside this module. |
| `public/index.html` | Static UI structure and local script dependencies. |
| `public/app.js` | Search/detail/source workflows, filtering, browser player controls (volume, fill/fit, PiP, keyboard shortcuts), library/downloads, HLS, and provider fallback UI. |
| `public/style.css` | Custom UI styles. |
| `public/vendor/hls.min.js` | Vendored hls.js 1.7.4 (Apache-2.0) with matching SRI. |
| `index.js` | CLI multi-provider search; query is the first argument and defaults to `Inception`. |
| `docs/` | Agent notes, product requirements, and architecture documentation. |

## Provider Registry and Fallback Rules

- Native providers are instantiated directly in `providers.js`. Vega providers are loaded from `vega-manifest.json`; disabled entries are normally excluded, with `movieBoxWeb` explicitly force-enabled when available.
- The registry key is the API-facing provider ID. Preserve it across search result, details, and stream requests.
- Search across providers uses `Promise.allSettled` and a per-provider timeout. Individual failures are logged and contribute no results; they do not fail the entire search.
- Results are stably sorted by a selected genre priority list, or by the default list. Query text can infer a genre if no explicit genre is provided. `movieBoxWeb` is first in each configured list.
- Details/source fallback is restricted to Vega-compatible link-style IDs (root-relative paths or non-Stremio URLs). Native IDs such as Stremio IDs are provider-specific and are not interchangeable.
- `getStreams` attempts the requested provider first, then a bounded number of eligible fallbacks if the result count does not exceed `minSources`. Cross-provider title fallback only accepts a title match; it never auto-plays the first unrelated search hit.
- Only HTTP(S) mirrors are returned to the web client. Magnet/acestream-style torrent mirrors are native-only and are filtered out rather than exposed as dead play/download buttons.

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

Details extend a search item with optional `description`, `country`, `genres`, `duration`, `rating`, and `seasons`. Country and year values supplied as provider tags are normalized into their own fields rather than displayed as genres. A season carries `seasonNumber`, `title`, `episodeCount`, and `episodes`; an episode carries `episodeNumber`, `title`, and a provider `streamId` (or a compatible `link`). Providers can have incomplete episode metadata.

### Releases and Mirrors

A release can include `provider`, `filename`, `quality`, `codec`, `language`, `sizeBytes`, `season`, `episode`, and `mirrors`. A mirror uses `label` and `resolverUrl`, with optional `directFile`, `isDash`, `headers`, `signCookie`, and subtitle metadata. The UI stores mirror objects in memory and refers to them from rendered controls by an integer index rather than embedding arbitrary source URLs in attributes.

## HTTP API

All API routes are same-origin with the browser UI. JSON route failures generally return `{ "error": "message" }`; stream/proxy routes may return upstream media or plain-text errors.

| Method and path | Inputs | Purpose and response |
| --- | --- | --- |
| `GET /api/health` | None | `{ "ok": true }`; process health only. |
| `GET /api/session` | None | Provider count and a null host/token with `gatewayStatus: "unsupported"`; there is no real authentication/session state. |
| `POST /api/hosts/rotate` | None | Returns HTTP 501 because no gateway rotation is implemented. |
| `GET /api/providers` | None | `{ providers, count }`, with IDs, display names, category/type, Vega flag, and disabled state. |
| `GET /api/catalog/homepage` | Optional `provider`, `genre` or `type`, `page` (1-50) | `{ ok, provider, count, results, metas }`; catalog results support provider page selection. The all-provider Asian drama catalog combines enabled drama catalogs with MovieBox Web series, then keeps series whose metadata identifies an Asian origin. |
| `GET /api/search` | `q` or `query`; optional `provider`, `genre` or `type`, `page` (1-50) | `{ query, provider, genre, page, hasMore, count, results }`. Query is trimmed and capped at 200 characters. Genre priorities include movies, anime, drama, Hollywood, and Bollywood plus aliases. |
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
- `TTLCache` refreshes LRU order on reads, evicts the oldest entry at capacity, coalesces concurrent loads for a key, and supports skipping empty results (including empty catalog responses) so providers can recover without waiting for a cache expiry.
- Search requests are limited to 60 per minute per limiter key. Stream/source lookup route families are configured for 40 per minute per limiter key. All limiter state is in memory.
- Provider calls have provider-level and/or orchestration-level timeouts; a timeout from one search provider is isolated from other providers.

## Network Safety and Deployment

- `safeFetch` accepts only HTTP(S), rejects URLs with embedded credentials, resolves destination addresses, and blocks loopback, link-local, unspecified, multicast, and special-use addresses. It revalidates each redirect hop and caps redirect count. Public NAT64/6to4 addresses are allowed; private IPv4 addresses embedded in those transition forms remain blocked.
- Residual SSRF limitation: DNS is re-resolved by the actual connection after validation, and provider modules use their own HTTP clients. There is no IP-pinned shared client yet; treat `safeFetch` as strong first-hop mitigation, not complete protection.
- `ALLOW_PRIVATE_NETWORKS` defaults to `false`; private-network destinations (including BDIX integrations) require an explicit `ALLOW_PRIVATE_NETWORKS=true`. Loopback, link-local, multicast, and special-use ranges stay blocked. This tradeoff is security-sensitive: the application has no authentication and is intended to bind only to `127.0.0.1` unless an operator explicitly chooses remote exposure.
- Proxy-supplied headers are restricted to `referer`, `origin`, `cookie`, `user-agent`, `authorization`, `accept`, and `accept-language`, with value length and CR/LF checks.
- Media proxying preserves backpressure, forwards byte-range metadata, and aborts upstream requests when the client disconnects.
- Security headers include `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and `X-Frame-Options: DENY`. The JSON body limit is 100 KB.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port. |
| `HOST` | `127.0.0.1` | Bind address. Use `0.0.0.0` only for intentional, access-controlled remote exposure. |
| `ALLOW_PRIVATE_NETWORKS` | `false` | Set to `true` to allow private destination ranges for approved BDIX integrations. |
| `DOWNLOAD_DIR` | `./downloads` | Writable directory for download files and metadata; requires persistent storage. |
| `FOURKDH_BASE` | Defined in `fourkdhhub.js` | Override the 4KHDHub upstream base URL. |

The project does not load `.env` automatically. `.env.example` is a configuration reference only; export variables in the process environment or use deployment tooling that supplies them.

## Development and Validation

- `npm run dev`: start the server in development.
- `npm start`: start the same `server.js` entry point.
- `npm run cli -- "Title"`: run CLI search.
- `npm test`: run the Node test suite (HTTP contract, media probe, network guard, downloads, provider ranking, and frontend static checks).
- `npm run lint`: run the configured ESLint file globs.
- `npm run build`: rebuild `public/tailwind.css`; a Browserslist `caniuse-lite` warning is tooling-only and does not fail the build.

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