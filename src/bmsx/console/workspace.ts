import { extractErrorMessage } from '../lua/value';
import type { HttpResponse, StorageService } from '../platform';
import { type RomPack, type BmsxCartridge, type RomLuaAsset, normalizeLuaAsset } from '../rompack/rompack';
import { BmsxConsoleRuntime } from './runtime';
import { $ } from '../core/game';
import { ConsoleLuaResourceCreationRequest, ConsoleResourceDescriptor } from './types';

export const WORKSPACE_FILE_ENDPOINT = '/__bmsx__/lua';
export const WORKSPACE_STORAGE_PREFIX = 'bmsx.workspace';
export const WORKSPACE_METADATA_DIR = '.bmsx';
export const WORKSPACE_DIRTY_DIR = 'dirty';
export const WORKSPACE_STATE_FILE = 'ide-state.json';
export const WORKSPACE_MARKER_FILE = '~workspace';

type LuaPersistenceFailureMode = 'error' | 'warning';
type LuaPersistenceFailureKind = 'fetch' | 'persist' | 'apply' | 'restore';

export type LuaPersistenceFailurePolicy = {
	[K in LuaPersistenceFailureKind]: LuaPersistenceFailureMode;
};


export const DEFAULT_LUA_FAILURE_POLICY: LuaPersistenceFailurePolicy = {
	fetch: 'warning',
	persist: 'error',
	apply: 'error',
	restore: 'error',
};

const luaFailurePolicy: LuaPersistenceFailurePolicy = { ...DEFAULT_LUA_FAILURE_POLICY };

export async function saveLuaResourceSource(asset_id: string, source: string): Promise<void> {
	const cart = $.rompack.cart;
	const asset = cart.lua[asset_id];
	const cartPath = asset.normalized_source_path;
	await persistLuaSourceToFilesystem(cartPath, source);
	asset.src = source;
	asset.update_timestamp = $.platform.clock.dateNow();
	const chunkName = asset.chunk_name ?? `@lua/${asset.resid}`;
	cart.chunk2lua![chunkName] = asset;
	cart.source2lua![cartPath] = asset;
	BmsxConsoleRuntime.instance.markSourceAssetAsDirty(asset_id);
}

export async function createLuaResource(request: ConsoleLuaResourceCreationRequest): Promise<ConsoleResourceDescriptor> {
	const contents = typeof request.contents === 'string' ? request.contents : '';
	const path = request.path;
	const slashIndex = path.lastIndexOf('/');
	const fileName = slashIndex === -1 ? path : path.slice(slashIndex + 1);
	const baseName = fileName.endsWith('.lua') ? fileName.slice(0, -4) : fileName;
	const asset_id = typeof request.asset_id === 'string' && request.asset_id.length > 0 ? request.asset_id : baseName;
	const asset: RomLuaAsset = {
		resid: asset_id,
		type: 'lua',
		src: contents,
		source_path: path,
		update_timestamp: $.platform.clock.dateNow(),
	};
	const cart = $.rompack.cart;
	cart.lua[asset_id] = asset;
	normalizeLuaAsset(cart, asset);

	const filesystemPath = asset.normalized_source_path;
	await persistLuaSourceToFilesystem(filesystemPath, contents);
	BmsxConsoleRuntime.instance.markSourceAssetAsDirty(asset_id);
	const descriptor: ConsoleResourceDescriptor = { path: asset.normalized_source_path, type: 'lua', asset_id };
	return descriptor;
}

export function joinWorkspacePaths(...segments: string[]): string {
	return segments
		.filter(segment => segment.length > 0)
		.join('/')
		.replace(/\/+/g, '/');
}

export function sanitizeWorkspaceFilenameSegment(value: string): string {
	const replaced = value.replace(/[^A-Za-z0-9._-]/g, '_').replace(/_+/g, '_');
	const trimmed = replaced.replace(/^[_\.]+/, '');
	return trimmed.length > 0 ? trimmed : 'untitled';
}

export function buildWorkspaceMetadataPath(projectRootPath: string): string {
	return joinWorkspacePaths(projectRootPath, WORKSPACE_METADATA_DIR);
}

export function buildWorkspaceDirtyDir(projectRootPath: string): string {
	return joinWorkspacePaths(buildWorkspaceMetadataPath(projectRootPath), WORKSPACE_DIRTY_DIR);
}

