# Product Requirements Document: CineSphere Browser

## Purpose

CineSphere Browser is a local browser interface for searching configured movie and series metadata providers, comparing matching titles, and inspecting the playback or download sources returned by those providers. It coordinates third-party integrations; it does not own or host provider catalogs or media.

## Users and Use Context

- A user searches by title, optionally selecting a provider or searching across enabled providers.
- The user compares provider, title, year, poster, and media type, then opens a result to inspect details.
- For a movie or episode, the user checks available releases and mirrors, then plays, downloads, or copies a source URL.
- The server is intended for personal or otherwise trusted use. It has no accounts or authorization, and some provider integrations require private-network access.

## Product Requirements

### Search and Discovery

- The user can search using a title and choose all providers or one provider from the dynamic registry.
- Unified search tolerates an individual provider failing and returns results from providers that responded.
- Results are ordered by a default or genre-specific provider priority; MovieBox Web is pinned to the top when present.
- The user can filter the displayed result set to all types, movies, or series.
- Each result identifies its provider and shows available year/poster metadata. Missing optional metadata must not prevent the result from being opened.

### Details and Series Navigation

- Selecting a result opens its title details, including available description, year, poster, genres, rating, and media type.
- Series details can expose season and episode links. Episode metadata may include audio/language variants; unavailable episode structure is represented as unavailable rather than invented.
- Details are routed using the selected result's provider ID. A compatible alternate Vega provider may be tried when a link-style ID fails.

### Playback and Downloads

- Users can request releases for a title or episode and see the provider, quality, format/codec, and mirrors returned by integrations.
- The UI can play a selected mirror, download it through the server, or copy the source URL for an external player.
- Playback defaults to the server proxy for compatibility, with a direct-play toggle. HLS playlists and their segment/key URLs are rewritten through the HLS proxy. hls.js is served locally so playback does not depend on a CDN.
- The browser player includes play/pause, seek, volume, mute, playback speed, captions, sleep timer, auto-next preference, picture-in-picture, fullscreen, fill/fit mode, and keyboard shortcuts (Space/K, J/L, arrows, M, F, P, C, A, S). Volume and fill preference persist locally.
- When a source fails, the client asks the server to probe alternative sources and retries with a working result. Probes validate real media bytes and HLS structure, not just HTTP 200.
- Torrent-style (magnet/acestream) mirrors are native-only and are not exposed as web play/download actions.
- Proxies support range requests where the upstream supports them, so seeking and large downloads do not require buffering the full response in memory.

### Operational Feedback

- Search, detail, and source workflows show loading, empty, and error states.
- The provider selector is populated from `/api/providers`; displayed provider counts are derived from the registry.
- The health endpoint reports process-level availability, not the availability of every provider.

## Acceptance Criteria

- An empty search query is rejected by the API with an actionable client error.
- Unified search still returns a response when some providers time out or fail.
- Results preserve provider identity through detail and source requests.
- An unavailable primary source does not prevent compatible fallback providers from being queried.
- Proxy routes reject missing/invalid URLs and do not allow loopback or link-local destinations.
- The UI can represent no results, missing metadata, missing episode links, no stream sources, and provider failures without treating them as successful media.

## Constraints and Known Limitations

- Provider sites and APIs are external and may change, block requests, or be unavailable; there is no uptime or source-validity guarantee.
- Provider result quality and metadata completeness vary. Unified search is best-effort, and provider-priority ordering is not a relevance guarantee.
- Application caches, rate-limit counters, and Vega key/value state are in memory only and reset when the process stops. Watch history/watchlist live in browser storage; download files and metadata persist on disk under `DOWNLOAD_DIR`.
- There is no authentication or per-user state. The default server bind is localhost; exposing it to untrusted networks is not an intended secure deployment configuration.
- `POST /api/hosts/rotate` returns HTTP 501. Session gateway metadata reports `gatewayStatus: "unsupported"`; neither implements token/host rotation.
- Provider availability is external. The download manager requires a persistent writable filesystem, so ephemeral/serverless deployments are unsupported.
- `npm test`, `npm run lint`, and `npm run build` are the current verification commands. The build has a tooling-only Browserslist warning.

## Out of Scope

- User accounts, authentication, profiles, or durable server-side user state.
- A database or shared multi-instance state.
- Media hosting, encoding, transcoding, or a server-side media library.
- Native-only capabilities: OS background downloads, cast/remote control, torrent streaming, on-device media scanning, TV focus navigation, and native notifications/updates.
- Guaranteeing third-party provider uptime, source validity, or catalog completeness.
- A new frontend framework, client-side router, or bundling pipeline without a separate product/engineering decision.
- Real gateway rotation or token management until an upstream gateway integration is specified.