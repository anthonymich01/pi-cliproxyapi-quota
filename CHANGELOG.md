# Changelog

All notable changes to `pi-cliproxyapi-quota` will be documented in this file.

## [0.3.6] - 2026-10-17

### Fixed
- Fixed unthrottled quota polling during agentic tool use: removed `turn_end` listener so multi-step agent runs do not trigger quota fetches on every tool execution cycle. Quota polling strictly occurs on the fixed 3-minute interval (`startRefreshInterval`), on session start (`session_start`), model select (`model_select`), and manual command/shortcut invocations (`/quota` and `ctrl+shift+q`).
- Added timestamp throttle to background quota refreshes so background requests never execute more frequently than `REFRESH_INTERVAL_MS` (3 minutes).

## [0.3.5] - 2026-10-17

### Fixed
- Fixed Antigravity 7-day quota not updating: switched `ANTIGRAVITY_UA` to the Antigravity Hub User-Agent (`antigravity/hub/2.23.0 ...`), ensuring daily CloudCode endpoints return live `Gemini Models` weekly quota instead of omitting it.
- Prioritized daily CloudCode endpoints (`daily-cloudcode-pa.googleapis.com`, `daily-cloudcode-pa.sandbox.googleapis.com`) ahead of production in `ANTIGRAVITY_HOSTS`.
- Added `turn_end` listener in extension registration to immediately refresh the footer quota on assistant turn completion without waiting for the 3-minute poll interval.
- Ensured `startRefreshInterval` and background polling maintain `currentCtx` cleanly.

## [0.3.4] - 2026-10-16

### Fixed
- Fixed Antigravity Gemini 5-hour quota showing 100% left: query `POST /v1internal:fetchAvailableModels` across CloudCode endpoints to retrieve live per-model quota (`quotaInfo.remainingFraction` and `quotaInfo.resetTime`) and merge the most restrictive window and active reset countdown into the quota summary.

## [0.3.3] - 2026-10-16

### Added
- Supported latest CLI proxy version: EasyCLIProxyAPI App v0.3.41, Core v8.0.31.
- Supported new model `gemini-4-argon-high` with dedicated weekly quota window handling.
- Added Argon routing in `providerFromModel` and model-specific window filtering in `filterWinsForModel`.

### Fixed
- Fixed Antigravity quota retrieval: queries both production (`cloudcode-pa.googleapis.com`) and daily (`daily-cloudcode-pa.googleapis.com`) CloudCode endpoints, merging all quota groups (Gemini Models, Claude and GPT models, Argon) and keeping the most restrictive/accurate fraction so no model group is dropped.
- Fixed provider detection to prioritize explicit `antigravity` / `gemini` providers over model IDs (e.g. Antigravity Claude/GPT models).