export function buildWorkspaceDirtyEntryPath(projectRootPath: string, resourcePath: string): string {
	const segments = resourcePath.split('/');
	const baseName = segments.pop() ?? resourcePath;
	const tempName = baseName.startsWith('~') ? baseName : `~${baseName}`;
	segments.push(tempName);
	return joinWorkspacePaths(buildWorkspaceDirtyDir(projectRootPath), ...segments);
}

export function buildWorkspaceScratchDirtyPath(projectRootPath: string, contextId: string): string {
	const sanitized = sanitizeWorkspaceFilenameSegment(contextId);
	const baseName = sanitized.endsWith('.lua') ? sanitized : `${sanitized}.lua`;
	const tempName = baseName.startsWith('~') ? baseName : `~${baseName}`;
	return joinWorkspacePaths(buildWorkspaceDirtyDir(projectRootPath), '__scratch__', tempName);
}

export function buildWorkspaceStateFilePath(projectRootPath: string): string {
	return joinWorkspacePaths(buildWorkspaceMetadataPath(projectRootPath), WORKSPACE_STATE_FILE);
}

export function buildWorkspaceStorageKey(projectRootPath: string, relativePath: string): string {
	return `${WORKSPACE_STORAGE_PREFIX}:${projectRootPath}:${relativePath}`;
}

export type WorkspaceOverrideRecord = { source: string; path: string; cartPath: string; updatedAt?: number };
type WorkspaceStoragePayload = { contents: string; updatedAt: number };

export function collectWorkspaceOverrides(params: { rompack: RomPack; projectRootPath: string; storage: StorageService; }): Map<string, WorkspaceOverrideRecord> {
	const overrides = new Map<string, WorkspaceOverrideRecord>();
	const rootRaw = params.projectRootPath;
	if (!rootRaw) {
		return overrides;
	}
	const root = rootRaw;
	const storage = params.storage;
	for (const asset of Object.values(params.rompack.cart.lua)) {
		const cartPath = asset.normalized_source_path;
		const dirtyPath = buildWorkspaceDirtyEntryPath(root, cartPath);
		let bestSource: string = null;
		let bestUpdatedAt = asset.update_timestamp ?? 0;
		let bestPath: string = null;
		const considerStored = (raw: string, path: string, storageKey: string): void => {
			const parsed = JSON.parse(raw) as WorkspaceStoragePayload;
			if (parsed.contents === asset.src) {
				storage.removeItem(storageKey);
				return;
			}
			if (parsed.updatedAt <= bestUpdatedAt) {
				return;
			}
			bestSource = parsed.contents;
			bestUpdatedAt = parsed.updatedAt;
			bestPath = path;
		};
		const storageKey = buildWorkspaceStorageKey(root, dirtyPath);
		const storedDirty = storage.getItem(storageKey);
		if (storedDirty !== null) {
			considerStored(storedDirty, dirtyPath, storageKey);
		}
		const canonicalKey = buildWorkspaceStorageKey(root, cartPath);
		const storedCanonical = storage.getItem(canonicalKey);
		if (storedCanonical !== null) {
			considerStored(storedCanonical, cartPath, canonicalKey);
		}
		if (bestSource !== null) {
			overrides.set(asset.resid, { source: bestSource, path: bestPath, cartPath, updatedAt: bestUpdatedAt });
		}
	}
	return overrides;
}

function resolveWorkspacePathForIo(path: string, projectRootPath?: string): string {
	const root = projectRootPath ?? $.rompack.project_root_path;
	// If the path is already absolute or already includes the project root, leave it as-is.
	if (!root || path.startsWith(root) || path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)) {
		return path;
	}
	return joinWorkspacePaths(root, path);
}

