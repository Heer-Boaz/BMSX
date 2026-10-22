import { LUA_SOURCE_EXCLUDED_DIRECTORIES, isRuntimeLuaSourcePath } from '../../toolchain/ts/lua/source_paths';
import type { WorkspaceRecordProvider } from './record_provider';
import { joinWorkspacePaths, stripProjectRootPrefix } from './path';
import { structuredTextAssetFromPath, type StructuredTextAsset } from '../../toolchain/ts/rompack/assets';

/** Editable asset admission is identical for new files and workspace reopening. */
export function workspaceTextAssetFromPath(path: string): Extract<StructuredTextAsset, { type: 'aem' | 'data' }> | undefined {
	if (!path.startsWith('res/')) return;
	for (const segment of path.split('/')) {
		if (LUA_SOURCE_EXCLUDED_DIRECTORIES.has(segment)) return;
	}
	const asset = structuredTextAssetFromPath(path);
	if (asset?.type === 'aem' || asset?.type === 'data' && asset.format === 'yaml') return asset;
}

/** Filesystem admission runs at workspace opening, never from frame/query paths. */
export async function discoverWorkspaceSourceFiles(provider: WorkspaceRecordProvider, root: string, structured: boolean): Promise<string[]> {
	const pending = [root];
	const files: string[] = [];
	while (pending.length !== 0) {
		const directory = pending.pop()!;
		const entries = await provider.readDirectory(directory);
		if (entries === null) continue; // This project folder does not exist on this host.
		for (const entry of entries) {
			const path = joinWorkspacePaths(directory, entry.name);
			if (entry.type === 'directory') {
				if (!LUA_SOURCE_EXCLUDED_DIRECTORIES.has(entry.name)) pending.push(path);
			} else if (entry.type === 'file') {
				if (isRuntimeLuaSourcePath(path)) files.push(path);
				else if (structured && workspaceTextAssetFromPath(stripProjectRootPrefix(path, root)) !== undefined) files.push(path);
			}
		}
	}
	return files.sort();
}
