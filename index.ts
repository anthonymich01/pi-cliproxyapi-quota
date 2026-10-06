/**
 * pi-cliproxy-quota
 *
 * View subscription quota for every OAuth provider CLIProxyAPI holds inside pi:
 *  - /quota: show subscription quota for every OAuth provider the proxy holds,
 *    fetched exactly like the EasyCLIProxyAPI panel does via the proxy management
 *    API `POST /v0/management/api-call`. Providers: claude + antigravity/gemini
 *    (verified), codex + kimi + xai (best-effort, marked (unverified)).
 *  - Footer quota display: automatically refreshed at turn start/end.
 *
 * No secrets in source. Management key is read at runtime from env,
 * ~/.pi/agent/cliproxyapi-quota.json, or the GUI config.toml. See AGENTS.md.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// ---------- config resolution ----------

const DEFAULT_BASE_URL = "http://127.0.0.1:8317";
const AGENT_DIR = process.env.PI_AGENT_DIR || join(homedir(), ".pi", "agent");

// EasyCLIProxyAPI GUI config.toml candidate locations, per platform.
function guiConfigCandidates(): string[] {
	const home = homedir();
	if (process.platform === "darwin") {
		return [join(home, "Library", "Application Support", "com.cpa.gui", "config.toml")];
	}
	if (process.platform === "win32") {
		const appData = process.env.APPDATA || join(home, "AppData", "Roaming");
		return [join(appData, "com.cpa.gui", "config.toml")];
	}
	// linux / other
	const xdg = process.env.XDG_CONFIG_HOME || join(home, ".config");
	return [join(xdg, "com.cpa.gui", "config.toml")];
}

function readJson(path: string): Record<string, unknown> | undefined {
	try {
		return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

function firstString(...vals: unknown[]): string | undefined {
	for (const v of vals) {
		if (typeof v === "string" && v.trim()) return v.trim();
	}
	return undefined;
}

export function resolveBaseUrl(): string {
	const fromFile = readJson(join(AGENT_DIR, "cliproxyapi.json"))?.baseUrl;
	return firstString(process.env.CLIPROXYAPI_BASE_URL, fromFile) ?? DEFAULT_BASE_URL;
}

/** Read `management-secret-key = "..."` from the GUI TOML without a TOML dep. */
function readManagementKeyFromToml(): string | undefined {
	for (const path of guiConfigCandidates()) {
		try {
			const text = readFileSync(path, "utf8");
			const m = text.match(/^\s*management-secret-key\s*=\s*"([^"]+)"/m);
			if (m?.[1]) return m[1];
		} catch {
			// try next candidate
		}
	}
	return undefined;
}

export function resolveManagementKey(): string | undefined {
	const override = readJson(join(AGENT_DIR, "cliproxyapi-quota.json"))?.managementKey;
	return firstString(
		process.env.CLIPROXYAPI_MANAGEMENT_KEY,
		override,
		readManagementKeyFromToml(),
	);
}

// ---------- management API ----------

export interface AuthCooldown {
	scope?: string;
	model_key?: string;
	reason?: string;
	retry_at?: string;
	remaining_seconds?: number;
	backoff_level?: number;
	http_status?: number;
}

export interface RecentRequest {
	time?: string;
	success?: number;
	failed?: number;
}

export interface AuthFile {
	id: string;
	name: string;
	provider?: string;
	type?: string;
	auth_index?: string;
	disabled?: boolean;
	email?: string;
	label?: string;
	project_id?: string;
	account?: string;
	status?: string;
	unavailable?: boolean;
	priority?: number;
	last_refresh?: string;
	updated_at?: string;
	success?: number;
	failed?: number;
	cooldowns?: AuthCooldown[];
	recent_requests?: RecentRequest[];
}

async function mgmtGet<T>(base: string, key: string, path: string): Promise<T> {
	const res = await fetch(`${base}/v0/management/${path}`, {
		headers: { Authorization: `Bearer ${key}` },
		signal: AbortSignal.timeout(20_000),
	});
	if (!res.ok) throw new Error(`GET ${path} -> HTTP ${res.status}`);
	return (await res.json()) as T;
}

async function mgmtApiCall(
	base: string,
	key: string,
	body: unknown,
): Promise<{ status_code: number; body: string }> {
	const res = await fetch(`${base}/v0/management/api-call`, {
		method: "POST",
		headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(30_000),
	});
	if (!res.ok) throw new Error(`api-call -> HTTP ${res.status}`);
	return (await res.json()) as { status_code: number; body: string };
}

