// Live smoke test of the quota data path + pure renderers.
// Run: node test-quota.mjs
import extension, {
	resolveBaseUrl,
	resolveManagementKey,
	collectQuota,
	renderWindows,
	summaryFromWins,
	filterWinsForModel,
	providerFromModel,
	mergeWins,
	parseModelsQuota,
	formatReset,
	compactReset,
	getQuotaColor,
	getResetColor,
	ANTIGRAVITY_UA,
	ANTIGRAVITY_HOSTS,
	ANSI_GREEN,
	ANSI_YELLOW,
	ANSI_ORANGE,
	ANSI_RED,
	REFRESH_INTERVAL_MS,
} from "./index.ts";

// formatReset unit checks
const now = Date.parse("2026-08-19T09:00:00Z");
console.assert(formatReset(null, now) === "—", "null reset");
console.assert(formatReset("2026-08-19T08:00:00Z", now) === "resets now", "past reset");
console.assert(/^resets in /.test(formatReset("2026-08-19T11:50:00Z", now)), "future reset");

// getQuotaColor unit checks (4 thresholds: >75 green, >50 yellow, >25 orange, <=25 red)
console.assert(getQuotaColor(100) === ANSI_GREEN, "quota 100 green");
console.assert(getQuotaColor(76) === ANSI_GREEN, "quota 76 green");
console.assert(getQuotaColor(75) === ANSI_YELLOW, "quota 75 yellow");
console.assert(getQuotaColor(51) === ANSI_YELLOW, "quota 51 yellow");
console.assert(getQuotaColor(50) === ANSI_ORANGE, "quota 50 orange");
console.assert(getQuotaColor(26) === ANSI_ORANGE, "quota 26 orange");
console.assert(getQuotaColor(25) === ANSI_RED, "quota 25 red");
console.assert(getQuotaColor(0) === ANSI_RED, "quota 0 red");

// getResetColor unit checks
// 5h window: <1h is green, >=1h is default (null)
const reset59m = new Date(now + 59 * 60_000).toISOString();
const reset45m = new Date(now + 45 * 60_000).toISOString();
const reset2h1m = new Date(now + 121 * 60_000).toISOString();
console.assert(getResetColor("5h", reset59m, now) === ANSI_GREEN, "5h reset <1h green");
console.assert(getResetColor("5h", reset45m, now) === ANSI_GREEN, "5h reset 45m green");
console.assert(getResetColor("5h", reset2h1m, now) === null, "5h reset >=1h default");

// 7d window: <1h is green, <3d is yellow, >=3d is default (null)
const reset2d1h = new Date(now + (2 * 86400 + 3600) * 1000).toISOString();
const reset1d1h = new Date(now + (86400 + 3600) * 1000).toISOString();
const reset5d18h = new Date(now + (5 * 86400 + 18 * 3600) * 1000).toISOString();
console.assert(getResetColor("7d", reset45m, now) === ANSI_GREEN, "7d reset <1h green");
console.assert(getResetColor("7d", reset2d1h, now) === ANSI_YELLOW, "7d reset <3d yellow");
console.assert(getResetColor("7d", reset1d1h, now) === ANSI_YELLOW, "7d reset <3d yellow");
console.assert(getResetColor("7d", reset5d18h, now) === null, "7d reset >=3d default");

// compactReset unit checks
console.assert(compactReset(reset45m, now) === " ↻ 45m", "compact 45m");
console.assert(compactReset(reset2h1m, now) === " ↻ 2h1m", "compact 2h1m");
console.assert(compactReset(reset1d1h, now) === " ↻ 1d1h", "compact 1d1h");

// renderWindows / summaryFromWins unit checks (plain)
const wins = [
	{ label: "5-hour (session)", remainingPct: 64, resetIso: "2026-08-19T11:50:00Z" },
	{ label: "7-day (weekly)", remainingPct: 95, resetIso: "2026-08-25T03:00:00Z" },
];
console.assert(summaryFromWins(wins, now) === "Quota 5h 64% left ↻ 2h50m · 7d 95% left ↻ 5d18h", "footer plain");
console.assert(renderWindows(wins, now)[0].includes("36% used · 64% left"), "render used/left");

// summaryFromWins with color: true
const coloredSummary = summaryFromWins(wins, now, null, { color: true, labelTag: "[epicshoesid]" });
console.assert(coloredSummary.includes(`${ANSI_YELLOW}64% left`), "colored 64% yellow");
console.assert(coloredSummary.includes(`${ANSI_GREEN}95% left`), "colored 95% green");
console.assert(coloredSummary.includes("Quota[epicshoesid]"), "colored labelTag");