export async function persistLuaSourceToFilesystem(path: string, source: string): Promise<void> {
	if (typeof fetch !== 'function') {
		throw new Error('[BmsxConsoleRuntime] Fetch API unavailable; cannot persist Lua source.');
	}
	let response: HttpResponse;
	try {
		response = await fetch(WORKSPACE_FILE_ENDPOINT, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ path: resolveWorkspacePathForIo(path), contents: source }),
		});
	} catch (error) {
		handleLuaPersistenceFailure('persist', `[BmsxConsoleRuntime] Failed to reach Lua save endpoint for '${path}'`, { error });
		if (luaFailurePolicy.persist === 'warning') {
			return;
		}
		return;
	}
	if (!response.ok) {
		let detail = '';
		try {
			detail = await response.text();
		} catch (textError) {
			const message = extractErrorMessage(textError);
			handleLuaPersistenceFailure('persist', `[BmsxConsoleRuntime] Save rejected for '${path}' (response body read failed)`, { detail: message });
			if (luaFailurePolicy.persist === 'warning') {
				return;
			}
			return;
		}
		let finalDetail = response.statusText;
		if (detail && detail.length > 0) {
			let parsed: unknown;
			try {
				parsed = JSON.parse(detail);
			} catch (parseError) {
				const parseMessage = extractErrorMessage(parseError);
				handleLuaPersistenceFailure('persist', `[BmsxConsoleRuntime] Save rejected for '${path}' (error payload parse failed)`, { detail: parseMessage });
				if (luaFailurePolicy.persist === 'warning') {
					return;
				}
				return;
			}
			if (parsed && typeof parsed === 'object' && 'error' in parsed) {
				const record = parsed as { error?: unknown };
				if (typeof record.error === 'string' && record.error.length > 0) {
					finalDetail = record.error;
				} else {
					finalDetail = detail;
				}
			} else {
				finalDetail = detail;
			}
		}
		handleLuaPersistenceFailure('persist', `[BmsxConsoleRuntime] Save rejected for '${path}'`, { detail: finalDetail });
		if (luaFailurePolicy.persist === 'warning') {
			return;
		}
		return;
	}
}

export async function fetchLuaSourceFromFilesystem(path: string): Promise<string> {
	if (typeof fetch !== 'function') {
		return null;
	}
	let response: HttpResponse;
	const resolvedPath = resolveWorkspacePathForIo(path);
	const url = `${WORKSPACE_FILE_ENDPOINT}?path=${encodeURIComponent(resolvedPath)}`;
	try {
		response = await fetch(url, { method: 'GET', cache: 'no-store' });
	} catch (error) {
		handleLuaPersistenceFailure('fetch', `[BmsxConsoleRuntime] Failed to load Lua source from filesystem (${path})`, { error });
		if (luaFailurePolicy.fetch === 'warning') {
			return null;
		}
		return null;
	}
	if (response.status === 404) {
		return null;
	}
	if (!response.ok) {
		let detail = '';
		try {
			detail = await response.text();
		} catch (textError) {
			const message = extractErrorMessage(textError);
			handleLuaPersistenceFailure('fetch', `[BmsxConsoleRuntime] Failed to load Lua source from '${path}' (response body read failed)`, { detail: message });
			if (luaFailurePolicy.fetch === 'warning') {
				return null;
			}
			return null;
		}
		let finalDetail = response.statusText;
		if (detail && detail.length > 0) {
			let parsed: unknown;
			try {
				parsed = JSON.parse(detail);
			} catch (parseError) {
				const parseMessage = extractErrorMessage(parseError);
				handleLuaPersistenceFailure('fetch', `[BmsxConsoleRuntime] Failed to load Lua source from '${path}' (error payload parse failed)`, { detail: parseMessage });
				if (luaFailurePolicy.fetch === 'warning') {
					return null;
				}
				return null;
			}
			if (parsed && typeof parsed === 'object' && 'error' in parsed) {
				const record = parsed as { error?: unknown };
				if (typeof record.error === 'string' && record.error.length > 0) {
					finalDetail = record.error;
				} else {
					finalDetail = detail;
				}
			} else {
				finalDetail = detail;
			}
		}
		handleLuaPersistenceFailure('fetch', `[BmsxConsoleRuntime] Failed to load Lua source from '${path}'`, { detail: finalDetail });
		if (luaFailurePolicy.fetch === 'warning') {
			return null;
		}
		return null;
	}
	let payload: unknown;
	try {
		payload = await response.json();
	} catch (parseError) {
		const message = extractErrorMessage(parseError);
		handleLuaPersistenceFailure('fetch', `[BmsxConsoleRuntime] Invalid response while loading Lua source from '${path}'`, { detail: message });
		if (luaFailurePolicy.fetch === 'warning') {
			return null;
		}
		return null;
	}
	if (!payload || typeof payload !== 'object') {
		handleLuaPersistenceFailure('fetch', `[BmsxConsoleRuntime] Response for '${path}' missing Lua contents`);
		if (luaFailurePolicy.fetch === 'warning') {
			return null;
		}
		return null;
	}
	const record = payload as { contents?: unknown };
	if (typeof record.contents !== 'string') {
		handleLuaPersistenceFailure('fetch', `[BmsxConsoleRuntime] Response for '${path}' missing Lua contents`);
		if (luaFailurePolicy.fetch === 'warning') {
			return null;
		}
		return null;
	}
	return record.contents;
}

