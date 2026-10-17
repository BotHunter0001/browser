# CineSphere Browser - Verified Issues & Fix Plan

## Baseline Status (Before Fixes)
- ✅ npm test: 3/3 tests passing
- ✅ npm run build: Successful (Tailwind CSS compiled)
- ✅ npm run lint: No errors
- ⚠️ Browserslist data outdated (non-critical)

## Critical Severity Fixes

### [BUG-001] Stremio Cinemeta Search Protocol Violation
**File:** addons.js:31
**Status:** VERIFIED - URL format incorrect
**Fix:** Change query parameter to path segment format
```javascript
// Before: ${this.base}/catalog/${cat.type}/${cat.id}.json?search=${query}
// After:  ${this.base}/catalog/${cat.type}/${cat.id}/search=${query}.json
```
**Risk:** Low - isolated change
**Test:** Verify search returns correct results

## High Severity Fixes

### [BUG-002] Number(null) === 0 in Season Parser
**File:** lib/seasonParser.js:95-103
**Status:** VERIFIED - parseSeasonNumber coerces null to 0
**Fix:** Add null/undefined guard before Number() conversion
**Risk:** Low - defensive programming
**Test:** parseSeasonNumber(null, "Season 1", 0) should return 1

### [BUG-003] server.maxHeadersCount = 20 Breaks Video Seeking
**File:** server.js:928
**Status:** VERIFIED - artificially restrictive
**Fix:** Increase to 100 or remove limit
**Risk:** Low - increases from 20 to sensible default
**Test:** Send request with 25 headers including Range header

### [BUG-004] Unified Catalog Returns 0 Items
**File:** providers.js:789-920
**Status:** VERIFIED - all branches skip when provider === 'all'
**Fix:** Allow targetProvider execution for 'all' requests
**Risk:** Medium - requires careful conditional logic changes
**Test:** getCatalogHomepage('all', '', 1, null) should return items

### [SEC-001] Missing Test Coverage
**Status:** VERIFIED - only 3 tests exist
**Fix:** Add test suites for critical modules
**Priority:** High but time-intensive
**Defer:** Phase 2

## Medium Severity Fixes

### [BUG-005] Empty Search Results Cached for 10 Minutes
**File:** server.js:308
**Status:** VERIFIED
**Fix:** Add length check to shouldCache predicate
```javascript
(value) => value.complete && Array.isArray(value.results) && value.results.length > 0
```

### [BUG-006] Uncleaned Timeout Timers in VegaAdapter
**File:** vegaAdapter.js:85, 140, 192
**Status:** VERIFIED - setTimeout not cleared
**Fix:** Store timer handle and clear in finally block
**Risk:** Low - improves resource cleanup

### [BUG-007] HLS URI Resolution Drops Query Parameters
**File:** server.js:744, 763
**Status:** VERIFIED - string slicing instead of URL parsing
**Fix:** Use `new URL(uri, targetUrl).toString()`
**Risk:** Low - standard URL resolution

### [SEC-002] Unescaped posterUrl in HTML Templates
**File:** public/app.js:1204, 935, 1024
**Status:** VERIFIED - XSS risk
**Fix:** Apply escapeHtml() to posterUrl
**Risk:** Low - consistent with existing escaping

### [SEC-003] DNS Rebinding TOCTOU in safeFetch
**File:** lib/netGuard.js:100-125
**Status:** VERIFIED - architectural issue
**Fix:** Complex - requires pinned DNS resolution
**Priority:** Defer to Phase 2 (requires significant refactoring)

## Low Severity Fixes

### [BUG-008] NaN Year from "2008-" String
**File:** addons.js:40, 65, 108
**Status:** VERIFIED
**Fix:** Extract year with regex before Number()
**Risk:** Low

### [BUG-009] One-Way Title Matching
**File:** providers.js:749
**Status:** VERIFIED
**Fix:** Check bidirectional substring match

### [DEAD-001] Unused adapt.js
**File:** adapt.js (entire file)
**Status:** VERIFIED - zero references
**Fix:** Safe to delete
**Risk:** None

### [DEAD-002] Unwired Gateway Session & Host Rotation
**File:** server.js:96-117, public/app.js
**Status:** VERIFIED - HTML elements don't exist
**Fix:** Remove dead frontend code
**Risk:** Low

### [DEAD-003] Dead Quick Chips Event Listeners
**File:** public/app.js:2480-2487
**Status:** VERIFIED
**Fix:** Remove orphaned code

### [DEAD-004] Legacy providerSelect Code
**File:** public/app.js:47, 2753-2788
**Status:** VERIFIED
**Fix:** Remove obsolete dropdown code

### [PERF-001] Redundant Anime Provider Queries
**File:** providers.js:22-52, 436
**Status:** VERIFIED
**Fix:** Deduplicate hiAnime sub-providers

### [PERF-002] Dynamic require() in Hot Paths
**File:** server.js:442-443, vegaAdapter.js:231
**Status:** VERIFIED
**Fix:** Hoist to module scope

### [CONF-001] Documentation vs. Default Mismatch
**File:** docs/architecture.md, .env.example
**Status:** VERIFIED
**Fix:** Update documentation, remove duplicate HOST line

### [CONF-002] Phantom Gemini Capability
**File:** metadata.json:5
**Status:** VERIFIED
**Fix:** Remove non-existent capability

## Fix Execution Order

### Phase 1: Critical & High (Immediate)
1. ✅ BUG-001 - Stremio search URL format
2. ✅ BUG-002 - Season parser null handling
3. ✅ BUG-003 - maxHeadersCount limit
4. ✅ BUG-004 - Unified catalog logic
5. ✅ BUG-005 - Empty search cache
6. ✅ BUG-008 - NaN year parsing

### Phase 2: Medium Priority
7. ✅ BUG-006 - Timeout cleanup
8. ✅ BUG-007 - HLS URI resolution
9. ✅ BUG-009 - Title matching
10. ✅ SEC-002 - posterUrl escaping
11. ✅ PERF-002 - Hoist requires

### Phase 3: Cleanup & Optimization
12. ✅ DEAD-001 - Delete adapt.js
13. ✅ DEAD-002 - Remove gateway dead code
14. ✅ DEAD-003 - Remove quick chips code
15. ✅ DEAD-004 - Remove providerSelect code
16. ✅ PERF-001 - Deduplicate anime queries
17. ✅ CONF-001 - Fix documentation
18. ✅ CONF-002 - Remove phantom capability

## Deferred to Future
- SEC-001: Comprehensive test suite (requires significant time)
- SEC-003: DNS pinning architecture (requires significant refactoring)
