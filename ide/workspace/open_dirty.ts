import type { StorageService } from '../../machine/ts/platform/platform';
import { buildWorkspaceDirtyEntryPath, buildWorkspaceStorageKey } from './files';
import {
	resourceIdentityKey,
	type ResourceIdentity,
} from '../common/resource';

const openDirtyWorkspaceDocuments = new Map<string, ResourceIdentity>();

function normalizeWorkspacePath(path: string): string {
	return path.startsWith('/') ? path.slice(1) : path;
}

export function setOpenWorkspaceDocumentDirty(identity: ResourceIdentity, dirty: boolean): void {
	const normalized = {
		domain: identity.domain,
		path: normalizeWorkspacePath(identity.path),
	};
	const key = resourceIdentityKey(normalized);
	if (dirty) {
		openDirtyWorkspaceDocuments.set(key, normalized);
		return;
	}
	openDirtyWorkspaceDocuments.delete(key);
}

export function clearOpenWorkspaceDocumentDirtyState(): void {
	openDirtyWorkspaceDocuments.clear();
}

export function collectUnsavedWorkspaceSources(
	root: string,
	storage: StorageService,
): ResourceIdentity[] {
	const unsaved: ResourceIdentity[] = [];
	for (const identity of openDirtyWorkspaceDocuments.values()) {
		const dirtyPath = buildWorkspaceDirtyEntryPath(root, identity.domain, identity.path);
		const storageKey = buildWorkspaceStorageKey(root, dirtyPath);
		if (storage.getItem(storageKey) === null) {
			unsaved.push(identity);
		}
	}
	return unsaved;
}
