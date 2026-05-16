import type { LuaSourceRegistry } from '../../machine/program/sources';
import type { HttpResponse, StorageService } from '../../platform/index';
import { workspaceSourceCache } from './cache';
import { joinWorkspacePaths, resolveWorkspacePath, stripProjectRootPrefix } from './path';
export { joinWorkspacePaths } from './path';

export const WORKSPACE_FILE_ENDPOINT = '/__bmsx__/lua';
export const WORKSPACE_STORAGE_PREFIX = 'bmsx.workspace';
export const WORKSPACE_METADATA_DIR = '.bmsx';
export const WORKSPACE_DIRTY_DIR = 'dirty';
export const WORKSPACE_STATE_FILE = 'ide-state.json';
export const WORKSPACE_MARKER_FILE = '~workspace';
export const DEFAULT_SYSTEM_PROJECT_ROOT_PATH = 'src/bmsx';

export type WorkspaceOverrideRecord = { source: string; path: string; cartPath: string; updatedAt?: number };
export type WorkspaceStoragePayload = { contents: string; updatedAt: number };
export type WorkspaceTextStorageEntry = { contents: string; updatedAt: number | null };
type WorkspaceStatePayload = { dirtyFiles: Array<{ dirtyPath: string; descriptor: unknown }> };
type WorkspaceWinnerKind = 'dirty' | 'canonical' | 'rom';

export function buildWorkspaceDirtyEntryPath(projectRootPath: string, resourcePath: string): string {
	const normalizedPath = stripProjectRootPrefix(resourcePath, projectRootPath);
	const segments = normalizedPath.split('/');
	const baseName = segments.pop() ?? resourcePath;
	const tempName = baseName.startsWith('~') ? baseName : `~${baseName}`;
	segments.push(tempName);
	return joinWorkspacePaths(projectRootPath, WORKSPACE_METADATA_DIR, WORKSPACE_DIRTY_DIR, ...segments);
}

export function buildWorkspaceStorageKey(projectRootPath: string, relativePath: string): string {
	return `${WORKSPACE_STORAGE_PREFIX}:${projectRootPath}:${relativePath}`;
}

export function readWorkspaceStoragePayload(storage: StorageService, storageKey: string): WorkspaceStoragePayload | null {
	const raw = storage.getItem(storageKey);
	if (raw === null) {
		return null;
	}
	let payload: WorkspaceStoragePayload;
	// start fallible-boundary -- local workspace storage is external persisted data and malformed payloads are discarded at this owner boundary.
	try {
		payload = JSON.parse(raw) as WorkspaceStoragePayload;
	} catch {
		storage.removeItem(storageKey);
		return null;
	}
	// end fallible-boundary
	return payload;
}

export function readWorkspaceTextStorageEntry(storage: StorageService, storageKey: string): WorkspaceTextStorageEntry | null {
	const raw = storage.getItem(storageKey);
	if (raw === null) {
		return null;
	}
	let parsed: unknown;
	// start fallible-boundary -- workspace file storage is external persisted text; raw legacy text entries remain valid terminal/debug payloads.
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { contents: raw, updatedAt: null };
	}
	// end fallible-boundary
	if (!parsed || typeof parsed !== 'object') {
		return { contents: raw, updatedAt: null };
	}
	const payload = parsed as { contents?: unknown; updatedAt?: unknown };
	if (typeof payload.contents !== 'string') {
		return { contents: raw, updatedAt: null };
	}
	return {
		contents: payload.contents,
		updatedAt: typeof payload.updatedAt === 'number' ? payload.updatedAt : null,
	};
}

