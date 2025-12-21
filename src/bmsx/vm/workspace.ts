import { extractErrorMessage } from '../lua/luavalue';
import type { HttpResponse, StorageService } from '../platform';
import type { LuaSourceRecord, LuaSourceRegistry } from './lua_sources';
import { BmsxVMRuntime } from './vm_tooling_runtime';
import { $ } from '../core/engine_core';
import { VMLuaResourceCreationRequest, VMResourceDescriptor } from './types';

export const WORKSPACE_FILE_ENDPOINT = '/__bmsx__/lua';
export const WORKSPACE_STORAGE_PREFIX = 'bmsx.workspace';
export const WORKSPACE_METADATA_DIR = '.bmsx';
export const WORKSPACE_DIRTY_DIR = 'dirty';
export const WORKSPACE_STATE_FILE = 'ide-state.json';
export const WORKSPACE_MARKER_FILE = '~workspace';

export type WorkspaceOverrideRecord = { source: string; path: string; cartPath: string; updatedAt?: number };
type WorkspaceStoragePayload = { contents: string; updatedAt: number };
type WorkspaceWinnerKind = 'override' | 'canonical' | 'rom';

export async function saveLuaResourceSource(path: string, source: string): Promise<void> {
	const cart = $.luaSources;
	const asset = cart.path2lua[path];
	const absPath = asset.source_path;
	await persistLuaSourceToFilesystem(absPath, source);
	asset.src = source;
	asset.update_timestamp = $.platform.clock.dateNow();
	cart.path2lua![path] = asset;
	cart.path2lua![absPath] = asset;
	BmsxVMRuntime.instance.markSourceChunkAsDirty(path);
}

export async function createLuaResource(request: VMLuaResourceCreationRequest): Promise<VMResourceDescriptor> {
	const contents = typeof request.contents === 'string' ? request.contents : '';
	const path = request.path;
	const slashIndex = path.lastIndexOf('/');
	const fileName = slashIndex === -1 ? path : path.slice(slashIndex + 1);
	const baseName = fileName.endsWith('.lua') ? fileName.slice(0, -4) : fileName;
	const asset_id = baseName;
	const asset: LuaSourceRecord = {
		resid: asset_id,
		type: 'lua',
		src: contents,
		base_src: contents,
		source_path: path,
		normalized_source_path: path,
		update_timestamp: $.platform.clock.dateNow(),
	};
	const registerAsset = (cart: LuaSourceRegistry): void => {
		cart.path2lua![asset.source_path] = asset;
		cart.path2lua![asset.normalized_source_path] = asset;
	};
	registerAsset($.luaSources);
	BmsxVMRuntime.instance.invalidateVmModuleAliases();
	const filesystemPath = asset.source_path;
	await persistLuaSourceToFilesystem(filesystemPath, contents);
	BmsxVMRuntime.instance.markSourceChunkAsDirty(asset.source_path);
	const descriptor: VMResourceDescriptor = { path: asset.source_path, type: 'lua' };
	return descriptor;
}

export function joinWorkspacePaths(...segments: string[]): string {
	return segments
		.filter(segment => segment.length > 0)
		.join('/')
		.replace(/\/+/g, '/');
}