// List every OAuth credential the proxy holds (any provider), enabled only.
async function listCredentials(base: string, key: string): Promise<AuthFile[]> {
	const data = await mgmtGet<{ files?: AuthFile[] }>(base, key, "auth-files");
	return (data.files ?? []).filter(
		(f) => typeof f.auth_index === "string" && f.auth_index.length > 0 && !f.disabled,
	);
}

// Normalize provider name the same way the GUI does.
function providerKey(f: AuthFile): string {
	const raw = (f.provider ?? f.type ?? "").trim().toLowerCase().replace(/_/g, "-");
	if (raw === "x-ai" || raw === "grok") return "xai";
	return raw;
}

// Normalized quota window (remaining-oriented; used = 100 - remaining).
export interface Win {
	label: string;
	remainingPct: number | null;
	resetIso: string | null;
}

function toNum(v: unknown): number | null {
	const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.trim()) : NaN;
	return Number.isFinite(n) ? n : null;
}

function firstIso(...vals: unknown[]): string | null {
	for (const v of vals) if (typeof v === "string" && v.trim()) return v;
	return null;
}

// Run one upstream request through the management api-call proxy; returns raw body text.
// The proxy substitutes $TOKEN$ in headers with the stored OAuth bearer for authIndex.
async function proxyCall(
	base: string,
	key: string,
	req: { authIndex: string; method: string; url: string; header?: Record<string, string>; body?: string },
): Promise<string> {
	const out = await mgmtApiCall(base, key, req);
	if (out.status_code < 200 || out.status_code >= 300) {
		throw new Error(`upstream HTTP ${out.status_code}`);
	}
	return out.body;
}

const BEARER = { Authorization: "Bearer $TOKEN$" };

interface Adapter {
	verified: boolean;
	fetch: (base: string, key: string, cred: AuthFile) => Promise<Win[]>;
}

// ---- claude (VERIFIED): GET api.anthropic.com/api/oauth/usage ----
const CLAUDE_WINDOWS: Array<[string, string]> = [
	["five_hour", "5-hour (session)"],
	["seven_day", "7-day (weekly)"],
	["seven_day_oauth_apps", "7-day OAuth apps"],
	["seven_day_opus", "7-day Opus"],
	["seven_day_sonnet", "7-day Sonnet"],
	["seven_day_cowork", "7-day Cowork"],
	["iguana_necktie", "7-day Fable"],
];
const claudeAdapter: Adapter = {
	verified: true,
	async fetch(base, key, cred) {
		const authIndex = cred.auth_index as string;
		const body = await proxyCall(base, key, {
			authIndex,
			method: "GET",
			url: "https://api.anthropic.com/api/oauth/usage",
			header: { ...BEARER, "Content-Type": "application/json", "anthropic-beta": "oauth-2025-04-20" },
		});
		const usage = JSON.parse(body) as Record<string, { utilization?: unknown; resets_at?: unknown } | null>;
		const wins: Win[] = [];
		for (const [k, label] of CLAUDE_WINDOWS) {
			const w = usage[k];
			if (!w || typeof w !== "object") continue;
			const u = toNum((w as { utilization?: unknown }).utilization);
			if (u === null) continue;
			wins.push({ label, remainingPct: Math.max(0, 100 - u), resetIso: firstIso((w as { resets_at?: unknown }).resets_at) });
		}
		return wins;
	},
};

// ---- antigravity / gemini code assist (VERIFIED): POST retrieveUserQuotaSummary ----
// Mirror the CPA panel: body is {project} (NOT {metadata}), tried across hosts in
// order daily -> daily-sandbox -> prod. The same account reports DIFFERENT quota
// per host environment (e.g. 88% weekly on daily vs 57% on prod); Antigravity
// traffic is served by the daily host, so it is authoritative.
const ANTIGRAVITY_HOSTS = [
	"https://daily-cloudcode-pa.googleapis.com",
	"https://daily-cloudcode-pa.sandbox.googleapis.com",
	"https://cloudcode-pa.googleapis.com",
];
const ANTIGRAVITY_UA = "antigravity/cli/1.0.13 (aidev_client; os_type=darwin; arch=arm64)";