// 100% remaining should NOT display a countdown (avoids sliding resetTime illusion like ↻4h59m)
const fullWins = [
	{ label: "5-hour (session)", remainingPct: 100, resetIso: "2026-08-19T14:00:00Z" },
];
console.assert(summaryFromWins(fullWins, now) === "Quota 5h 100% left", "footer full quota");
console.assert(renderWindows(fullWins, now)[0].includes("100% left · —"), "render full reset");
// rounding hole: 99.96% displays as 100% and must also hide the (sliding) countdown
const nearFull = [
	{ label: "5-hour (session)", remainingPct: 99.96, resetIso: "2026-08-19T14:00:00Z" },
];
console.assert(summaryFromWins(nearFull, now) === "Quota 5h 100% left", "footer near-full quota");

// filterWinsForModel unit checks
const multiGroupWins = [
	{ label: "Gemini Models · 5h", remainingPct: 100, resetIso: "2026-08-19T14:00:00Z" },
	{ label: "Gemini Models · weekly", remainingPct: 90, resetIso: "2026-08-25T00:00:00Z" },
	{ label: "Claude and GPT models · 5h", remainingPct: 100, resetIso: "2026-08-19T14:00:00Z" },
	{ label: "Claude and GPT models · weekly", remainingPct: 80, resetIso: "2026-08-25T00:00:00Z" },
	{ label: "Argon Models · weekly", remainingPct: 50, resetIso: "2026-08-25T00:00:00Z" },
];

// 1. Argon model returns Argon window
const argonResult = filterWinsForModel(multiGroupWins, "gemini-4-argon-high");
console.assert(argonResult.length === 1 && argonResult[0].label === "Argon Models · weekly", "filter argon window");

// 2. Gemini model returns Gemini windows (excluding Argon)
const geminiResult = filterWinsForModel(multiGroupWins, "gemini-2.5-pro");
console.assert(
	geminiResult.length === 2 &&
		geminiResult.every((w) => w.label.startsWith("Gemini Models")),
	"filter gemini windows",
);

// 3. Claude / GPT models return Claude and GPT windows
const claudeResult = filterWinsForModel(multiGroupWins, "claude-3-7-sonnet");
console.assert(
	claudeResult.length === 2 &&
		claudeResult.every((w) => w.label.startsWith("Claude and GPT models")),
	"filter claude windows",
);
const gptResult = filterWinsForModel(multiGroupWins, "gpt-4o");
console.assert(
	gptResult.length === 2 &&
		gptResult.every((w) => w.label.startsWith("Claude and GPT models")),
	"filter gpt windows",
);

// 4. Argon model fallback when no Argon window exists
const multiGroupWithoutArgon = multiGroupWins.filter((w) => !w.label.includes("Argon"));
const argonFallbackResult = filterWinsForModel(multiGroupWithoutArgon, "gemini-4-argon-high");
console.assert(
	argonFallbackResult.length === 2 &&
		argonFallbackResult.every((w) => w.label.startsWith("Gemini Models")),
	"filter argon fallback to gemini",
);

// 5. Unknown or null model picks primary group cleanly (Gemini)
const defaultResult = filterWinsForModel(multiGroupWins, null);
console.assert(
	defaultResult.length === 2 &&
		defaultResult.every((w) => w.label.startsWith("Gemini Models")),
	"filter default primary group",
);

// providerFromModel unit checks
console.assert(
	providerFromModel({ provider: "antigravity", id: "claude-3-5-sonnet" }) === "antigravity",
	"providerFromModel explicit antigravity with claude model",
);
console.assert(
	providerFromModel({ provider: "antigravity", id: "gemini-4-argon-high" }) === "antigravity",
	"providerFromModel antigravity argon",
);
console.assert(
	providerFromModel({ provider: "gemini", id: "gemini-2.5-pro" }) === "antigravity",
	"providerFromModel gemini provider",
);
console.assert(
	providerFromModel({ provider: "google", id: "gemini-4-argon-high" }) === "antigravity",
	"providerFromModel argon in model id routes to antigravity",
);
console.assert(
	providerFromModel({ provider: "anthropic", id: "claude-3-5-sonnet" }) === "claude",
	"providerFromModel anthropic claude",
);
console.assert(
	providerFromModel({ provider: "openai", id: "gpt-4o" }) === "codex",
	"providerFromModel openai gpt",
);

