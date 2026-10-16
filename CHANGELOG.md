# Changelog

All notable changes to `pi-cliproxyapi-quota` will be documented in this file.

## [0.3.3] - 2026-10-16

### Added
- Supported latest CLI proxy version: EasyCLIProxyAPI App v0.3.41, Core v8.0.31.
- Supported new model `gemini-4-argon-high` with dedicated weekly quota window handling.
- Added Argon routing in `providerFromModel` and model-specific window filtering in `filterWinsForModel`.

### Fixed
- Fixed Antigravity quota retrieval: queries both production (`cloudcode-pa.googleapis.com`) and daily (`daily-cloudcode-pa.googleapis.com`) CloudCode endpoints, merging all quota groups (Gemini Models, Claude and GPT models, Argon) and keeping the most restrictive/accurate fraction so no model group is dropped.
- Fixed provider detection to prioritize explicit `antigravity` / `gemini` providers over model IDs (e.g. Antigravity Claude/GPT models).