function collectWorkspaceDirtyOverrides(params: { cart: LuaSourceRegistry; projectRootPath: string; storage: StorageService; }): Map<string, WorkspaceOverrideRecord> {
	const overrides = new Map<string, WorkspaceOverrideRecord>();
	const root = params.projectRootPath;
	const storage = params.storage;
	for (const asset of Object.values(params.cart.path2lua)) {
		const cartPath = asset.source_path;
		const dirtyPath = buildWorkspaceDirtyEntryPath(root, cartPath);
		const storageKey = buildWorkspaceStorageKey(root, dirtyPath);
		const storedDirty = readWorkspaceStoragePayload(storage, storageKey);
		if (storedDirty === null) {
			continue;
		}
		if (storedDirty.updatedAt <= asset.base_update_timestamp) {
			storage.removeItem(storageKey);
			continue;
		}
		overrides.set(cartPath, { source: storedDirty.contents, path: dirtyPath, cartPath, updatedAt: storedDirty.updatedAt });
	}
	return overrides;
}

export function collectWorkspaceOverrides(params: { cart: LuaSourceRegistry; projectRootPath: string; storage: StorageService; }): Map<string, WorkspaceOverrideRecord> {
	const overrides = new Map<string, WorkspaceOverrideRecord>();
	const root = params.projectRootPath;
	const storage = params.storage;
	for (const asset of Object.values(params.cart.path2lua)) {
		const cartPath = asset.source_path;
		const canonicalKey = buildWorkspaceStorageKey(root, cartPath);
		const storedCanonical = readWorkspaceStoragePayload(storage, canonicalKey);
		if (storedCanonical === null) {
			continue;
		}
		if (storedCanonical.updatedAt <= asset.base_update_timestamp) {
			storage.removeItem(canonicalKey);
			continue;
		}
		if (storedCanonical.contents === asset.base_src) {
			storage.removeItem(canonicalKey);
			continue;
		}
		overrides.set(cartPath, { source: storedCanonical.contents, path: cartPath, cartPath, updatedAt: storedCanonical.updatedAt });
	}
	return overrides;
}

function resolveOverrideUpdatedAt(record: WorkspaceOverrideRecord, fallback: number): number {
	return typeof record.updatedAt === 'number' ? record.updatedAt : fallback;
}

export async function persistWorkspaceSourceFile(path: string, source: string, projectRootPath: string): Promise<void> {
	let response: HttpResponse;
	try {
		response = await fetch(WORKSPACE_FILE_ENDPOINT, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ path: resolveWorkspacePath(path, projectRootPath), contents: source }),
		});
	} catch (error) {
		throw new Error(`Failed to reach save endpoint for '${path}': ${error}`);
	}
	if (!response.ok) {
		let detail: string;
		try {
			detail = await response.text();
		} catch (textError) {
			throw new Error(`Save rejected for '${path}' (response body read failed): ${textError}`);
		}
		const finalDetail = detail.length > 0 ? detail : response.statusText;
		throw new Error(`Save rejected for '${path}': ${finalDetail}`);
	}
}

export async function loadWorkspaceSourceFile(path: string, projectRootPath: string): Promise<string> {
	const cached = workspaceSourceCache.get(path);
	if (cached !== undefined) {
		return cached;
	}
	const file = await fetchWorkspaceFile(resolveWorkspacePath(path, projectRootPath));
	if (file !== null) {
		return file.contents;
	}
	return null;
}

export async function fetchWorkspaceDirtyLuaOverrides(cart: LuaSourceRegistry, root: string): Promise<Map<string, WorkspaceOverrideRecord>> {
	const tasks: Array<Promise<{ contents: string; path: string; filePath: string; updatedAt?: number }>> = [];
	// Fetching dirty files from backend is best-effort. Missing files do NOT mean we should
	// discard in-memory dirty edits; they simply yield no extra overrides.
	for (const asset of Object.values(cart.path2lua)) {
		const filePath = asset.source_path;
		const dirtyPath = buildWorkspaceDirtyEntryPath(root, filePath);
		tasks.push(fetchWorkspaceFile(dirtyPath).then((result) => {
			if (result === null) {
				return null;
			}
			return { contents: result.contents, path: dirtyPath, filePath, updatedAt: result.updatedAt };
		}));
	}
	const results = await Promise.all(tasks);
	const overrides = new Map<string, WorkspaceOverrideRecord>();
	for (let index = 0; index < results.length; index += 1) {
		const result = results[index];
		if (!result) {
			continue;
		}
		overrides.set(result.filePath, { source: result.contents, path: result.path, cartPath: result.filePath, updatedAt: result.updatedAt });
	}
	return overrides;
}

