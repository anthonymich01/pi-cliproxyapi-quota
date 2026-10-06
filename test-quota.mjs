// Live smoke test of the quota data path + pure renderers.
// Run: node test-quota.mjs
import {
	resolveBaseUrl,
	resolveManagementKey,
	collectQuota,
	renderWindows,
	summaryFromWins,
	formatReset,
	compactReset,
	getQuotaColor,
	getResetColor,
	ANSI_GREEN,
	ANSI_YELLOW,
	ANSI_ORANGE,
	ANSI_RED,
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