function parseQuotaSummary(body: string): Win[] {
	const data = JSON.parse(body) as {
		groups?: Array<{ displayName?: unknown; buckets?: Array<Record<string, unknown>> }>;
	};
	const wins: Win[] = [];
	for (const g of data.groups ?? []) {
		const gname = typeof g.displayName === "string" ? g.displayName : "Group";
		for (const b of g.buckets ?? []) {
			const frac = toNum(b.remainingFraction);
			if (frac === null) continue;
			const win = String(b.window ?? "").toLowerCase();
			const tag = win === "5h" ? "5h" : win === "weekly" ? "weekly" : win || "quota";
			wins.push({
				label: `${gname} · ${tag}`,
				remainingPct: Math.max(0, Math.min(100, frac * 100)),
				resetIso: firstIso(b.resetTime),
			});
		}
	}
	return wins;
}

const antigravityAdapter: Adapter = {
	verified: true,
	async fetch(base, key, cred) {
		const authIndex = cred.auth_index as string;
		const header = { ...BEARER, "Content-Type": "application/json", "User-Agent": ANTIGRAVITY_UA };
		// project id comes from the auth-files listing; discover via loadCodeAssist if absent
		let project = cred.project_id;
		if (!project) {
			try {
				const body = await proxyCall(base, key, {
					authIndex, method: "POST",
					url: `${ANTIGRAVITY_HOSTS[0]}/v1internal:loadCodeAssist`,
					header, body: JSON.stringify({ metadata: { ideType: "ANTIGRAVITY" } }),
				});
				const d = JSON.parse(body) as { cloudaicompanionProject?: unknown };
				const cp = d.cloudaicompanionProject;
				project = typeof cp === "string" ? cp : (cp as { id?: string } | undefined)?.id;
			} catch {
				// fall through to the legacy metadata call below
			}
		}
		if (project) {
			let lastErr: unknown;
			for (const host of ANTIGRAVITY_HOSTS) {
				try {
					const body = await proxyCall(base, key, {
						authIndex, method: "POST",
						url: `${host}/v1internal:retrieveUserQuotaSummary`,
						header, body: JSON.stringify({ project }),
					});
					return parseQuotaSummary(body);
				} catch (err) {
					lastErr = err;
				}
			}
			throw lastErr;
		}
		// no project id (e.g. plain gemini-cli credential): legacy prod-host call
		const body = await proxyCall(base, key, {
			authIndex,
			method: "POST",
			url: "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
			header,
			body: JSON.stringify({ metadata: { ideType: "ANTIGRAVITY" } }),
		});
		return parseQuotaSummary(body);
	},
};

// ---- kimi (VERIFIED): GET api.kimi.com/coding/v1/usages ----
// Real shape: top-level `usage` = weekly quota; `limits[].detail` = per-window quota
// with `limits[].window.{duration,timeUnit}` (e.g. 300 minutes = the 5h window).
const kimiAdapter: Adapter = {
	verified: true,
	async fetch(base, key, cred) {
		const authIndex = cred.auth_index as string;
		const body = await proxyCall(base, key, {
			authIndex, method: "GET", url: "https://api.kimi.com/coding/v1/usages", header: { ...BEARER },
		});
		const data = JSON.parse(body) as {
			usage?: Record<string, unknown>;
			limits?: Array<{ window?: { duration?: unknown; timeUnit?: unknown }; detail?: Record<string, unknown> }>;
		};
		const wins: Win[] = [];
		const push = (label: string, d: Record<string, unknown> | undefined): void => {
			const remaining = toNum(d?.remaining);
			const limit = toNum(d?.limit);
			if (remaining === null || limit === null || limit <= 0) return;
			wins.push({
				label,
				remainingPct: Math.max(0, Math.min(100, (remaining / limit) * 100)),
				resetIso: firstIso(d?.resetTime, d?.reset_at, d?.resetAt, d?.reset_time),
			});
		};
		push("weekly", data.usage);
		for (const l of data.limits ?? []) {
			const mins = String(l.window?.timeUnit ?? "").includes("MINUTE") ? toNum(l.window?.duration) : null;
			const label = mins === null ? "window" : mins % 60 === 0 ? `${mins / 60}h` : `${mins}m`;
			push(label, l.detail);
		}
		return wins;
	},
};