async function fetchWorkspaceCanonicalLua(cart: LuaSourceRegistry, root: string): Promise<Map<string, WorkspaceOverrideRecord>> {
	const tasks: Array<Promise<WorkspaceOverrideRecord>> = [];
	for (const asset of Object.values(cart.path2lua)) {
		const canonicalPath = resolveWorkspacePath(asset.source_path, root);
		tasks.push(fetchWorkspaceFile(canonicalPath).then((result) => {
			if (!result) {
				return null;
			}
			if (result.contents === asset.base_src) {
				return null;
			}
			const updatedAt = typeof result.updatedAt === 'number' ? result.updatedAt : 0;
			if (updatedAt <= asset.base_update_timestamp) {
				return null;
			}
			return {
				source: result.contents,
				path: asset.source_path,
				cartPath: asset.source_path,
				updatedAt,
			};
		}));
	}
	const results = await Promise.all(tasks);
	const records = new Map<string, WorkspaceOverrideRecord>();
	for (let index = 0; index < results.length; index += 1) {
		const record = results[index];
		if (!record) {
			continue;
		}
		records.set(record.cartPath, record);
	}
	return records;
}

export async function collectScratchWorkspaceDirtyPaths(root: string): Promise<Set<string>> {
	const paths = new Set<string>();
	const statePath = joinWorkspacePaths(root, WORKSPACE_METADATA_DIR, WORKSPACE_STATE_FILE);
	const payload = await fetchWorkspaceFile(statePath);
	if (!payload) {
		return paths;
	}
	let parsed: WorkspaceStatePayload;
	// start fallible-boundary -- workspace state is persisted user data; malformed state means no scratch dirty paths.
	try {
		parsed = JSON.parse(payload.contents) as WorkspaceStatePayload;
	} catch {
		return paths;
	}
	// end fallible-boundary
	for (let i = 0; i < parsed.dirtyFiles.length; i += 1) {
		const entry = parsed.dirtyFiles[i];
		if (entry.descriptor) {
			continue;
		}
		if (entry.dirtyPath.length > 0) {
			paths.add(entry.dirtyPath);
		}
	}
	return paths;
}

export async function fetchWorkspaceFile(path: string): Promise<{ contents: string; updatedAt?: number }> {
	const url = `${WORKSPACE_FILE_ENDPOINT}?path=${encodeURIComponent(path)}`;
	let response: HttpResponse;
	// start fallible-boundary -- workspace backend is optional; unavailable or malformed responses yield no server override.
	try {
		response = await fetch(url, { method: 'GET', cache: 'no-store' });
	} catch {
		console.info(`Failed to fetch workspace file '${path}'. No server response.`);
		return null;
	}
	if (response.status === 404) {
		return null;
	}
	if (!response.ok) {
		console.info(`Workspace file request failed for '${path}' (HTTP ${response.status}).`);
		return null;
	}
	let payload: unknown;
	try {
		payload = await response.json();
	} catch {
		console.warn(`Failed to parse workspace file response JSON for '${path}'.`);
		return null;
	}
	// end fallible-boundary
	const record = payload as { contents: string; updatedAt?: number };
	return { contents: record.contents, updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : undefined };
}

function selectDirtyOverride(
	local: WorkspaceOverrideRecord,
	remote: WorkspaceOverrideRecord,
	romTimestamp: number
): { record: WorkspaceOverrideRecord; updatedAt: number } {
	const localUpdatedAt = local ? resolveOverrideUpdatedAt(local, romTimestamp) : -1;
	const remoteUpdatedAt = remote ? resolveOverrideUpdatedAt(remote, romTimestamp) : -1;
	if (remote && (remoteUpdatedAt > localUpdatedAt || !local)) {
		return { record: remote, updatedAt: remoteUpdatedAt };
	}
	if (local) {
		return { record: local, updatedAt: localUpdatedAt };
	}
	return null;
}

