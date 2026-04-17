import { extractErrorMessage } from '../../lua/luavalue';
import type { HttpResponse, StorageService } from '../../platform/index';
import type { LuaSourceRecord, LuaSourceRegistry } from '../../machine/program/lua_sources';
import { Runtime } from '../../machine/runtime/runtime';
import * as runtimeLuaPipeline from '../runtime/runtime_lua_pipeline';
import { $ } from '../../core/engine_core';
import { LuaResourceCreationRequest, ResourceDescriptor } from '../../machine/runtime/types';
import { joinWorkspacePaths, resolveWorkspacePath, stripProjectRootPrefix } from './workspace_path';
import { getWorkspaceCachedSource } from './workspace_cache';
export { joinWorkspacePaths } from './workspace_path';

export const WORKSPACE_FILE_ENDPOINT = '/__bmsx__/lua';
export const WORKSPACE_STORAGE_PREFIX = 'bmsx.workspace';
export const WORKSPACE_METADATA_DIR = '.bmsx';
export const WORKSPACE_DIRTY_DIR = 'dirty';
export const WORKSPACE_STATE_FILE = 'ide-state.json';
export const WORKSPACE_MARKER_FILE = '~workspace';
export const DEFAULT_ENGINE_PROJECT_ROOT_PATH = 'src/bmsx';

export type WorkspaceOverrideRecord = { source: string; path: string; cartPath: string; updatedAt?: number };
type WorkspaceStoragePayload = { contents: string; updatedAt: number };
type WorkspaceWinnerKind = 'override' | 'canonical' | 'rom';

function resolveEditableCartLuaSources(): LuaSourceRegistry {
	const runtime = Runtime.instance;
	return runtime.cartLuaSources ? runtime.cartLuaSources : $.lua_sources;
}

function resolveEngineProjectRootPath(): string {
	const engineRoot = $.engine_layer.index.projectRootPath;
	return engineRoot && engineRoot.length > 0 ? engineRoot : DEFAULT_ENGINE_PROJECT_ROOT_PATH;
}

function isEngineLuaSourcePath(path: string): boolean {
	return path === 'res/bios' || path.startsWith('res/bios/');
}

export function resolveLuaSourceRegistry(path: string): LuaSourceRegistry {
	const runtime = Runtime.instance;
	const cart = runtime.cartLuaSources;
	if (cart && cart.path2lua[path]) {
		return cart;
	}
	const engine = runtime.engineLuaSources;
	if (engine && engine.path2lua[path]) {
		return engine;
	}
	throw new Error(`Missing Lua source registry for '${path}'.`);
}

export function resolveLuaSourceProjectRootPath(path: string): string {
	const runtime = Runtime.instance;
	const cart = runtime.cartLuaSources;
	if (cart && cart.path2lua[path]) {
		return $.cart_project_root_path;
	}
	const engine = runtime.engineLuaSources;
	if (engine && engine.path2lua[path]) {
		return resolveEngineProjectRootPath();
	}
	return $.cart_project_root_path;
}

export async function saveLuaResourceSource(path: string, source: string): Promise<void> {
	const registry = resolveLuaSourceRegistry(path);
	const asset = registry.path2lua[path];
	const sourcePath = asset.source_path;
	await persistWorkspaceSourceFile(sourcePath, source, resolveLuaSourceProjectRootPath(sourcePath));
	asset.src = source;
	asset.update_timestamp = $.platform.clock.dateNow();
	registry.path2lua[sourcePath] = asset;
	runtimeLuaPipeline.markSourceChunkAsDirty(Runtime.instance, sourcePath);
}

export async function createLuaResource(request: LuaResourceCreationRequest): Promise<ResourceDescriptor> {
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
		update_timestamp: $.platform.clock.dateNow(),
	};
	const registerAsset = (registry: LuaSourceRegistry): void => {
		registry.path2lua[asset.source_path] = asset;
		registry.can_boot_from_source = true;
	};
	const registry = isEngineLuaSourcePath(asset.source_path)
		? Runtime.instance.engineLuaSources
		: resolveEditableCartLuaSources();
	registerAsset(registry);
	runtimeLuaPipeline.invalidateModuleAliases(Runtime.instance);
	const filesystemPath = asset.source_path;
	await persistWorkspaceSourceFile(filesystemPath, contents, isEngineLuaSourcePath(filesystemPath) ? resolveEngineProjectRootPath() : $.cart_project_root_path);
	runtimeLuaPipeline.markSourceChunkAsDirty(Runtime.instance, asset.source_path);
	const descriptor: ResourceDescriptor = { path: asset.source_path, type: 'lua' };
	return descriptor;
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
		const cartPath = asset.source_path;
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