function handleLuaPersistenceFailure(
	kind: LuaPersistenceFailureKind,
	context: string,
	options: { detail?: string; error?: unknown } = {}
): void {
	const runtime = BmsxConsoleRuntime.instance;
	const mode = luaFailurePolicy[kind];
	const parts: string[] = [context];
	if (options.detail && options.detail.length > 0) {
		parts.push(options.detail);
	}
	if (options.error !== undefined) {
		const reason = extractErrorMessage(options.error);
		if (reason.length > 0) {
			parts.push(reason);
		}
	}
	const message = parts.join(': ');
	if (mode === 'warning') {
		runtime.recordLuaWarning(message);
		return;
	}
	if (options.error instanceof Error) {
		const wrapped = new Error(message);
		// @ts-ignore - preserve original error via non-standard cause where available
		wrapped.cause = options.error;
		console.error(message, options.error);
		throw wrapped;
	}
	console.error(message);
	throw new Error(message);
}


// StorageService is injected because the workspace merge runs during boot before $.platform is fully wired;
// reaching back into $.platform.storage here races the runtime initialization.
export async function mergeWorkspaceOverrides(
	root: string,
	storage: StorageService,
	localOverrides: Map<string, WorkspaceOverrideRecord>,
	serverOverrides: Map<string, WorkspaceOverrideRecord>,
): Promise<Map<string, WorkspaceOverrideRecord>> {
	const merged = new Map<string, WorkspaceOverrideRecord>();
	const assetIds = new Set<string>([
		...localOverrides.keys(),
		...serverOverrides.keys(),
	]);

	function ensureLocalStorageHasLatestVersion(asset_id: string, override: WorkspaceOverrideRecord): void {
		if (root) { // Note that root may be empty string if project root is not set (e.g. in non-debug carts)
			persistWorkspaceOverridesToLocalStorage(storage, root, new Map([[asset_id, override]]));
		}
	}

	for (const asset_id of assetIds) {
		const local = localOverrides.get(asset_id); // Get local override
		const remote = serverOverrides.get(asset_id); // Get server override
		const localTime = local?.updatedAt ?? 0;
		const remoteTime = remote?.updatedAt ?? 0;
		if (local && (!remote || localTime >= remoteTime)) {
			merged.set(asset_id, local);
			ensureLocalStorageHasLatestVersion(asset_id, local);
			continue;
		}
		if (remote) {
			merged.set(asset_id, remote);
			ensureLocalStorageHasLatestVersion(asset_id, remote);
		}
	}
	return merged;
}

export async function fetchWorkspaceOverridesPriority(rompack: RomPack): Promise<Map<string, WorkspaceOverrideRecord>> {
	const root = rompack.project_root_path;
	if (!root) {
		return null;
	}
	try {
		const serverOverrides = await fetchWorkspaceDirtyLuaOverrides(rompack, root);
		return serverOverrides;
	} catch (error) {
		console.warn('[BmsxConsoleRuntime] Failed to load server workspace overrides; falling back to local overrides.', error);
		return null;
	}
}

export async function fetchWorkspaceDirtyLuaOverrides(rompack: RomPack, root: string): Promise<Map<string, WorkspaceOverrideRecord>> {
	const tasks: Array<Promise<{ asset_id: string; contents: string; path: string; cartPath: string; updatedAt?: number }>> = [];
	// Fetching dirty files from backend is best-effort. Missing files do NOT mean we should
	// discard in-memory dirty edits; they simply yield no extra overrides.
	for (const asset of Object.values(rompack.cart.lua)) {
		const asset_id = asset.resid;
		const cartPath = asset.normalized_source_path ?? asset.source_path ?? asset.resid;
		const dirtyPath = buildWorkspaceDirtyEntryPath(root, cartPath);
		tasks.push(fetchWorkspaceFile(dirtyPath).then((result) => {
			if (result === null) {
				return null;
			}
			return { asset_id, contents: result.contents, path: dirtyPath, cartPath, updatedAt: result.updatedAt };
		}));
	}
	if (tasks.length === 0) {
		return new Map<string, WorkspaceOverrideRecord>();
	}
	const results = await Promise.all(tasks);
	const overrides = new Map<string, WorkspaceOverrideRecord>();
	for (let index = 0; index < results.length; index += 1) {
		const result = results[index];
		if (!result) {
			continue;
		}
		overrides.set(result.asset_id, { source: result.contents, path: result.path, cartPath: result.cartPath, updatedAt: result.updatedAt });
	}
	return overrides;
}