function selectWorkspaceWinner(options: {
	romTimestamp: number;
	dirtyCandidate?: { record: WorkspaceOverrideRecord; updatedAt: number };
	canonicalCandidate?: WorkspaceOverrideRecord;
}): { kind: WorkspaceWinnerKind; record: WorkspaceOverrideRecord; updatedAt: number } {
	let winnerKind: WorkspaceWinnerKind = 'rom';
	let winner: WorkspaceOverrideRecord = null;
	let winnerUpdatedAt = options.romTimestamp;
	let winnerPriority = 0; // rom=0, canonical=1, override=2

	const dirtyCandidate = options.dirtyCandidate;
	if (dirtyCandidate) {
		const dirtyUpdatedAt = dirtyCandidate.updatedAt;
		const dirtyPriority = 2;
		if (dirtyUpdatedAt > winnerUpdatedAt || (dirtyUpdatedAt === winnerUpdatedAt && dirtyPriority > winnerPriority)) {
			winnerKind = 'dirty';
			winner = dirtyCandidate.record;
			winnerUpdatedAt = dirtyUpdatedAt;
			winnerPriority = dirtyPriority;
		}
	}

	const canonicalCandidate = options.canonicalCandidate;
	if (canonicalCandidate) {
		const canonicalUpdatedAt = resolveOverrideUpdatedAt(canonicalCandidate, options.romTimestamp);
		const canonicalPriority = 1;
		if (canonicalUpdatedAt > winnerUpdatedAt || (canonicalUpdatedAt === winnerUpdatedAt && canonicalPriority > winnerPriority)) {
			winnerKind = 'canonical';
			winner = canonicalCandidate;
			winnerUpdatedAt = canonicalUpdatedAt;
			winnerPriority = canonicalPriority;
		}
	}

	return { kind: winnerKind, record: winner, updatedAt: winnerUpdatedAt };
}

export async function deleteWorkspaceServerFile(path: string): Promise<void> {
	const url = `${WORKSPACE_FILE_ENDPOINT}?path=${encodeURIComponent(path)}`;
	// start fallible-boundary -- deleting remote workspace scratch files is best-effort cleanup.
	try {
		await fetch(url, { method: 'DELETE' });
	} catch {
		console.info('Failed to delete workspace file:', url);
		return;
	}
	// end fallible-boundary
}

