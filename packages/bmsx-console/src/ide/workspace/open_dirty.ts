import type { StorageService } from '../../platform/platform';
import { buildWorkspaceDirtyEntryPath, buildWorkspaceStorageKey } from './files';

const openDirtyWorkspacePaths = new Set<string>();

function normalizeWorkspacePath(path: string): string {
	return path.startsWith('/') ? path.slice(1) : path;
}

export function setOpenWorkspacePathDirty(path: string, dirty: boolean): void {
	const normalizedPath = normalizeWorkspacePath(path);
	if (dirty) {
		openDirtyWorkspacePaths.add(normalizedPath);
		return;
	}
	openDirtyWorkspacePaths.delete(normalizedPath);
}

export function clearOpenWorkspacePathDirtyState(): void {
	openDirtyWorkspacePaths.clear();
}

export function collectUnsavedWorkspaceSourcePaths(root: string, storage: StorageService): Set<string> {
	const unsaved = new Set<string>();
	for (const path of openDirtyWorkspacePaths) {
		const dirtyPath = buildWorkspaceDirtyEntryPath(root, path);
		const storageKey = buildWorkspaceStorageKey(root, dirtyPath);
		if (storage.getItem(storageKey) === null) {
			unsaved.add(`/${path}`);
		}
	}
	return unsaved;
}