// ---- codex (UNVERIFIED): GET chatgpt.com/backend-api/wham/usage ----
const codexAdapter: Adapter = {
	verified: false,
	async fetch(base, key, cred) {
		const authIndex = cred.auth_index as string;
		const body = await proxyCall(base, key, {
			authIndex,
			method: "GET",
			url: "https://chatgpt.com/backend-api/wham/usage",
			header: {
				...BEARER,
				"Content-Type": "application/json",
				"User-Agent": "codex_cli_rs/0.76.0 (Debian 13.0.0; x86_64) WindowsTerminal",
			},
		});
		const data = JSON.parse(body) as Record<string, unknown>;
		const wins: Win[] = [];
		const rl = (data.rate_limits ?? data) as Record<string, unknown>;
		for (const slot of ["primary", "secondary"] as const) {
			const r = rl[slot] as Record<string, unknown> | undefined;
			const up = toNum(r?.used_percent ?? r?.usedPercent);
			if (up === null) continue;
			const secs = toNum(r?.resets_in_seconds ?? r?.resetsInSeconds);
			const resetIso = secs !== null && secs > 0 ? new Date(Date.now() + secs * 1000).toISOString() : firstIso(r?.resets_at);
			wins.push({ label: `rate ${slot}`, remainingPct: Math.max(0, 100 - up), resetIso });
		}
		const bp = toNum(
			data.creditUsagePercent ?? data.credit_usage_percent ?? data.usagePercent ?? data.usage_percent,
		);
		if (bp !== null) {
			const cp = (data.currentPeriod ?? data.current_period) as Record<string, unknown> | undefined;
			wins.push({ label: "credits", remainingPct: Math.max(0, 100 - bp), resetIso: firstIso(cp?.end) });
		}
		return wins;
	},
};

// ---- xai / grok (UNVERIFIED): GET api.x.ai/v1/me (mostly account health) ----
const xaiAdapter: Adapter = {
	verified: false,
	async fetch(base, key, cred) {
		const authIndex = cred.auth_index as string;
		const body = await proxyCall(base, key, {
			authIndex, method: "GET", url: "https://api.x.ai/v1/me", header: { ...BEARER, accept: "application/json" },
		});
		const data = JSON.parse(body) as Record<string, unknown>;
		const p = toNum(data.usagePercent ?? data.usage_percent ?? data.creditUsagePercent);
		return p === null ? [] : [{ label: "usage", remainingPct: Math.max(0, 100 - p), resetIso: null }];
	},
};

const ADAPTERS: Record<string, Adapter> = {
	claude: claudeAdapter,
	antigravity: antigravityAdapter,
	gemini: antigravityAdapter,
	kimi: kimiAdapter,
	codex: codexAdapter,
	xai: xaiAdapter,
};

/** Guess which quota provider the current pi model routes to (by provider/id text). */
export function providerFromModel(model: { provider?: string; id?: string } | undefined): string | null {
	const s = `${model?.provider ?? ""} ${model?.id ?? ""}`.toLowerCase();
	if (s.includes("claude")) return "claude";
	if (s.includes("gemini") || s.includes("antigravity")) return "antigravity";
	if (s.includes("codex") || s.includes("gpt")) return "codex";
	if (s.includes("kimi")) return "kimi";
	if (s.includes("grok") || s.includes("xai")) return "xai";
	return null;
}

export function isCredentialAvailable(c: AuthFile): boolean {
	if (c.disabled || c.unavailable) return false;
	if (c.status && c.status !== "active") return false;
	return true;
}

export function isCredentialOnCooldown(c: AuthFile, modelId?: string | null, now = Date.now()): boolean {
	if (!c.cooldowns || !Array.isArray(c.cooldowns) || c.cooldowns.length === 0) return false;
	for (const cd of c.cooldowns) {
		const isTimeActive =
			(typeof cd.remaining_seconds === "number" && cd.remaining_seconds > 0) ||
			(typeof cd.retry_at === "string" && !Number.isNaN(Date.parse(cd.retry_at)) && Date.parse(cd.retry_at) > now);
		if (!isTimeActive) continue;
		if (!cd.scope || cd.scope !== "model") {
			return true;
		}
		if (cd.scope === "model" && cd.model_key) {
			if (!modelId) return true;
			const mk = cd.model_key.toLowerCase().replace(/_/g, "-");
			const mid = modelId.toLowerCase().replace(/_/g, "-");
			if (mk === mid || mid.includes(mk) || mk.includes(mid)) {
				return true;
			}
		}
	}
	return false;
}

export function getRecentActivityScore(c: AuthFile): number {
	let score = 0;
	if (Array.isArray(c.recent_requests)) {
		const len = c.recent_requests.length;
		for (let i = 0; i < len; i++) {
			const req = c.recent_requests[i];
			if (req?.success && typeof req.success === "number") {
				const weight = i + 1;
				score += req.success * weight;
			}
		}
	}
	return score;
}