async function persistWorkspaceFileToServer(root: string, path: string, source: string): Promise<void> {
	const resolvedPath = resolveWorkspacePath(path, root);
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

export function persistWorkspaceOverridesToLocalStorage(storage: StorageService, root: string, overrides: Map<string, WorkspaceOverrideRecord>, timestampNow: number): void {
	for (const record of overrides.values()) {
		const storageKey = buildWorkspaceStorageKey(root, record.path);
		const payload = {
			contents: record.source,
			updatedAt: record.updatedAt ?? timestampNow,
		};
		storage.setItem(storageKey, JSON.stringify(payload));
	}
}

// Workspace sync flow:
// - Dirty Lua writes are staged locally and, when available, mirrored to the workspace backend.
// - On boot we gather three sources per asset: local dirty storage, server dirty storage, and the canonical file on
//   disk (server). We deterministically pick the freshest by timestamp with a priority order of dirty > canonical > ROM.
// - Dirty content only ever persists on the dirty path. Canonical storage is reserved for explicit saves.
// - If the canonical winner is fresher than the remote canonical file we push it back to disk to converge the saved state.
export async function applyWorkspaceSourceOverrides(params: { registry: LuaSourceRegistry; storage: StorageService; timestampNow: number; includeServer?: boolean; projectRootPath: string }): Promise<Set<string>> {
	const { registry, storage } = params;
	const includeServer = params.includeServer !== false;
	const changed = new Set<string>();
	const root = params.projectRootPath;

	const localDirtyOverrides = collectWorkspaceDirtyOverrides({ cart: registry, projectRootPath: root, storage });
	const localCanonicalOverrides = collectWorkspaceOverrides({ cart: registry, projectRootPath: root, storage });
	let serverOverrides = new Map<string, WorkspaceOverrideRecord>();
	let canonicalOverrides = new Map<string, WorkspaceOverrideRecord>();
	if (includeServer) {
		serverOverrides = await fetchWorkspaceDirtyLuaOverrides(registry, root);
		canonicalOverrides = await fetchWorkspaceCanonicalLua(registry, root);
	}

	for (const asset of Object.values(registry.path2lua)) {
		const filePath = asset.source_path;
		const pathBinding = registry.path2lua[asset.source_path];
		const persistedBaselineTimestamp = asset.base_update_timestamp;
		const localDirty = localDirtyOverrides.get(filePath);
		const serverDirty = serverOverrides.get(filePath);
		const dirtyCandidate = selectDirtyOverride(localDirty, serverDirty, persistedBaselineTimestamp);
		const remoteCanonicalCandidate = canonicalOverrides.get(filePath);
		const canonicalCandidate = remoteCanonicalCandidate ?? localCanonicalOverrides.get(filePath);
		const remoteCanonicalUpdatedAt = remoteCanonicalCandidate ? resolveOverrideUpdatedAt(remoteCanonicalCandidate, persistedBaselineTimestamp) : -1;

		const winner = selectWorkspaceWinner({
			romTimestamp: persistedBaselineTimestamp,
			dirtyCandidate,
			canonicalCandidate,
		});
		const dirtyPath = buildWorkspaceDirtyEntryPath(root, filePath);
		const dirtyKey = buildWorkspaceStorageKey(root, dirtyPath);
		const canonicalKey = buildWorkspaceStorageKey(root, filePath);

		if (winner.kind === 'rom') {
			if (asset.src !== asset.base_src || pathBinding.src !== asset.base_src) {
				changed.add(filePath);
			}
			asset.src = asset.base_src;
			pathBinding.src = asset.base_src;
			asset.update_timestamp = persistedBaselineTimestamp;
			pathBinding.update_timestamp = persistedBaselineTimestamp;
			storage.removeItem(dirtyKey);
			storage.removeItem(canonicalKey);
			workspaceSourceCache.delete(dirtyPath);
			workspaceSourceCache.delete(filePath);
			continue;
		}

		const nextSource = winner.record.source;
		if (asset.src !== nextSource || pathBinding.src !== nextSource) {
			changed.add(filePath);
		}
		asset.src = nextSource;
		pathBinding.src = nextSource;
		const updatedAt = winner.updatedAt >= 0 ? winner.updatedAt : params.timestampNow;
		asset.update_timestamp = updatedAt;
		pathBinding.update_timestamp = updatedAt;

		if (winner.kind === 'dirty') {
			const dirtyRecord: WorkspaceOverrideRecord = { ...winner.record, path: dirtyPath, cartPath: filePath, updatedAt };
			persistWorkspaceOverridesToLocalStorage(storage, root, new Map([[filePath, dirtyRecord]]), params.timestampNow);
			workspaceSourceCache.set(dirtyPath, nextSource);
			workspaceSourceCache.delete(filePath);
		} else {
			asset.base_update_timestamp = updatedAt;
			pathBinding.base_update_timestamp = updatedAt;
			const canonicalRecord: WorkspaceOverrideRecord = { ...winner.record, path: filePath, cartPath: filePath, updatedAt };
			persistWorkspaceOverridesToLocalStorage(storage, root, new Map([[filePath, canonicalRecord]]), params.timestampNow);
			storage.removeItem(dirtyKey);
			workspaceSourceCache.delete(dirtyPath);
			workspaceSourceCache.set(filePath, nextSource);
		}

		if (winner.kind === 'canonical' && includeServer && remoteCanonicalUpdatedAt < updatedAt) {
			await persistWorkspaceFileToServer(root, filePath, winner.record.source);
			const canonicalSynced: WorkspaceOverrideRecord = { ...winner.record, path: filePath, cartPath: filePath, updatedAt };
			persistWorkspaceOverridesToLocalStorage(storage, root, new Map([[filePath, canonicalSynced]]), params.timestampNow);
		}
	}
	return changed;
}
