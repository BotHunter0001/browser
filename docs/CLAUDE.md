# Claude Development Preferences

## Commands

| Task | Command | Notes |
| --- | --- | --- |
| Development server | `npm run dev` | Runs `node server.js`; defaults to `127.0.0.1:3000`. |
| Start server | `npm start` | Runs the same entry point as development. |
| CLI search | `npm run cli -- "Dune"` | Searches providers and prints up to 15 results; defaults to `Inception`. |
| Lint | `npm run lint` | ESLint; the current baseline may include warnings. |
| Build check | `npm run build` | Currently prints `Build ready`; no frontend compilation occurs. |
| Tests | Not configured | `package.json` has no test script. |

## Verified Project Behavior

- CommonJS Node.js application. Express serves `public/` directly; there is no frontend framework, database, or authentication layer.
- `providers.js` registers native providers and dynamically loads enabled Vega providers from `vega-manifest.json` and `vega-dist/`.
- Unified search runs enabled providers concurrently, tolerates individual failures, then sorts by provider priority. Explicit provider search targets that provider when it exists in the registry.
- Details and source lookup can try alternate Vega providers for link-style IDs. Native provider IDs are not treated as interchangeable.
- Search, details, streams, and poster data use process-local TTL caches. Cache state is lost on restart and is not shared across processes.
- API errors generally use `{ "error": "..." }`; media proxy endpoints can return upstream content or plain-text failures.

## Configuration and Cautions

- Set `PORT` and `HOST` in the process environment. The server does not load `.env` automatically.
- `ALLOW_PRIVATE_NETWORKS` defaults to allowing private network destinations for BDIX integrations. Loopback, link-local, and other explicitly blocked ranges remain blocked. The option is security-sensitive when exposing the server beyond a trusted machine or network.
- `FOURKDH_BASE` overrides the 4KHDHub base URL; its default is defined in `fourkdhhub.js`.
- `.env.example` is the maintained environment template. Do not add credentials or private tokens to documentation or source.
- Proxy URLs supplied by clients must continue through `safeFetch`; do not add arbitrary server-side fetch endpoints without equivalent URL validation.