import type { StorageService } from '../platform';
import type { RomPack } from '../rompack/rompack';

export const WORKSPACE_FILE_ENDPOINT = '/__bmsx__/lua';
export const WORKSPACE_STORAGE_PREFIX = 'bmsx.workspace';
export const WORKSPACE_METADATA_DIR = '.bmsx';
export const WORKSPACE_DIRTY_DIR = 'dirty';
export const WORKSPACE_STATE_FILE = 'ide-state.json';
export const WORKSPACE_MARKER_FILE = '~workspace';

export function normalizeWorkspacePath(input: string): string {
	const replaced = input.replace(/\\/g, '/').trim();
	if (replaced.length === 0) {
		return '';
	}
	const parts = replaced.split('/');
	const stack: string[] = [];
	for (let index = 0; index < parts.length; index += 1) {
		const part = parts[index];
		if (!part || part === '.') {
			continue;
		}
		if (part === '..') {
			if (stack.length > 0) {
				stack.pop();
			}
			continue;
		}
		stack.push(part);
	}
	return stack.join('/');
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
	return joinWorkspacePaths(normalizeWorkspacePath(projectRootPath), WORKSPACE_METADATA_DIR);
}

export function buildWorkspaceDirtyDir(projectRootPath: string): string {
	return joinWorkspacePaths(buildWorkspaceMetadataPath(projectRootPath), WORKSPACE_DIRTY_DIR);
}

export function buildWorkspaceDirtyEntryPath(projectRootPath: string, resourcePath: string): string {
	const normalizedResource = normalizeWorkspacePath(resourcePath);
	if (normalizedResource.length === 0) {
		throw new Error('[workspace_paths] Resource path is required to build dirty file path.');
	}
	const segments = normalizedResource.split('/');
	const baseName = segments.pop() ?? normalizedResource;
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

export function buildWorkspaceMarkerPath(projectRootPath: string): string {
	return joinWorkspacePaths(buildWorkspaceMetadataPath(projectRootPath), WORKSPACE_MARKER_FILE);
}

export function buildWorkspaceStorageKey(projectRootPath: string, relativePath: string): string {
	const normalizedRoot = normalizeWorkspacePath(projectRootPath);
	const normalizedPath = normalizeWorkspacePath(relativePath);
	return `${WORKSPACE_STORAGE_PREFIX}:${normalizedRoot}:${normalizedPath}`;
}

export type WorkspaceOverrideRecord = { source: string; path: string | null; cartPath: string; };

export function collectWorkspaceOverrides(params: { rompack: RomPack; projectRootPath: string | null | undefined; storage: StorageService; }): Map<string, WorkspaceOverrideRecord> {
	const overrides = new Map<string, WorkspaceOverrideRecord>();
	const rootRaw = params.projectRootPath ?? null;
	if (!rootRaw) {
		return overrides;
	}
	const root = normalizeWorkspacePath(rootRaw);
	if (root.length === 0) {
		return overrides;
	}
	const storage = params.storage;
	const luaSources = params.rompack.luaSourcePaths;
	for (const [assetId, cartPath] of Object.entries(luaSources)) {
		if (typeof cartPath !== 'string' || cartPath.length === 0) {
			continue;
		}
		const normalizedCart = normalizeWorkspacePath(cartPath);
		const dirtyPath = buildWorkspaceDirtyEntryPath(root, normalizedCart);
		const storageKey = buildWorkspaceStorageKey(root, dirtyPath);
		const stored = storage.getItem(storageKey);
		if (stored === null || stored === undefined) {
			continue;
		}
		overrides.set(assetId, { source: stored, path: dirtyPath, cartPath: normalizedCart });
	}
	return overrides;
}