function stripProjectRootPrefix(resourcePath: string, projectRootPath: string): string {
	const normalizedRoot = projectRootPath ? projectRootPath.replace(/^\.?\//, '') : '';
	const normalizedPath = resourcePath.replace(/^\.?\//, '');
	if (normalizedRoot.length === 0) {
		return normalizedPath;
	}
	if (normalizedPath.startsWith(normalizedRoot)) {
		const sliced = normalizedPath.slice(normalizedRoot.length);
		return sliced.startsWith('/') ? sliced.slice(1) : sliced;
	}
	return normalizedPath;
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
	const normalizedPath = stripProjectRootPrefix(resourcePath, projectRootPath);
	const segments = normalizedPath.split('/');
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

export function collectWorkspaceOverrides(params: { cart: LuaSourceRegistry; projectRootPath: string; storage: StorageService; }): Map<string, WorkspaceOverrideRecord> {
	const overrides = new Map<string, WorkspaceOverrideRecord>();
	const rootRaw = params.projectRootPath;
	if (!rootRaw) {
		return overrides;
	}
	const root = rootRaw;
	const storage = params.storage;
	for (const asset of Object.values(params.cart.path2lua)) {
		const cartPath = asset.normalized_source_path;
		const dirtyPath = buildWorkspaceDirtyEntryPath(root, cartPath);
		let bestSource: string = null;
		let bestUpdatedAt = asset.update_timestamp ?? 0;
		let bestPath: string = null;
		const considerStored = (raw: string, path: string, storageKey: string): void => {
			let parsed: WorkspaceStoragePayload;
			try {
				parsed = JSON.parse(raw) as WorkspaceStoragePayload;
			} catch {
				storage.removeItem(storageKey);
				return;
			}
			if (!parsed || typeof parsed.contents !== 'string' || typeof parsed.updatedAt !== 'number') {
				storage.removeItem(storageKey);
				return;
			}
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
			overrides.set(cartPath, { source: bestSource, path: bestPath, cartPath, updatedAt: bestUpdatedAt });
		}
	}
	return overrides;
}

function resolveOverrideUpdatedAt(record: WorkspaceOverrideRecord, fallback: number): number {
	return typeof record.updatedAt === 'number' ? record.updatedAt : fallback;
}

function resolveWorkspacePathForIo(path: string, projectRootPath?: string): string {
	const root = projectRootPath ?? $.assets.project_root_path;
	if (path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)) {
		return path;
	}
	if (!root) {
		return path;
	}
	const normalizedRoot = root.replace(/^\.?\//, '');
	const normalizedPath = path.replace(/^\.?\//, '');
	if (normalizedPath.startsWith(normalizedRoot)) {
		return normalizedPath;
	}
	return joinWorkspacePaths(root, path);
}

export async function persistLuaSourceToFilesystem(path: string, source: string): Promise<void> {
	if (typeof fetch !== 'function') {
		throw new Error('[BmsxVMRuntime] Fetch API unavailable; cannot persist Lua source.');
	}
	let response: HttpResponse;
	try {
		response = await fetch(WORKSPACE_FILE_ENDPOINT, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ path: resolveWorkspacePathForIo(path), contents: source }),
		});
	} catch (error) {
		handleLuaPersistenceFailure('persist', `[BmsxVMRuntime] Failed to reach Lua save endpoint for '${path}': ${error}`);
		return;
	}
	if (!response.ok) {
		let detail = '';
		try {
			detail = await response.text();
		} catch (textError) {
			handleLuaPersistenceFailure('persist', `[BmsxVMRuntime] Save rejected for '${path}' (response body read failed): ${textError}`);
			return;
		}
		let finalDetail = response.statusText;
		if (detail && detail.length > 0) {
			let parsed: unknown;
			try {
				parsed = JSON.parse(detail);
			} catch (parseError) {
				const parseMessage = extractErrorMessage(parseError);
				handleLuaPersistenceFailure('persist', { detail: `[BmsxVMRuntime] Save rejected for '${path}' (error payload parse failed): ${parseMessage}`, error: parseError });
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
		handleLuaPersistenceFailure('persist', `[BmsxVMRuntime] Save rejected for '${path}': ${finalDetail}`);
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
		handleLuaPersistenceFailure('fetch', { detail: `[BmsxVMRuntime] Failed to load Lua source from filesystem (${path})`, error });
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
			handleLuaPersistenceFailure('fetch', { detail: `[BmsxVMRuntime] Failed to load Lua source from '${path}' (response body read failed): ${message}`, error: textError });
			return null;
		}
		let finalDetail = response.statusText;
		if (detail && detail.length > 0) {
			let parsed: unknown;
			try {
				parsed = JSON.parse(detail);
			} catch (parseError) {
				const parseMessage = extractErrorMessage(parseError);
				handleLuaPersistenceFailure('fetch', { detail: `[BmsxVMRuntime] Failed to load Lua source from '${path}' (error payload parse failed): ${parseMessage}`, error: parseError });
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
		handleLuaPersistenceFailure('fetch', { detail: `[BmsxVMRuntime] Failed to load Lua source from '${path}': ${finalDetail}` });
		return null;
	}
	let payload: unknown;
	try {
		payload = await response.json();
	} catch (parseError) {
		const message = extractErrorMessage(parseError);
		handleLuaPersistenceFailure('fetch', { detail: `[BmsxVMRuntime] Invalid response while loading Lua source from '${path}': ${message}`, error: parseError });
		return null;
	}
	if (!payload || typeof payload !== 'object') {
		handleLuaPersistenceFailure('fetch', { detail: `[BmsxVMRuntime] Response for '${path}' missing Lua contents` });
		return null;
	}
	const record = payload as { contents?: unknown };
	if (typeof record.contents !== 'string') {
		handleLuaPersistenceFailure('fetch', { detail: `[BmsxVMRuntime] Response for '${path}' missing Lua contents` });
		return null;
	}
	return record.contents;
}

function handleLuaPersistenceFailure(
	context: string,
	options: string | { detail?: string; error?: unknown } = {}
): void {
	const runtime = BmsxVMRuntime.instance;
	if (typeof options === 'string') {
		runtime.recordLuaWarning(options);
		return;
	}
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
	runtime.recordLuaWarning(message);
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
	const overridePaths = new Set<string>([
		...localOverrides.keys(),
		...serverOverrides.keys(),
	]);

	function ensureLocalStorageHasLatestVersion(path: string, override: WorkspaceOverrideRecord): void {
		if (root) { // Note that root may be empty string if project root is not set (e.g. in non-debug carts)
			persistWorkspaceOverridesToLocalStorage(storage, root, new Map([[path, override]]));
		}
	}

	for (const path of overridePaths) {
		const local = localOverrides.get(path);
		const remote = serverOverrides.get(path);
		const localTime = local?.updatedAt ?? 0;
		const remoteTime = remote?.updatedAt ?? 0;
		if (local && (!remote || localTime >= remoteTime)) {
			merged.set(path, local);
			ensureLocalStorageHasLatestVersion(path, local);
			continue;
		}
		if (remote) {
			merged.set(path, remote);
			ensureLocalStorageHasLatestVersion(path, remote);
		}
	}
	return merged;
}

export async function fetchWorkspaceOverridesPriority(cart: LuaSourceRegistry): Promise<Map<string, WorkspaceOverrideRecord>> {
	const root = $.assets.project_root_path;
	try {
		const serverOverrides = await fetchWorkspaceDirtyLuaOverrides(cart, root);
		return serverOverrides;
	} catch (error) {
		console.warn('[BmsxVMRuntime] Failed to load server workspace overrides; falling back to local overrides.', error);
		return new Map<string, WorkspaceOverrideRecord>();
	}
}

export async function fetchWorkspaceDirtyLuaOverrides(cart: LuaSourceRegistry, root: string): Promise<Map<string, WorkspaceOverrideRecord>> {
	const tasks: Array<Promise<{ contents: string; path: string; filePath: string; updatedAt?: number }>> = [];
	// Fetching dirty files from backend is best-effort. Missing files do NOT mean we should
	// discard in-memory dirty edits; they simply yield no extra overrides.
	for (const asset of Object.values(cart.path2lua)) {
		const filePath = asset.normalized_source_path;
		const dirtyPath = buildWorkspaceDirtyEntryPath(root, filePath);
		tasks.push(fetchWorkspaceFile(dirtyPath).then((result) => {
			if (result === null) {
				return null;
			}
			return { contents: result.contents, path: dirtyPath, filePath, updatedAt: result.updatedAt };
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
		overrides.set(result.filePath, { source: result.contents, path: result.path, cartPath: result.filePath, updatedAt: result.updatedAt });
	}
	return overrides;
}

async function fetchWorkspaceCanonicalLua(cart: LuaSourceRegistry, root: string): Promise<Map<string, WorkspaceOverrideRecord>> {
	const tasks: Array<Promise<WorkspaceOverrideRecord>> = [];
	for (const asset of Object.values(cart.path2lua)) {
		const canonicalPath = resolveWorkspacePathForIo(asset.normalized_source_path, root);
		tasks.push(fetchWorkspaceFile(canonicalPath).then((result) => {
			if (!result) {
				return null;
			}
			if (result.contents === asset.src) {
				return null;
			}
			const updatedAt = typeof result.updatedAt === 'number' ? result.updatedAt : asset.update_timestamp ?? 0;
			return {
				source: result.contents,
				path: asset.normalized_source_path,
				cartPath: asset.normalized_source_path,
				updatedAt,
			};
		}));
	}
	if (tasks.length === 0) {
		return new Map<string, WorkspaceOverrideRecord>();
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
		console.info(`[BmsxVMRuntime] Failed to fetch workspace file '${path}'. No server response.`);
		return null;
	}
	if (response.status === 404) {
		return null;
	}
	if (!response.ok) {
		console.info(`[BmsxVMRuntime] Workspace file request failed for '${path}' (HTTP ${response.status}).`);
		return null;
	}
	let payload: unknown;
	try {
		payload = await response.json();
	} catch {
		console.warn(`[BmsxVMRuntime] Failed to parse workspace file response JSON for '${path}'.`);
		return null;
	}
	if (!payload || typeof payload !== 'object') {
		console.warn(`[BmsxVMRuntime] Invalid workspace file response payload for '${path}': ${JSON.stringify(payload)}`);
		return null;
	}
	const record = payload as { contents?: string; updatedAt?: number };
	if (typeof record.contents !== 'string') {
		console.warn(`[BmsxVMRuntime] Invalid workspace file response payload for '${path}': ${JSON.stringify(payload)}`);
		return null;
	}
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
			winnerKind = 'override';
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

export async function deleteWorkspaceFile(path: string): Promise<void> {
	if (typeof fetch !== 'function') {
		console.warn('[BmsxVMRuntime] Fetch API is not available.');
		return;
	}
	const url = `${WORKSPACE_FILE_ENDPOINT}?path=${encodeURIComponent(path)}`;
	try {
		await fetch(url, { method: 'DELETE' });
	} catch {
		console.info('[BmsxVMRuntime] Failed to delete workspace file:', url);
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
// - Dirty Lua writes are staged locally and, when available, mirrored to the workspace backend.
// - On boot we gather three sources per asset: local dirty storage, server dirty storage, and the canonical file on
//   disk (server). We deterministically pick the freshest by timestamp with a priority order of dirty > canonical > ROM.
// - The winning source is applied to the running cart and written back to storage (both canonical and dirty slots when
//   relevant). If the winner is fresher than the server canonical file we push it back to disk to converge the state.
export async function applyWorkspaceOverridesToCart(params: { cart: LuaSourceRegistry; storage: StorageService; includeServer?: boolean }): Promise<Set<string>> {
	const { cart, storage } = params;
	const includeServer = params.includeServer !== false;
	const changed = new Set<string>();
	const root = $.assets.project_root_path;

	const localOverrides = collectWorkspaceOverrides({ cart, projectRootPath: root, storage });
	const serverOverrides = includeServer ? await fetchWorkspaceOverridesPriority(cart) : new Map<string, WorkspaceOverrideRecord>();
	const canonicalOverrides = includeServer ? await fetchWorkspaceCanonicalLua(cart, root) : new Map<string, WorkspaceOverrideRecord>();

	for (const asset of Object.values(cart.path2lua)) {
		const filePath = asset.normalized_source_path;
		const romTimestamp = asset.update_timestamp ?? 0;
		const localDirty = localOverrides.get(filePath);
		const serverDirty = serverOverrides.get(filePath);
		const dirtyCandidate = selectDirtyOverride(localDirty, serverDirty, romTimestamp);
		const canonicalCandidate = canonicalOverrides.get(filePath);
		const canonicalUpdatedAt = canonicalCandidate ? resolveOverrideUpdatedAt(canonicalCandidate, romTimestamp) : -1;

		let activeDirtyCandidate = dirtyCandidate ?? undefined;
		if (dirtyCandidate && dirtyCandidate.record.source === asset.src) {
			activeDirtyCandidate = undefined;
			if (root) {
				const dirtyPath = buildWorkspaceDirtyEntryPath(root, filePath);
				const staleKey = buildWorkspaceStorageKey(root, dirtyPath);
				storage.removeItem(staleKey);
			}
		}

		const winner = selectWorkspaceWinner({
			romTimestamp,
			dirtyCandidate: activeDirtyCandidate,
			canonicalCandidate,
		});

		if (winner.kind === 'rom') {
			if (root) {
				const dirtyPath = buildWorkspaceDirtyEntryPath(root, filePath);
				const dirtyKey = buildWorkspaceStorageKey(root, dirtyPath);
				const canonicalKey = buildWorkspaceStorageKey(root, filePath);
				storage.removeItem(dirtyKey);
				storage.removeItem(canonicalKey);
			}
			continue;
		}

		// Keep `path2lua` and `path2lua` in sync.
		// The VM executes sources via `$.luaSources.path2lua[...]` (see `BmsxVMRuntime.resourceSourceForChunk()`), while
		// workspace merges/overrides are keyed by path via `path2lua[...]`. These two maps are expected to point at
		// the same `LuaSourceRecord` objects, so we always set both here.
		const nextSource = winner.record.source;
		const pathBinding = cart.path2lua[asset.source_path];
		if (asset.src !== nextSource || pathBinding.src !== nextSource) {
			changed.add(filePath);
		}
		asset.src = nextSource;
		pathBinding.src = nextSource;

		if (!root) {
			continue;
		}

		const updatedAt = winner.updatedAt >= 0 ? winner.updatedAt : $.platform.clock.dateNow();
		const canonicalRecord: WorkspaceOverrideRecord = { ...winner.record, path: filePath, cartPath: filePath, updatedAt };
		persistWorkspaceOverridesToLocalStorage(storage, root, new Map([[filePath, canonicalRecord]]));

		const dirtyPath = buildWorkspaceDirtyEntryPath(root, filePath);
		const dirtyKey = buildWorkspaceStorageKey(root, dirtyPath);
		if (winner.kind === 'override') {
			const dirtyRecord: WorkspaceOverrideRecord = { ...winner.record, path: dirtyPath, cartPath: filePath, updatedAt };
			persistWorkspaceOverridesToLocalStorage(storage, root, new Map([[filePath, dirtyRecord]]));
		} else {
			storage.removeItem(dirtyKey);
		}

		if (includeServer && canonicalUpdatedAt < updatedAt) {
			await persistWorkspaceFileToServer(root, filePath, winner.record.source);
			const canonicalSynced: WorkspaceOverrideRecord = { ...winner.record, path: filePath, cartPath: filePath, updatedAt };
			persistWorkspaceOverridesToLocalStorage(storage, root, new Map([[filePath, canonicalSynced]]));
		}
	}
	return changed;
}

export async function clearWorkspaceArtifacts(cart: LuaSourceRegistry, storage: StorageService): Promise<void> {
	const root = $.assets.project_root_path;
	for (const asset of Object.values(cart.path2lua)) {
		const cartPath = asset.normalized_source_path;
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

async function clearWorkspaceDirtyFiles(cart: LuaSourceRegistry, storage: StorageService): Promise<void> {
	const root = $.assets.project_root_path;
	const scratchPaths = await collectScratchWorkspaceDirtyPaths(root);
	for (const asset of Object.values(cart.path2lua)) {
		const cartPath = asset.normalized_source_path;
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
	const runtime = BmsxVMRuntime.instance;
	await clearWorkspaceDirtyFiles($.luaSources, runtime.storageService);
	runtime.editor.clearWorkspaceDirtyBuffers();
}

export async function nukeWorkspaceState(): Promise<void> {
	const runtime = BmsxVMRuntime.instance;
	await clearWorkspaceArtifacts($.luaSources, runtime.storageService);
	runtime.editor.clearWorkspaceDirtyBuffers();
}

export function listResources(): VMResourceDescriptor[] {
	const descriptors: VMResourceDescriptor[] = [];
	for (const asset of Object.values($.luaSources.path2lua)) {
		const path = asset.normalized_source_path;
		descriptors.push({ path, type: asset.type, asset_id: asset.resid });
	}
	descriptors.sort((left, right) => left.path.localeCompare(right.path));
	return descriptors;
}