export async function collectScratchWorkspaceDirtyPaths(root: string): Promise<Set<string>> {
	const paths = new Set<string>();
	if (!root) {
		return paths;
	}
	const statePath = buildWorkspaceStateFilePath(root);
	const payload = await fetchWorkspaceFile(statePath);
	if (!payload) {
		return paths;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(payload.contents);
	} catch {
		return paths;
	}
	if (!parsed || typeof parsed !== 'object') {
		return paths;
	}
	const record = parsed as { dirtyFiles?: Array<{ dirtyPath?: string; descriptor?: unknown }> };
	if (!Array.isArray(record.dirtyFiles)) {
		return paths;
	}
	for (let i = 0; i < record.dirtyFiles.length; i += 1) {
		const entry = record.dirtyFiles[i];
		if (!entry || typeof entry !== 'object') {
			continue;
		}
		if (entry.descriptor !== null && entry.descriptor !== undefined) {
			continue;
		}
		if (typeof entry.dirtyPath === 'string' && entry.dirtyPath.length > 0) {
			paths.add(entry.dirtyPath);
		}
	}
	return paths;
}

export async function fetchWorkspaceFile(path: string): Promise<{ contents: string; updatedAt?: number }> {
	const url = `${WORKSPACE_FILE_ENDPOINT}?path=${encodeURIComponent(path)}`;
	let response: HttpResponse;
	try {
		response = await fetch(url, { method: 'GET', cache: 'no-store' });
	} catch {
		console.info(`[BmsxConsoleRuntime] Failed to fetch workspace file '${path}'. No server response.`);
		return null;
	}
	if (response.status === 404) {
		return null;
	}
	if (!response.ok) {
		console.info(`[BmsxConsoleRuntime] Workspace file request failed for '${path}' (HTTP ${response.status}).`);
		return null;
	}
	let payload: unknown;
	try {
		payload = await response.json();
	} catch {
		console.warn(`[BmsxConsoleRuntime] Failed to parse workspace file response JSON for '${path}'.`);
		return null;
	}
	if (!payload || typeof payload !== 'object') {
		console.warn(`[BmsxConsoleRuntime] Invalid workspace file response payload for '${path}': ${JSON.stringify(payload)}`);
		return null;
	}
	const record = payload as { contents?: string; updatedAt?: number };
	if (typeof record.contents !== 'string') {
		console.warn(`[BmsxConsoleRuntime] Invalid workspace file response payload for '${path}': ${JSON.stringify(payload)}`);
		return null;
	}
	return { contents: record.contents, updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : undefined };
}

export async function deleteWorkspaceFile(path: string): Promise<void> {
	if (typeof fetch !== 'function') {
		console.warn('[BmsxConsoleRuntime] Fetch API is not available.');
		return;
	}
	const url = `${WORKSPACE_FILE_ENDPOINT}?path=${encodeURIComponent(path)}`;
	try {
		await fetch(url, { method: 'DELETE' });
	} catch {
		console.info('[BmsxConsoleRuntime] Failed to delete workspace file:', url);
		return;
	}
}

async function persistWorkspaceFileToServer(root: string, path: string, source: string): Promise<void> {
	if (typeof fetch !== 'function') {
		return;
	}
	const resolvedPath = resolveWorkspacePathForIo(path, root);
	try {
		const response = await fetch(WORKSPACE_FILE_ENDPOINT, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ path: resolvedPath, contents: source }),
		});
		if (!response.ok) {
			console.warn(`[BmsxWorkspace] Failed to push workspace file '${resolvedPath}' (HTTP ${response.status}).`);
		}
	} catch (error) {
		console.warn(`[BmsxWorkspace] Failed to push workspace file '${resolvedPath}'.`, error);
	}
}


