// Live smoke test of the quota data path + pure renderers.
// Run: node test-quota.mjs
import { resolveBaseUrl, resolveManagementKey, collectQuota, renderWindows, summaryFromWins, formatReset } from "./index.ts";

// formatReset unit checks
const now = Date.parse("2026-08-19T09:00:00Z");
console.assert(formatReset(null, now) === "—", "null reset");
console.assert(formatReset("2026-08-19T08:00:00Z", now) === "resets now", "past reset");
console.assert(/^resets in /.test(formatReset("2026-08-19T11:50:00Z", now)), "future reset");

// renderWindows / summaryFromWins unit checks
const wins = [
	{ label: "5-hour (session)", remainingPct: 64, resetIso: "2026-08-19T11:50:00Z" },
	{ label: "7-day (weekly)", remainingPct: 95, resetIso: "2026-08-25T03:00:00Z" },
];
console.assert(summaryFromWins(wins, now) === "Quota 5h 64% left ↻ 2h50m · 7d 95% left ↻ 5d18h", "footer");
console.assert(renderWindows(wins, now)[0].includes("36% used · 64% left"), "render used/left");

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
