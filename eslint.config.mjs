/**
 * ESLint flat config (ESLint 9+)
 *
 * Two environments:
 *  1. Node.js backend  — server.js, providers.js, *.js root files, lib/
 *  2. Browser frontend — public/app.js
 *
 * Key rules enabled across both:
 *  - no-undef           → catches typos and missing declarations
 *  - no-unused-vars     → catches dead code
 *  - no-implicit-globals → prevents accidental globals (A6 class of bug)
 *  - no-console         → warn only (server logs are intentional)
 */

import js from '@eslint/js';

export default [
  // ── Ignored paths ──────────────────────────────────────────────────────
  {
    ignores: [
      'node_modules/**',
      'vega-dist/**',   // generated/vendored bundles — do not lint
    ],
  },

  // ── Node.js backend files ──────────────────────────────────────────────
  {
    files: [
      '*.js',          // server.js, providers.js, addons.js, fourkdhhub.js, etc.
      'lib/**/*.js',
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        // Node built-ins exposed by the runtime
        require:   'readonly',
        module:    'readonly',
        exports:   'readonly',
        __dirname: 'readonly',
        __filename:'readonly',
        process:   'readonly',
        console:   'readonly',
        setTimeout:'readonly',
        clearTimeout:'readonly',
        setInterval:'readonly',
        clearInterval:'readonly',
        Buffer:    'readonly',
        URL:       'readonly',
        URLSearchParams: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        fetch:     'readonly',
        Promise:   'readonly',
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-undef':           'error',
      'no-unused-vars':     ['warn', { args: 'none', caughtErrorsIgnorePattern: '^_' }],
      'no-implicit-globals': 'error',
      'no-console':         'off',  // intentional server-side logging
    },
  },

  // ── Browser frontend — public/app.js ───────────────────────────────────
  {
    files: ['public/app.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script', // not a module — loaded as plain <script>
      globals: {
        // Standard browser globals
        window:       'readonly',
        document:     'readonly',
        navigator:    'readonly',
        fetch:        'readonly',
        URL:          'readonly',
        URLSearchParams:'readonly',
        AbortController:'readonly',
        AbortSignal:  'readonly',
        Promise:      'readonly',
        console:      'readonly',
        setTimeout:   'readonly',
        clearTimeout: 'readonly',
        setInterval:  'readonly',
        clearInterval:'readonly',
        prompt:       'readonly',
        alert:        'readonly',
        localStorage: 'readonly',
        IntersectionObserver: 'readonly',
        // hls.js is loaded via CDN <script> before app.js
        Hls:          'readonly',
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      // These three rules catch the A6 class of implicit-global bugs that
      // the review identified. They were previously invisible because
      // public/** was entirely excluded from lint coverage.
      'no-undef':            'error',
      'no-unused-vars':      ['warn', { args: 'none', caughtErrorsIgnorePattern: '^_' }],
      'no-implicit-globals': 'error',
      'no-console':          'off',
    },
  },
];