export async function persistWorkspaceSourceFile(path: string, source: string, projectRootPath?: string): Promise<void> {
	if (typeof fetch !== 'function') {
		throw new Error('Fetch API unavailable; cannot persist workspace source.');
	}
	let response: HttpResponse;
	try {
		response = await fetch(WORKSPACE_FILE_ENDPOINT, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ path: resolveWorkspacePath(path, projectRootPath), contents: source }),
		});
	} catch (error) {
		throw new Error(`Failed to reach save endpoint for '${path}': ${extractErrorMessage(error)}`);
	}
	if (!response.ok) {
		let detail = '';
		try {
			detail = await response.text();
		} catch (textError) {
			throw new Error(`Save rejected for '${path}' (response body read failed): ${extractErrorMessage(textError)}`);
		}
		let finalDetail = response.statusText;
		if (detail && detail.length > 0) {
			let parsed: unknown;
			try {
				parsed = JSON.parse(detail);
			} catch (parseError) {
				throw new Error(`Save rejected for '${path}' (error payload parse failed): ${extractErrorMessage(parseError)}`);
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
		throw new Error(`Save rejected for '${path}': ${finalDetail}`);
	}
}

export async function loadWorkspaceSourceFile(path: string, projectRootPath?: string): Promise<string> {
	const cached = getWorkspaceCachedSource(path);
	if (cached !== null) {
		return cached;
	}
	const payload = await fetchWorkspaceFile(resolveWorkspacePath(path, projectRootPath));
	return payload ? payload.contents : null;
}

export async function fetchWorkspaceOverridesPriority(cart: LuaSourceRegistry, root: string): Promise<Map<string, WorkspaceOverrideRecord>> {
	try {
		const serverOverrides = await fetchWorkspaceDirtyLuaOverrides(cart, root);
		return serverOverrides;
	} catch (error) {
		console.warn('Failed to load server workspace overrides; falling back to local overrides.', error);
		return new Map<string, WorkspaceOverrideRecord>();
	}
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
		const canonicalPath = resolveWorkspacePath(asset.source_path, root);
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
				path: asset.source_path,
				cartPath: asset.source_path,
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
	if (!payload || typeof payload !== 'object') {
		console.warn(`Invalid workspace file response payload for '${path}': ${JSON.stringify(payload)}`);
		return null;
	}
	const record = payload as { contents?: string; updatedAt?: number };
	if (typeof record.contents !== 'string') {
		console.warn(`Invalid workspace file response payload for '${path}': ${JSON.stringify(payload)}`);
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
		console.warn('Fetch API is not available.');
		return;
	}
	const url = `${WORKSPACE_FILE_ENDPOINT}?path=${encodeURIComponent(path)}`;
	try {
		await fetch(url, { method: 'DELETE' });
	} catch {
		console.info('Failed to delete workspace file:', url);
		return;
	}
}

async function persistWorkspaceFileToServer(root: string, path: string, source: string): Promise<void> {
	if (typeof fetch !== 'function') {
		return;
	}
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
// - The winning source is applied to the running registry and written back to storage (both canonical and dirty slots when
//   relevant). If the winner is fresher than the server canonical file we push it back to disk to converge the state.
export async function applyWorkspaceOverridesToRegistry(params: { registry: LuaSourceRegistry; storage: StorageService; includeServer?: boolean; projectRootPath?: string }): Promise<Set<string>> {
	const { registry, storage } = params;
	const includeServer = params.includeServer !== false;
	const changed = new Set<string>();
	const root = params.projectRootPath ?? $.cart_project_root_path;

	const localOverrides = collectWorkspaceOverrides({ cart: registry, projectRootPath: root, storage });
	const serverOverrides = includeServer ? await fetchWorkspaceOverridesPriority(registry, root) : new Map<string, WorkspaceOverrideRecord>();
	const canonicalOverrides = includeServer ? await fetchWorkspaceCanonicalLua(registry, root) : new Map<string, WorkspaceOverrideRecord>();

	for (const asset of Object.values(registry.path2lua)) {
		const filePath = asset.source_path;
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
		// The runtime executes sources via `$.luaSources.path2lua[...]` (see `Runtime.resourceSourceForChunk()`), while
		// workspace merges/overrides are keyed by path via `path2lua[...]`. These two maps are expected to point at
		// the same `LuaSourceRecord` objects, so we always set both here.
		const nextSource = winner.record.source;
		const pathBinding = registry.path2lua[asset.source_path];
		if (asset.src !== nextSource || pathBinding.src !== nextSource) {
			changed.add(filePath);
		}
		asset.src = nextSource;
		pathBinding.src = nextSource;
		const updatedAt = winner.updatedAt >= 0 ? winner.updatedAt : $.platform.clock.dateNow();
		asset.update_timestamp = updatedAt;
		pathBinding.update_timestamp = updatedAt;

		if (!root) {
			continue;
		}

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

export async function applyWorkspaceOverridesToCart(params: { cart: LuaSourceRegistry; storage: StorageService; includeServer?: boolean }): Promise<Set<string>> {
	return await applyWorkspaceOverridesToRegistry({
		registry: params.cart,
		storage: params.storage,
		includeServer: params.includeServer,
		projectRootPath: $.cart_project_root_path,
	});
}

export async function clearWorkspaceArtifacts(cart: LuaSourceRegistry, storage: StorageService): Promise<void> {
	const root = $.cart_project_root_path;
	for (const asset of Object.values(cart.path2lua)) {
		const cartPath = asset.source_path;
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
	const root = $.cart_project_root_path;
	const scratchPaths = await collectScratchWorkspaceDirtyPaths(root);
	for (const asset of Object.values(cart.path2lua)) {
		const cartPath = asset.source_path;
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
	const runtime = Runtime.instance;
	await clearWorkspaceDirtyFiles(resolveEditableCartLuaSources(), runtime.storageService);
}

export async function nukeWorkspaceState(): Promise<void> {
	const runtime = Runtime.instance;
	await clearWorkspaceArtifacts(resolveEditableCartLuaSources(), runtime.storageService);
}

export function listResources(): ResourceDescriptor[] {
	const descriptorsByPath = new Map<string, ResourceDescriptor>();
	const registries = runtimeLuaPipeline.listLuaSourceRegistries(Runtime.instance);
	for (const entry of registries) {
		const registry = entry.registry;
		const readOnly = entry.readOnly;
		for (const asset of Object.values(registry.path2lua)) {
			const path = asset.source_path;
			if (descriptorsByPath.has(path)) {
				continue;
			}
			descriptorsByPath.set(path, { path, type: asset.type, asset_id: asset.resid, readOnly });
		}
	}
	const descriptors = Array.from(descriptorsByPath.values());
	descriptors.sort((left, right) => left.path.localeCompare(right.path));
	return descriptors;
}
