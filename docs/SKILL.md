# Specialized Engineering Workflows

## Adding or Changing a Provider

1. Decide whether the integration belongs in a native root module or in the Vega adapter system. Check the closest maintained implementation before choosing.
2. Native integrations are registered in `providers.js` and expose `search(query)`, `details(id)`, and `streams(id)` on the registered instance. Follow neighboring modules such as `addons.js` or `fourkdhhub.js` for timeout and error conventions.
3. Vega integrations are loaded from `vega-manifest.json`. Provider modules are under `vega-dist/<provider-id>/`; the adapter calls `getSearchPosts` (or `getPosts`), `getMeta`, and `getStream` with `providerContext` and, where applicable, an abort signal.
4. Search items should carry stable `subjectId`, human-readable `title`, `type` (`movie` or `series`), and provider identity; include `year` and `poster` when available.
5. Details should retain the selected provider's ID and expose normalized metadata. For series, use the existing season/episode shape: season number and episodes with episode number, title, and `streamId`.
6. Stream results should expose releases with quality and a `mirrors` array. Each mirror should use `label`, `resolverUrl`, and optional `directFile`, `headers`, `signCookie`, or subtitle metadata as appropriate.
7. Ensure one provider's timeout, malformed response, or outage does not fail unified search. Do not silently change provider IDs or rely on cross-provider fallback for native IDs.

## API and Network Safety

- Keep routing, validation, caching, rate limiting, and response contracts in `server.js` and `providers.js` unless an existing abstraction owns the behavior.
- Use `safeFetch` for URLs supplied to the server's proxy endpoints. It permits only HTTP(S), rejects URL credentials, resolves hosts, blocks loopback/link-local/multicast destinations, and revalidates redirects.
- Provider-specific scrapers use different upstream clients. Follow their established request context and timeouts; do not describe them as automatically protected by `safeFetch`.
- The private-address exception is enabled by default for BDIX sources. Treat changing `ALLOW_PRIVATE_NETWORKS` or server exposure as a security-relevant behavior change.
- For proxy streams, preserve `Range` support, relevant response headers, abort-on-client-disconnect, and backpressure-aware piping.
- Preserve the JSON error contract `{ "error": "..." }` for JSON endpoints. Do not convert media responses into JSON errors after streaming has begun.
- Keep proxy header forwarding restricted to the existing allowlist; validate lengths and reject CR/LF in client-provided header values.

## Frontend Safety and UX

- Keep HTML structure, browser behavior, and styling in `public/index.html`, `public/app.js`, and `public/style.css` respectively.
- Preserve the static frontend and existing Tailwind CDN/hls.js usage unless the task specifically calls for a larger frontend architecture change.
- Escape provider text before interpolating it into HTML. Keep arbitrary source URLs and header objects out of HTML attributes; use the existing in-memory mirror index/event-delegation pattern.
- Maintain loading, empty, error, and failed-source states when changing search or playback workflows.
- HLS playback is routed through `/api/proxy-hls` so nested playlists and segment requests can be rewritten; do not bypass that path without accounting for CORS and relative URLs.

## Validation and Documentation

- Run `npm run lint` and `npm run build` after JavaScript changes. The current build script is only a placeholder success check, and no test script is configured.
- For route changes, verify request validation, success/error payloads, and relevant cache/rate-limit behavior. For provider changes, verify the common model consumed by the UI.
- Update `docs/architecture.md` when changing runtime flow, configuration, or API contracts; update `docs/PRD.md` only when product scope or user-visible behavior changes.