export function persistWorkspaceOverridesToLocalStorage(storage: StorageService, root: string, overrides: Map<string, WorkspaceOverrideRecord>): void {
	for (const record of overrides.values()) {
		if (!record.path) {
			continue;
		}
		const storageKey = buildWorkspaceStorageKey(root, record.path);
		const payload = {
			contents: record.source,
			updatedAt: record.updatedAt ?? $.platform.clock.dateNow(),
		};
		storage.setItem(storageKey, JSON.stringify(payload));
	}
}

// Workspace sync flow:
// - The IDE autosaves dirty Lua files. When the HTTP workspace backend is reachable these writes hit the server,
//   otherwise they are staged in the provided StorageService under the dirty-path key so edits survive reloads.
//   StorageService comes from the caller because this path can execute before $.platform is ready.
// - On boot we first check the server for canonical cart paths (in case files were edited outside the IDE), then
//   gather dirty overrides from local storage and, when available, the workspace backend.
// - mergeWorkspaceOverrides compares local and remote dirty edits by updatedAt, chooses the freshest version for
//   each asset, and writes that winner back into StorageService. This means reconnecting after offline work will
//   either promote local edits (if newer) or replace stale local data with the server copy.
// - The canonical server file timestamps are compared against the merged overrides; the newest source always wins.
//   When the server copy is newer it is persisted into StorageService (using the canonical path) so offline boots
//   use the updated source instead of stale local edits.
//   When a local or server dirty override is newer than the canonical server file, the canonical file is pushed
//   to the server so that disk state catches up once connectivity returns.
// - The merged overrides are applied to cart.lua before the Lua VM starts so the running cart always reflects the
//   most recent edits regardless of where they were saved.
export async function applyWorkspaceOverridesToCart(params: { rompack: RomPack; storage: StorageService; includeServer?: boolean }): Promise<Set<string>> {
	const { rompack, storage } = params;
	const includeServer = params.includeServer !== false;
	const cart = rompack.cart;
	const changed = new Set<string>();
	const root = rompack.project_root_path;
	const localOverrides = collectWorkspaceOverrides({ rompack, projectRootPath: root, storage });
	const serverOverrides = includeServer ? await fetchWorkspaceOverridesPriority(rompack) : null;
	const merged = await mergeWorkspaceOverrides(root, storage, localOverrides, serverOverrides ?? new Map<string, WorkspaceOverrideRecord>());
	for (const asset of Object.values(cart.lua)) {
		const asset_id = asset.resid;
		const cartPath = asset.normalized_source_path ?? asset.source_path ?? asset.resid;
		const savedRecord = await fetchWorkspaceFile(cartPath);
		const canonicalRecord = savedRecord && savedRecord.contents !== asset.src
			? { source: savedRecord.contents, path: cartPath, cartPath, updatedAt: savedRecord.updatedAt }
			: null;
		const overrideRecord = merged.get(asset_id);
		if (overrideRecord && overrideRecord.source === asset.src) {
			const staleKey = root ? buildWorkspaceStorageKey(root, overrideRecord.path) : null;
			if (staleKey) {
				storage.removeItem(staleKey);
			}
			continue;
		}
		let winner: WorkspaceOverrideRecord = overrideRecord ?? null;
		let winnerKind: 'override' | 'canonical' | null = overrideRecord ? 'override' : null;
		let winnerUpdatedAt = overrideRecord ? (overrideRecord.updatedAt ?? 0) : -1;
		const canonicalUpdatedAt = canonicalRecord?.updatedAt ?? -1;
		if (canonicalRecord) {
			if (winner === null || canonicalUpdatedAt > winnerUpdatedAt) {
				winner = canonicalRecord;
				winnerKind = 'canonical';
				winnerUpdatedAt = canonicalUpdatedAt;
			}
		}
		if (!winner) {
			continue;
		}
		const romTimestamp = asset.update_timestamp ?? 0;
		if (winnerUpdatedAt >= 0 && winnerUpdatedAt <= romTimestamp && winner.source !== asset.src) {
			if (root) {
				const staleKey = buildWorkspaceStorageKey(root, winner.path);
				storage.removeItem(staleKey);
			}
			continue;
		}
		if (asset.src !== winner.source) {
			asset.src = winner.source;
			changed.add(asset_id);
		}
		if (root) {
			if (winnerKind === 'canonical') {
				const updatedRecord: WorkspaceOverrideRecord = { ...winner, path: cartPath, updatedAt: winnerUpdatedAt >= 0 ? winnerUpdatedAt : undefined };
				persistWorkspaceOverridesToLocalStorage(storage, root, new Map([[asset_id, updatedRecord]]));
				const localOverride = localOverrides.get(asset_id);
				if (localOverride) {
					const staleKey = buildWorkspaceStorageKey(root, localOverride.path);
					storage.removeItem(staleKey);
				}
			} else {
				const updatedAt = winnerUpdatedAt >= 0 ? winnerUpdatedAt : $.platform.clock.dateNow();
				const updatedRecord: WorkspaceOverrideRecord = { ...winner, updatedAt };
				persistWorkspaceOverridesToLocalStorage(storage, root, new Map([[asset_id, updatedRecord]]));
				if (includeServer && canonicalUpdatedAt < updatedAt) {
					await persistWorkspaceFileToServer(root, cartPath, winner.source);
					const canonicalUpdatedRecord: WorkspaceOverrideRecord = { ...winner, path: cartPath, updatedAt };
					persistWorkspaceOverridesToLocalStorage(storage, root, new Map([[asset_id, canonicalUpdatedRecord]]));
				}
			}
		}
	}
	return changed;
}