export function getLastActiveTime(c: AuthFile): number {
	if (typeof c.updated_at === "string") {
		const t = Date.parse(c.updated_at);
		if (!Number.isNaN(t)) return t;
	}
	if (typeof c.last_refresh === "string") {
		const t = Date.parse(c.last_refresh);
		if (!Number.isNaN(t)) return t;
	}
	return 0;
}

export function filterWinsForModel(wins: Win[], modelId?: string | null): Win[] {
	if (wins.length === 0) return wins;
	const mid = (modelId ?? "").toLowerCase();
	const hasGeminiGroup = wins.some((w) => w.label.toLowerCase().includes("gemini"));
	const hasClaudeGroup = wins.some(
		(w) => w.label.toLowerCase().includes("claude") || w.label.toLowerCase().includes("gpt"),
	);
	if (hasGeminiGroup && hasClaudeGroup) {
		if (mid.includes("gemini")) {
			const geminiWins = wins.filter((w) => w.label.toLowerCase().includes("gemini"));
			if (geminiWins.length > 0) return geminiWins;
		} else if (mid.includes("claude") || mid.includes("gpt") || mid.includes("codex")) {
			const nonGeminiWins = wins.filter(
				(w) => w.label.toLowerCase().includes("claude") || w.label.toLowerCase().includes("gpt"),
			);
			if (nonGeminiWins.length > 0) return nonGeminiWins;
		} else {
			// If no specific model or unknown, don't mix groups: pick the primary group of the credential
			const geminiWins = wins.filter((w) => w.label.toLowerCase().includes("gemini"));
			if (geminiWins.length > 0) return geminiWins;
		}
	}
	return wins;
}

export function hasRemainingQuota(wins: Win[], modelId?: string | null): boolean {
	const relevant = filterWinsForModel(wins, modelId);
	if (relevant.length === 0) return true;
	const allZero = relevant.every((w) => w.remainingPct !== null && w.remainingPct <= 0);
	return !allZero;
}

export function getMinRemainingPct(wins: Win[], modelId?: string | null): number {
	const relevant = filterWinsForModel(wins, modelId);
	let min = 100;
	for (const w of relevant) {
		if (w.remainingPct !== null && w.remainingPct < min) {
			min = w.remainingPct;
		}
	}
	return min;
}

export function formatAccountName(c: AuthFile): string {
	const raw = c.email || c.label || c.name || "";
	if (raw.includes("@")) {
		return raw.split("@")[0]!;
	}
	return raw.replace(/\.json$/, "");
}

export function compareCredentials(
	a: { cred: AuthFile; wins: Win[] },
	b: { cred: AuthFile; wins: Win[] },
	modelId?: string | null,
	now = Date.now(),
): number {
	const aAvail = isCredentialAvailable(a.cred);
	const bAvail = isCredentialAvailable(b.cred);
	if (aAvail !== bAvail) return aAvail ? -1 : 1;

	const aCool = isCredentialOnCooldown(a.cred, modelId, now);
	const bCool = isCredentialOnCooldown(b.cred, modelId, now);
	if (aCool !== bCool) return aCool ? 1 : -1;

	const aHasQuota = hasRemainingQuota(a.wins, modelId);
	const bHasQuota = hasRemainingQuota(b.wins, modelId);
	if (aHasQuota !== bHasQuota) return aHasQuota ? -1 : 1;

	const aAct = getRecentActivityScore(a.cred);
	const bAct = getRecentActivityScore(b.cred);
	if (aAct !== bAct) return bAct - aAct;

	const aTime = getLastActiveTime(a.cred);
	const bTime = getLastActiveTime(b.cred);
	if (Math.abs(bTime - aTime) > 60_000) return bTime - aTime;

	const aPct = getMinRemainingPct(a.wins, modelId);
	const bPct = getMinRemainingPct(b.wins, modelId);
	if (aPct !== bPct) return bPct - aPct;

	const aPri = a.cred.priority ?? 0;
	const bPri = b.cred.priority ?? 0;
	if (aPri !== bPri) return bPri - aPri;

	const aSucc = a.cred.success ?? 0;
	const bSucc = b.cred.success ?? 0;
	return bSucc - aSucc;
}