// mergeWins unit checks (keeping more restrictive remaining fraction)
const prodWins = [
	{ label: "Gemini Models · weekly", remainingPct: 91, resetIso: "2026-08-25T00:00:00Z" },
	{ label: "Claude and GPT models · weekly", remainingPct: 100, resetIso: "2026-08-25T00:00:00Z" },
];
const dailyWins = [
	{ label: "Claude and GPT models · weekly", remainingPct: 80, resetIso: "2026-08-24T00:00:00Z" },
];
const merged = mergeWins(prodWins, dailyWins);
console.assert(merged.length === 2, "mergeWins preserves all groups");
console.assert(
	merged.find((w) => w.label === "Gemini Models · weekly")?.remainingPct === 91,
	"mergeWins keeps unique group",
);
console.assert(
	merged.find((w) => w.label === "Claude and GPT models · weekly")?.remainingPct === 80,
	"mergeWins keeps most restrictive remainingPct",
);

// mergeWins keeps daily weekly limit over stale prod
const dailyGemini = [
	{ label: "Gemini Models · weekly", remainingPct: 87, resetIso: "2026-08-25T00:00:00Z" },
];
const prodGemini = [
	{ label: "Gemini Models · weekly", remainingPct: 91, resetIso: "2026-08-25T00:00:00Z" },
];
const mergedGemini = mergeWins(dailyGemini, prodGemini);
console.assert(
	mergedGemini.find((w) => w.label === "Gemini Models · weekly")?.remainingPct === 87,
	"mergeWins keeps daily 87% over stale prod 91%",
);

// ANTIGRAVITY_UA and ANTIGRAVITY_HOSTS checks
console.assert(
	ANTIGRAVITY_UA.startsWith("antigravity/hub/2.23.0"),
	`ANTIGRAVITY_UA prefix expected antigravity/hub/2.23.0, got ${ANTIGRAVITY_UA}`,
);
const expectedUaTail =
	process.platform === "darwin"
		? "darwin/arm64"
		: process.platform === "win32"
			? "windows/amd64"
			: "linux/x64";
console.assert(
	ANTIGRAVITY_UA === `antigravity/hub/2.23.0 ${expectedUaTail}`,
	`ANTIGRAVITY_UA matches platform signature, got ${ANTIGRAVITY_UA}`,
);
console.assert(
	Array.isArray(ANTIGRAVITY_HOSTS) &&
		ANTIGRAVITY_HOSTS[0] === "https://daily-cloudcode-pa.googleapis.com" &&
		ANTIGRAVITY_HOSTS[1] === "https://daily-cloudcode-pa.sandbox.googleapis.com" &&
		ANTIGRAVITY_HOSTS[2] === "https://cloudcode-pa.googleapis.com",
	"ANTIGRAVITY_HOSTS prioritizes daily endpoints ahead of production",
);

// parseModelsQuota unit checks
const mockNow = Date.parse("2026-10-16T12:00:00Z");
const reset4h = new Date(mockNow + 4 * 3600 * 1000).toISOString();
const reset5d = new Date(mockNow + 5 * 86400 * 1000).toISOString();

const mockModelsPayload = {
	models: {
		"gemini-3.8-flash-tiered": {
			displayName: "Gemini 3.8 Flash Tiered",
			quotaInfo: {
				remainingFraction: 0.72,
				resetTime: reset4h,
			},
		},
		"gemini-2.5-pro": {
			displayName: "Gemini 2.5 Pro",
			quotaInfo: {
				remainingFraction: 0.85,
				resetTime: reset4h,
			},
		},
		"gemini-3-flash-agent": {
			displayName: "Gemini 3 Flash Agent",
			quotaInfo: {
				resetTime: reset5d,
			},
		},
		"gemini-4-argon-high": {
			displayName: "Gemini 4 Argon High",
			quotaInfo: {
				remainingFraction: 0.5,
				resetTime: reset5d,
			},
		},
		"claude-sonnet-5-5-high": {
			displayName: "Claude Sonnet 5.5 High",
			quotaInfo: {
				remainingFraction: 0.9,
				resetTime: reset4h,
			},
		},
		"gpt-oss-120b-medium": {
			displayName: "GPT OSS 120B Medium",
			quotaInfo: {
				remainingFraction: 1.0,
				resetTime: reset4h,
			},
		},
		tab_flash_lite_preview: {
			displayName: "Tab Flash Lite Preview",
			quotaInfo: {
				remainingFraction: 1.0,
			},
		},
	},
};

const parsedModelsWins = parseModelsQuota(JSON.stringify(mockModelsPayload), mockNow);

// 1. Parses realistic Gemini models with 5h quota, keeping most restrictive (0.72 vs 0.85 -> 72%)
const gemini5hWin = parsedModelsWins.find((w) => w.label === "Gemini Models · 5h");
console.assert(gemini5hWin !== undefined, "found Gemini Models · 5h");
console.assert(
	Math.abs(gemini5hWin.remainingPct - 72) < 0.001,
	`Gemini 5h remainingPct expected 72, got ${gemini5hWin?.remainingPct}`,
);
console.assert(gemini5hWin.resetIso === reset4h, "Gemini 5h resetIso matches reset4h");