export async function clearWorkspaceArtifacts(cart: BmsxCartridge, storage: StorageService): Promise<void> {
	const root = $.rompack.project_root_path;
	if (!root) {
		return;
	}
	for (const asset of Object.values(cart.lua)) {
		const cartPath = asset.normalized_source_path ?? asset.source_path ?? asset.resid;
		const dirtyPath = buildWorkspaceDirtyEntryPath(root, cartPath);
		const storageKey = buildWorkspaceStorageKey(root, dirtyPath);
		storage.removeItem(storageKey);
		await deleteWorkspaceFile(dirtyPath);
	}
	const statePath = buildWorkspaceStateFilePath(root);
	const stateKey = buildWorkspaceStorageKey(root, statePath);
	storage.removeItem(stateKey);
	await deleteWorkspaceFile(statePath);
}

async function clearWorkspaceDirtyFiles(cart: BmsxCartridge, storage: StorageService): Promise<void> {
	const root = $.rompack.project_root_path;
	if (!root) {
		return;
	}
	const scratchPaths = await collectScratchWorkspaceDirtyPaths(root);
	for (const asset of Object.values(cart.lua)) {
		const cartPath = asset.normalized_source_path ?? asset.source_path ?? asset.resid;
		const dirtyPath = buildWorkspaceDirtyEntryPath(root, cartPath);
		const storageKey = buildWorkspaceStorageKey(root, dirtyPath);
		storage.removeItem(storageKey);
		await deleteWorkspaceFile(dirtyPath);
	}
	for (const dirtyPath of scratchPaths) {
		const storageKey = buildWorkspaceStorageKey(root, dirtyPath);
		storage.removeItem(storageKey);
		await deleteWorkspaceFile(dirtyPath);
	}
}

export async function resetWorkspaceDirtyBuffersAndStorage(): Promise<void> {
	const runtime = BmsxConsoleRuntime.instance;
	await clearWorkspaceDirtyFiles(runtime.cart, runtime.storageService);
	const editor = runtime.editor;
	if (editor) {
		editor.clearWorkspaceDirtyBuffers();
	}
}

export async function nukeWorkspaceState(): Promise<void> {
	const runtime = BmsxConsoleRuntime.instance;
	await clearWorkspaceArtifacts(runtime.cart, runtime.storageService);
	const editor = runtime.editor;
	if (editor) {
		editor.clearWorkspaceDirtyBuffers();
	}
}

export async function clearWorkspaceLuaOverrides(): Promise<void> {
	const runtime = BmsxConsoleRuntime.instance;
	await clearWorkspaceArtifacts(runtime.cart, runtime.storageService);
	// @ts-ignore - unused variable
	const changed = await applyWorkspaceOverridesToCart({ rompack: $.rompack, storage: runtime.storageService, includeServer: true });
	const editor = runtime.editor;
	if (editor) {
		runtime.editor.clearWorkspaceDirtyBuffers();
	}
	// if (changed.size > 0) {
	// 	await runtime.reloadProgramAndResetWorld({ runInit: true });
	// }
}