/** Fetch and render quota for every known credential. Exported for test-quota.mjs. */
export async function collectQuota(
	base: string,
	key: string,
	now = Date.now(),
	prefer?: string | null,
	modelId?: string | null,
	options?: { color?: boolean },
): Promise<{ blocks: string[]; footer: string }> {
	const creds = await listCredentials(base, key);
	const known = creds
		.filter((c) => ADAPTERS[providerKey(c)])
		.sort((a, b) => (providerKey(a) === "claude" ? 0 : 1) - (providerKey(b) === "claude" ? 0 : 1));
	if (known.length === 0) throw new Error("NO_CRED");

	type CredResult = { cred: AuthFile; pk: string; wins: Win[]; error?: Error };
	const results: CredResult[] = [];
	for (const c of known) {
		const pk = providerKey(c);
		const adapter = ADAPTERS[pk];
		try {
			const wins = await adapter.fetch(base, key, c);
			results.push({ cred: c, pk, wins });
		} catch (err) {
			results.push({ cred: c, pk, wins: [], error: err as Error });
		}
	}

	// Group successful results by provider and determine the active credential for each provider
	const byProvider = new Map<string, Array<{ cred: AuthFile; wins: Win[] }>>();
	for (const r of results) {
		if (r.error) continue;
		const list = byProvider.get(r.pk) ?? [];
		list.push({ cred: r.cred, wins: r.wins });
		byProvider.set(r.pk, list);
	}

	const activeByProvider = new Map<string, { cred: AuthFile; wins: Win[] }>();
	for (const [pk, list] of byProvider) {
		list.sort((a, b) => compareCredentials(a, b, modelId, now));
		activeByProvider.set(pk, list[0]!);
	}

	const blocks: string[] = [];
	for (const r of results) {
		const adapter = ADAPTERS[r.pk];
		const who = r.cred.email || r.cred.label || r.cred.name;
		const tag = adapter.verified ? "" : " (unverified)";
		const onCooldown = isCredentialOnCooldown(r.cred, modelId, now);
		const isActive = activeByProvider.get(r.pk)?.cred.id === r.cred.id;
		const statusNote = onCooldown ? " [cooling down]" : isActive ? " [active]" : "";
		if (r.error) {
			blocks.push(`● ${who} [${r.pk}]${tag}${statusNote}\n  failed: ${r.error.message}`);
		} else {
			blocks.push(`● ${who} [${r.pk}]${tag}${statusNote}`);
			blocks.push(...renderWindows(r.wins, now));
		}
	}

	// Footer follows the current model's provider; fall back to the first available.
	const actualProvider =
		prefer && activeByProvider.has(prefer)
			? prefer
			: activeByProvider.keys().next().value;

	const useColor = options?.color ?? true;
	let footer = "";
	if (actualProvider) {
		const activeItem = activeByProvider.get(actualProvider)!;
		const credCount = (byProvider.get(actualProvider) ?? []).length;
		const providerCount = activeByProvider.size;
		const accName = formatAccountName(activeItem.cred);

		let labelTag = "";
		if (credCount > 1) {
			labelTag = providerCount > 1 || actualProvider !== prefer ? `[${actualProvider}:${accName}]` : `[${accName}]`;
		} else if (providerCount > 1 || actualProvider !== prefer) {
			labelTag = `[${actualProvider}]`;
		}

		const hit = summaryFromWins(activeItem.wins, now, modelId, { color: useColor, labelTag });
		if (hit !== "Quota n/a") {
			const d = new Date(now);
			const stamp = `@${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
			const stampStr = useColor ? `${ANSI_DIM} ${stamp}${ANSI_RESET_DIM}` : ` ${stamp}`;
			footer = `${hit}${stampStr}`;
		}
	}

	return { blocks, footer };
}

// ---------- rendering ----------

export function formatReset(iso: string | null, now = Date.now()): string {
	if (!iso) return "—";
	const t = Date.parse(iso);
	if (Number.isNaN(t)) return "—";
	let ms = t - now;
	if (ms <= 0) return "resets now";
	const days = Math.floor(ms / 86_400_000);
	ms -= days * 86_400_000;
	const hours = Math.floor(ms / 3_600_000);
	ms -= hours * 3_600_000;
	const minutes = Math.floor(ms / 60_000);
	if (days > 0) return `resets in ${days}d ${hours}h`;
	if (hours > 0) return `resets in ${hours}h ${minutes}m`;
	return `resets in ${minutes}m`;
}

function bar(pct: number, width = 12): string {
	const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
	return "█".repeat(filled) + "░".repeat(width - filled);
}

/** Build display lines for one credential's normalized windows. */
export function renderWindows(wins: Win[], now = Date.now()): string[] {
	if (wins.length === 0) return ["  (no quota window data)"];
	return wins.map((w) => {
		const remain = w.remainingPct;
		if (remain === null) return `  ${w.label.padEnd(30)} n/a · ${formatReset(w.resetIso, now)}`;
		const used = Math.max(0, 100 - remain);
		// suppress when the displayed value rounds to 100%: upstream slides resetTime
		// on untouched buckets (always now+window), so a countdown there is an illusion.
		const resetStr = Math.round(remain) >= 100 ? "—" : formatReset(w.resetIso, now);
		return `  ${w.label.padEnd(30)} ${bar(used)} ${used.toFixed(0)}% used · ${remain.toFixed(0)}% left · ${resetStr}`;
	});
}

function shortTag(label: string): string {
	const l = label.toLowerCase();
	if (l.includes("5h") || l.includes("5-hour") || l.includes("five")) return "5h";
	if (l.includes("weekly") || l.includes("7-day") || l.includes("7d") || l.includes("week")) return "7d";
	return label.split(/[ ·(]/)[0];
}

// ---------- color styling ----------

export const ANSI_DIM = "\x1b[2m";
export const ANSI_RESET_DIM = "\x1b[22m";
export const ANSI_GREEN = "\x1b[32m";
export const ANSI_YELLOW = "\x1b[33m";
export const ANSI_ORANGE = "\x1b[38;5;208m";
export const ANSI_RED = "\x1b[31m";
export const ANSI_RESET_FG = "\x1b[39m";

/**
 * 4-tier remaining percentage coloring:
 * > 75%  -> Green
 * > 50%  -> Yellow
 * > 25%  -> Orange
 * <= 25% -> Red
 */
export function getQuotaColor(pct: number): string {
	if (pct > 75) return ANSI_GREEN;
	if (pct > 50) return ANSI_YELLOW;
	if (pct > 25) return ANSI_ORANGE;
	return ANSI_RED;
}

/**
 * Dynamic reset countdown coloring:
 * - Under 1 hour (< 1h) -> Green (both 5h and 7d limits)
 * - Under 3 days (< 3d) -> Yellow (for 7d weekly limits)
 * - Otherwise           -> null (default text color)
 */
export function getResetColor(
	tag: string,
	iso: string | null,
	now = Date.now(),
): string | null {
	if (!iso) return null;
	const t = Date.parse(iso);
	if (Number.isNaN(t) || t <= now) return null;
	const ms = t - now;
	const ONE_HOUR = 60 * 60 * 1000;
	const THREE_DAYS = 3 * 24 * 60 * 60 * 1000;
	if (ms < ONE_HOUR) return ANSI_GREEN;
	const isWeekly = tag.toLowerCase().includes("7d") || tag.toLowerCase().includes("week");
	if (isWeekly && ms < THREE_DAYS) return ANSI_YELLOW;
	return null;
}

/** Compact relative reset for the footer: " ↻ 1h44m", " ↻ 2d21h" ("" when unknown). */
export function compactReset(iso: string | null, now: number): string {
	if (!iso) return "";
	const t = Date.parse(iso);
	if (Number.isNaN(t) || t <= now) return "";
	const ms = t - now;
	const d = Math.floor(ms / 86_400_000);
	const h = Math.floor((ms % 86_400_000) / 3_600_000);
	const m = Math.floor((ms % 3_600_000) / 60_000);
	if (d > 0) return ` ↻ ${d}d${h}h`;
	if (h > 0) return ` ↻ ${h}h${m}m`;
	return ` ↻ ${m}m`;
}

function windowOrder(label: string): number {
	const l = label.toLowerCase();
	if (l.includes("5h") || l.includes("5-hour") || l.includes("five")) return 1;
	if (l.includes("daily") || l.includes("24h") || l.includes("1d")) return 2;
	if (l.includes("weekly") || l.includes("7-day") || l.includes("7d") || l.includes("week")) return 3;
	return 4;
}

export interface SummaryOptions {
	color?: boolean;
	labelTag?: string;
}

/** Compact one-line summary for the footer (first two windows). */
export function summaryFromWins(
	wins: Win[],
	now = Date.now(),
	modelId?: string | null,
	options?: SummaryOptions,
): string {
	const color = options?.color ?? false;
	const labelTag = options?.labelTag ?? "";
	const relevant = filterWinsForModel(wins, modelId)
		.slice()
		.sort((a, b) => windowOrder(a.label) - windowOrder(b.label));
	const parts: string[] = [];
	for (const w of relevant.slice(0, 2)) {
		if (w.remainingPct === null) continue;
		const rounded = Math.round(w.remainingPct);
		const tag = shortTag(w.label);
		const tagText = color ? `${ANSI_DIM}${tag} ${ANSI_RESET_DIM}` : `${tag} `;
		const pctText = color
			? `${getQuotaColor(rounded)}${rounded}% left${ANSI_RESET_FG}`
			: `${rounded}% left`;
		let resetText = "";
		if (rounded < 100 && w.resetIso) {
			const cReset = compactReset(w.resetIso, now);
			if (cReset) {
				if (color) {
					const rColor = getResetColor(tag, w.resetIso, now);
					if (rColor) {
						resetText = ` ${rColor}${cReset.trim()}${ANSI_RESET_FG}`;
					} else {
						resetText = `${ANSI_DIM}${cReset}${ANSI_RESET_DIM}`;
					}
				} else {
					resetText = cReset;
				}
			}
		}
		parts.push(`${tagText}${pctText}${resetText}`);
	}
	if (!parts.length) return "Quota n/a";
	const prefix = color
		? `${ANSI_DIM}Quota${labelTag} ${ANSI_RESET_DIM}`
		: `Quota${labelTag} `;
	const sep = color ? `${ANSI_DIM} · ${ANSI_RESET_DIM}` : " · ";
	return `${prefix}${parts.join(sep)}`;
}

// ---------- extension ----------

function isPrimaryUiSession(ctx: ExtensionContext): boolean {
	return ctx.hasUI && ctx.mode === "tui";
}

export default function (pi: ExtensionAPI): void {
	// Switching models switches the footer to that provider's quota immediately.
	pi.on("model_select", (_e, ctx) => {
		lastFooterFetch = 0;
		refreshFooterThrottled(ctx);
	});

	// ----- /quota -----
	const QUOTA_KEY = "cliproxy-quota";
	let lastFooterFetch = 0;

	async function collectUsage(
		now: number,
		prefer?: string | null,
		modelId?: string | null,
	): Promise<{ blocks: string[]; footer: string }> {
		const base = resolveBaseUrl();
		const key = resolveManagementKey();
		if (!key) throw new Error("NO_KEY");
		return collectQuota(base, key, now, prefer, modelId);
	}

	// silent=true only refreshes the footer (used for auto-refresh during/after a turn).
	async function runQuota(ctx: ExtensionContext, silent = false): Promise<void> {
		if (!silent) ctx.ui.notify("Fetching quota…", "info");
		try {
			const { blocks, footer } = await collectUsage(
				Date.now(),
				providerFromModel(ctx.model),
				ctx.model?.id,
			);
			if (!silent) ctx.ui.notify(`Subscription quota\n${blocks.join("\n")}`, "info");
			if (footer && isPrimaryUiSession(ctx)) {
				ctx.ui.setStatus(QUOTA_KEY, footer);
			}
		} catch (err) {
			if (silent) return;
			const msg = (err as Error).message;
			if (msg === "NO_KEY") {
				ctx.ui.notify(
					'Management key not found. Set CLIPROXYAPI_MANAGEMENT_KEY, or write {"managementKey":"..."} to ~/.pi/agent/cliproxyapi-quota.json, or make sure the EasyCLIProxyAPI GUI has a management-secret-key configured.',
					"error",
				);
			} else if (msg === "NO_CRED") {
				ctx.ui.notify(
					"No usable OAuth credential found (claude / codex / antigravity / gemini / kimi / xai).",
					"warning",
				);
			} else {
				ctx.ui.notify(`Failed to fetch quota: ${msg}`, "error");
			}
		}
	}

	// Auto-refresh footer: first turn start + each turn end, throttled to 60s, silent.
	function refreshFooterThrottled(ctx: ExtensionContext): void {
		if (!isPrimaryUiSession(ctx)) return;
		const now = Date.now();
		if (now - lastFooterFetch < 60_000) return;
		lastFooterFetch = now;
		void runQuota(ctx, true);
	}
	pi.on("before_agent_start", (_e, ctx) => refreshFooterThrottled(ctx));
	pi.on("agent_settled", (_e, ctx) => refreshFooterThrottled(ctx));

	// Works while streaming: shortcut fetches and shows quota immediately.
	pi.registerShortcut("ctrl+shift+q", {
		description: "Show subscription quota (all OAuth providers)",
		handler: (ctx) => runQuota(ctx),
	});

	pi.registerCommand("quota", {
		description: "Show subscription quota for all OAuth providers (via CLIProxyAPI)",
		handler: async (_args, ctx) => runQuota(ctx),
	});
}
