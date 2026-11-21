// Netlify Server entrypoint: runs the existing Express app from server.js,
// which listens on process.env.PORT (set by Netlify before this file loads).
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

// The deployed code directory is read-only, so keep in-progress downloads in
// the writable temp directory unless DOWNLOAD_DIR is configured explicitly.
process.env.DOWNLOAD_DIR ??= path.join(os.tmpdir(), 'downloads')

// Load server.js with require() rather than import so it is shipped as-is
// instead of being bundled into this file: it resolves public/, vega-dist/
// and its JSON data files relative to its own __dirname.
const require = createRequire(import.meta.url)
require('../../server.js')
