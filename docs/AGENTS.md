# Agent Guidelines

## Scope

These project notes describe CineSphere Browser, a Node.js/Express application with a static browser UI and multiple external media-provider adapters. This file is located in `docs/`; agent tooling that scopes `AGENTS.md` by directory may apply it only to files under `docs/`. Put repository-wide instructions in a root-level `AGENTS.md` if that broader scope is required.

## Working Rules

- Inspect the relevant implementation and neighboring provider patterns before changing behavior.
- Verify directory contents before adding files. Make focused edits and preserve unrelated user changes.
- Keep runtime secrets out of source control. `.env.example` is a template; the application does not load `.env` itself.
- Do not represent provider availability, source correctness, or media rights as guaranteed by this application.
- For code changes, run `npm run lint` and `npm run build`. There is no configured automated test script; document that limitation rather than claiming tests ran.
- For documentation-only changes, verify links and commands against the checked-in files and scripts.

## Code Conventions

- Use CommonJS JavaScript and the existing Express structure; the frontend is plain HTML, CSS, and browser JavaScript.
- Keep UI structure in `public/index.html`, behavior in `public/app.js`, and custom styling in `public/style.css`.
- Preserve the provider registry and adapter contract in `providers.js`, `vegaAdapter.js`, and native provider classes.
- Preserve existing API response shapes. JSON API errors generally use `{ "error": "..." }`; proxy routes may return plain text or media data.
- Use `safeFetch` in `lib/netGuard.js` for user-supplied URLs fetched by server proxy routes. Provider integrations also have provider-specific HTTP paths; do not imply those all use `safeFetch`.
- Preserve byte-range forwarding, abort handling, and streaming backpressure in media proxies.

## Validation

- `npm run lint` runs ESLint over root JavaScript files, `lib/**/*.js`, and `public/app.js`.
- `npm run build` currently prints `Build ready`; it is not a bundling or compilation pipeline.
- There is no `npm test` script or checked-in automated test suite configured in `package.json`.