// 2. Handles omitted remainingFraction as 0 when resetTime is present (gemini-3-flash-agent)
const geminiWeeklyWin = parsedModelsWins.find((w) => w.label === "Gemini Models · weekly");
console.assert(geminiWeeklyWin !== undefined, "found Gemini Models · weekly");
console.assert(
	geminiWeeklyWin.remainingPct === 0,
	`Gemini weekly remainingPct expected 0, got ${geminiWeeklyWin?.remainingPct}`,
);
console.assert(geminiWeeklyWin.resetIso === reset5d, "Gemini weekly resetIso matches reset5d");

// 3. Correctly groups Gemini, Argon, and Claude/GPT models
const argonWeeklyWin = parsedModelsWins.find((w) => w.label === "Argon Models · weekly");
console.assert(argonWeeklyWin !== undefined, "found Argon Models · weekly");
console.assert(argonWeeklyWin.remainingPct === 50, "Argon remainingPct 50");

const claudeGpt5hWin = parsedModelsWins.find((w) => w.label === "Claude and GPT models · 5h");
console.assert(claudeGpt5hWin !== undefined, "found Claude and GPT models · 5h");
console.assert(
	Math.abs(claudeGpt5hWin.remainingPct - 90) < 0.001,
	"Claude/GPT remainingPct 90 (min of 0.90 and 1.0)",
);

// Non-matching model or model without resetTime is skipped
console.assert(!parsedModelsWins.some((w) => w.label.includes("Tab")), "skipped non-matching models");

// Array models payload support
const arrayPayload = {
	models: [{ id: "gemini-3.8-flash-tiered", quotaInfo: { remainingFraction: 0.65, resetTime: reset4h } }],
};
const parsedArrayWins = parseModelsQuota(JSON.stringify(arrayPayload), mockNow);
console.assert(
	parsedArrayWins.length === 1 && Math.abs(parsedArrayWins[0].remainingPct - 65) < 0.001,
	"parseModelsQuota array shape",
);

// 4. Confirms mergeWins updates Gemini Models · 5h from 100% to more restrictive percentage and sets reset countdown
const staleSummaryWins = [
	{ label: "Gemini Models · weekly", remainingPct: 91, resetIso: reset5d },
	{ label: "Gemini Models · 5h", remainingPct: 100, resetIso: null },
];
const liveModelWins = [{ label: "Gemini Models · 5h", remainingPct: 72, resetIso: reset4h }];
const mergedWithLive = mergeWins(staleSummaryWins, liveModelWins);
const updatedGemini5h = mergedWithLive.find((w) => w.label === "Gemini Models · 5h");
console.assert(updatedGemini5h?.remainingPct === 72, "mergeWins updated Gemini 5h from 100% to 72%");
console.assert(updatedGemini5h?.resetIso === reset4h, "mergeWins set reset countdown for Gemini 5h");
const renderedUpdated = renderWindows([updatedGemini5h], mockNow)[0];
console.assert(
	renderedUpdated.includes("72% left · resets in 4h 0m"),
	`render contains active reset countdown: ${renderedUpdated}`,
);

// Extension registration and refresh interval checks
console.assert(REFRESH_INTERVAL_MS === 3 * 60 * 1000, "REFRESH_INTERVAL_MS is 3 minutes");

const registeredEvents = {};
const registeredCommands = {};
const registeredShortcuts = {};
const mockPi = {
	on: (event, handler) => {
		registeredEvents[event] = handler;
	},
	registerShortcut: (key, opts) => {
		registeredShortcuts[key] = opts;
	},
	registerCommand: (cmd, opts) => {
		registeredCommands[cmd] = opts;
	},
};
extension(mockPi);

console.assert(!("turn_end" in registeredEvents), "turn_end must not be registered (prevents unthrottled tool call polling)");
console.assert("session_start" in registeredEvents, "session_start must be registered");
console.assert("model_select" in registeredEvents, "model_select must be registered");
console.assert("session_shutdown" in registeredEvents, "session_shutdown must be registered");
console.assert("ctrl+shift+q" in registeredShortcuts, "ctrl+shift+q shortcut registered");
console.assert("quota" in registeredCommands, "quota command registered");

console.log("units OK:", summaryFromWins(wins, now));

const base = resolveBaseUrl();
const key = resolveManagementKey();
console.log("baseUrl:", base);
console.log("managementKey:", key ? key.slice(0, 6) + "…(" + key.length + " chars)" : "NONE");
if (!key) process.exit(1);

const { blocks, footer } = await collectQuota(base, key);
console.log("\n" + blocks.join("\n"));
console.log("\nfooter:", footer);
console.log("\nOK");
