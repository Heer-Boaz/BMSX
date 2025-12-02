import { convertToError, extractErrorMessage } from 'bmsx/lua/value';
import type { StorageService } from '../platform';
import type { RomPack } from '../rompack/rompack';
import { BmsxConsoleRuntime } from './runtime';

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

export function collectWorkspaceOverrides(params: { rompack: RomPack; projectRootPath: string; storage: StorageService; }): Map<string, WorkspaceOverrideRecord> {
	const overrides = new Map<string, WorkspaceOverrideRecord>();
	const rootRaw = params.projectRootPath ;
	if (!rootRaw) {
		return overrides;
	}
	const root = rootRaw;
	const storage = params.storage;
	for (const asset of Object.values(params.rompack.cart.lua)) {
		const cartPath = asset.source_path ?? asset.resid;
		const dirtyPath = buildWorkspaceDirtyEntryPath(root, cartPath);
		const storageKey = buildWorkspaceStorageKey(root, dirtyPath);
		const stored = storage.getItem(storageKey);
		if (stored === null || stored === undefined) {
			continue;
		}
		let source = stored;
		let updatedAt: number;
		try {
			const parsed = JSON.parse(stored) as { contents?: string; updatedAt?: number };
			if (typeof parsed.contents === 'string') {
				source = parsed.contents;
				if (typeof parsed.updatedAt === 'number') {
					updatedAt = parsed.updatedAt;
				}
			}
		} catch {
			// Fall back to raw string for legacy entries.
		}
		overrides.set(asset.resid, { source, path: dirtyPath, cartPath, updatedAt });
	}
	return overrides;
}

	export async function persistLuaSourceToFilesystem(path: string, source: string): Promise<void> {
		const runtime = BmsxConsoleRuntime.instance;
		if (typeof fetch !== 'function') {
			throw new Error('[BmsxConsoleRuntime] Fetch API unavailable; cannot persist Lua source.');
		}
		let response: Response;
		try {
			response = await fetch(WORKSPACE_FILE_ENDPOINT, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ path, contents: source }),
			});
		} catch (error) {
			handleLuaPersistenceFailure('persist', `[BmsxConsoleRuntime] Failed to reach Lua save endpoint for '${path}'`, { error });
			if (runtime.luaFailurePolicy.persist === 'warning') {
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
				if (runtime.luaFailurePolicy.persist === 'warning') {
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
					if (runtime.luaFailurePolicy.persist === 'warning') {
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
			if (runtime.luaFailurePolicy.persist === 'warning') {
				return;
			}
			return;
		}
	}

	export async function fetchLuaSourceFromFilesystem(path: string): Promise<string> {
		const runtime = BmsxConsoleRuntime.instance;

		if (typeof fetch !== 'function') {
			return null;
		}
		let response: Response;
		const url = `${WORKSPACE_FILE_ENDPOINT}?path=${encodeURIComponent(path)}`;
		try {
			response = await fetch(url, { method: 'GET', cache: 'no-store' });
		} catch (error) {
			handleLuaPersistenceFailure('fetch', `[BmsxConsoleRuntime] Failed to load Lua source from filesystem (${path})`, { error });
			if (runtime.luaFailurePolicy.fetch === 'warning') {
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
				if (runtime.luaFailurePolicy.fetch === 'warning') {
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
					if (runtime.luaFailurePolicy.fetch === 'warning') {
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
			if (runtime.luaFailurePolicy.fetch === 'warning') {
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
			if (runtime.luaFailurePolicy.fetch === 'warning') {
				return null;
			}
			return null;
		}
		if (!payload || typeof payload !== 'object') {
			handleLuaPersistenceFailure('fetch', `[BmsxConsoleRuntime] Response for '${path}' missing Lua contents`);
			if (runtime.luaFailurePolicy.fetch === 'warning') {
				return null;
			}
			return null;
		}
		const record = payload as { contents?: unknown };
		if (typeof record.contents !== 'string') {
			handleLuaPersistenceFailure('fetch', `[BmsxConsoleRuntime] Response for '${path}' missing Lua contents`);
			if (runtime.luaFailurePolicy.fetch === 'warning') {
				return null;
			}
			return null;
		}
		return record.contents;
	}

	export async function prefetchLuaSourceFromFilesystem(): Promise<void> {
		const runtime = BmsxConsoleRuntime.instance;

		const entry = runtime.cart.lua[runtime.cart.entry];
		const path = entry?.source_path;
		if (!path) {
			return;
		}
		const fetched = await fetchLuaSourceFromFilesystem(path);
		if (fetched === null) {
			return;
		}
		const currentSource = entry.src;
		if (currentSource === fetched) {
			return;
		}
		const chunkName = entry.chunk_name;
		try {
			runtime.reloadLuaProgramState(fetched, { chunkName, assetId: entry.resid, runInit: false });
		}
		catch (error) {
			try {
				runtime.reloadLuaProgramState(currentSource, { chunkName, assetId: entry.resid, runInit: false });
			}
			catch (restoreError) {
				handleLuaPersistenceFailure('restore', `[BmsxConsoleRuntime] Failed to restore Lua source after prefetched apply error`, { error: restoreError });
				return;
			}
			handleLuaPersistenceFailure('apply', `[BmsxConsoleRuntime] Failed to apply prefetched Lua source '${path}'`, { error });
			if (runtime.luaFailurePolicy.apply === 'warning') {
				return;
			}
			throw convertToError(error);
		}
	}

	function handleLuaPersistenceFailure(
		kind: LuaPersistenceFailureKind,
		context: string,
		options: { detail?: string; error?: unknown } = {}
	): void {
		const runtime = BmsxConsoleRuntime.instance;
		const mode = runtime.luaFailurePolicy[kind];
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
