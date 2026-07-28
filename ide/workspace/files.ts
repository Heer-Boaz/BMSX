import type { LuaSourceRecord, LuaSourceRegistry } from '../../machine/ts/lua/source_registry';
import type { HostClock, StorageService } from '../../machine/ts/platform/platform';
import {
	deleteWorkspaceLuaSourceOverride,
	getWorkspaceLuaSourceOverride,
	setWorkspaceLuaSourceOverride,
	workspaceCanonicalSourceCache,
} from './cache';
import {
	WORKSPACE_DIRTY_DIR,
	WORKSPACE_METADATA_DIR,
	createWorkspaceRecord,
	readWorkspaceRecord,
	writeWorkspaceRecord,
	type WorkspaceRecord,
} from './records';
import { joinWorkspacePaths, resolveWorkspacePath, stripProjectRootPrefix } from './path';
import type { ResourceDomain } from '../common/resource';

export { joinWorkspacePaths } from './path';

type WorkspaceWinnerKind = 'dirty' | 'canonical' | 'rom';

export function buildWorkspaceDirtyEntryPath(
	projectRootPath: string,
	domain: ResourceDomain,
	resourcePath: string,
): string {
	const normalizedPath = stripProjectRootPrefix(resourcePath, projectRootPath);
	const segments = normalizedPath.split('/');
	const baseName = segments[segments.length - 1];
	segments.length -= 1;
	const tempName = baseName.startsWith('~') ? baseName : `~${baseName}`;
	segments.unshift(domain === -1 ? 'system' : `slot${domain}`);
	segments.push(tempName);
	return joinWorkspacePaths(projectRootPath, WORKSPACE_METADATA_DIR, WORKSPACE_DIRTY_DIR, ...segments);
}

export function buildWorkspaceDirtyRecordPath(
	dirtyEntryPath: string,
	updatedAt: number,
): string {
	return `${dirtyEntryPath}.${updatedAt}`;
}

export function readWorkspaceLuaSourceText(registry: LuaSourceRegistry, record: LuaSourceRecord): string {
	if (!record.generated) {
		const source = getWorkspaceLuaSourceOverride(registry, record.source_path);
		if (source !== undefined) {
			return source;
		}
	}
	return record.src;
}

export async function persistWorkspaceSourceFile(
	storage: StorageService,
	clock: HostClock,
	path: string,
	source: string,
	projectRootPath: string,
): Promise<WorkspaceRecord> {
	const relativePath = resolveWorkspacePath(path, projectRootPath);
	const record = createWorkspaceRecord(clock, source);
	await writeWorkspaceRecord(
		storage,
		projectRootPath,
		relativePath,
		record,
	);
	return record;
}

export async function loadWorkspaceSourceFile(
	storage: StorageService,
	path: string,
	projectRootPath: string,
): Promise<string | null> {
	const relativePath = resolveWorkspacePath(path, projectRootPath);
	const cached = workspaceCanonicalSourceCache.get(relativePath);
	if (cached !== undefined) {
		return cached;
	}
	const record = await readWorkspaceRecord(
		storage,
		projectRootPath,
		relativePath,
	);
	if (!record) {
		return null;
	}
	workspaceCanonicalSourceCache.set(relativePath, record.contents);
	return record.contents;
}

export async function applyWorkspaceSourceOverrides(params: {
	dirtyRecords: ReadonlyMap<string, WorkspaceRecord>;
	domain: ResourceDomain;
	registry: LuaSourceRegistry;
	storage: StorageService;
	projectRootPath: string;
}): Promise<Set<string>> {
	const rejectedDirtyPaths = new Set<string>();
	const registry = params.registry;
	const root = params.projectRootPath;
	const revision = registry.revision;
	const records = registry.records;
	const canonicalPaths = new Array<string>(records.length);
	const canonicalRecords = new Array<WorkspaceRecord | null>(records.length);
	const reads: Promise<void>[] = [];
	let changed = false;

	for (let index = 0; index < records.length; index += 1) {
		const asset = records[index];
		if (asset.generated) {
			continue;
		}
		const filePath = asset.source_path;
		const canonicalPath = resolveWorkspacePath(filePath, root);
		canonicalPaths[index] = canonicalPath;
		reads.push(readWorkspaceRecord(
			params.storage,
			root,
			canonicalPath,
		).then(canonicalRecord => {
			canonicalRecords[index] = canonicalRecord;
		}));
	}
	await Promise.all(reads);

	for (let index = 0; index < records.length; index += 1) {
		const asset = records[index];
		if (asset.generated) {
			continue;
		}
		const filePath = asset.source_path;
		const dirtyPath = buildWorkspaceDirtyEntryPath(root, params.domain, filePath);
		const dirtyRecord = params.dirtyRecords.get(dirtyPath);
		const canonicalPath = canonicalPaths[index];
		const canonicalRecord = canonicalRecords[index];
		if (canonicalRecord) {
			workspaceCanonicalSourceCache.set(canonicalPath, canonicalRecord.contents);
		} else {
			workspaceCanonicalSourceCache.delete(canonicalPath);
		}

		let winnerKind: WorkspaceWinnerKind = 'rom';
		let winnerSource = asset.base_src;
		let winnerUpdatedAt = asset.base_update_timestamp;
		if (canonicalRecord && canonicalRecord.updatedAt > winnerUpdatedAt) {
			winnerKind = 'canonical';
			winnerSource = canonicalRecord.contents;
			winnerUpdatedAt = canonicalRecord.updatedAt;
		}
		if (dirtyRecord && dirtyRecord.updatedAt >= winnerUpdatedAt) {
			winnerKind = 'dirty';
			winnerSource = dirtyRecord.contents;
			winnerUpdatedAt = dirtyRecord.updatedAt;
		}

		if (dirtyRecord && winnerKind !== 'dirty') {
			rejectedDirtyPaths.add(dirtyPath);
		}
		if (asset.src !== winnerSource) {
			changed = true;
		}
		asset.src = winnerSource;
		asset.update_timestamp = winnerUpdatedAt;

		if (winnerKind === 'dirty') {
			setWorkspaceLuaSourceOverride(registry, filePath, winnerSource);
			continue;
		}

		deleteWorkspaceLuaSourceOverride(registry, filePath);
		if (winnerKind === 'canonical') {
			asset.base_src = winnerSource;
			asset.base_update_timestamp = winnerUpdatedAt;
		}
	}

	if (changed && registry.revision === revision) {
		registry.revision += 1;
	}
	return rejectedDirtyPaths;
}
