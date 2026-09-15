import { LUA_SOURCE_EXCLUDED_DIRECTORIES, isRuntimeLuaSourcePath } from '../../toolchain/ts/lua/source_paths';
import type { WorkspaceRecordProvider } from './record_provider';
import { joinWorkspacePaths } from './path';

/** Filesystem admission runs at workspace opening, never from frame/query paths. */
export async function discoverWorkspaceLuaFiles(provider: WorkspaceRecordProvider, root: string): Promise<string[]> {
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
			} else if (entry.type === 'file' && isRuntimeLuaSourcePath(path)) files.push(path);
		}
	}
	return files.sort();
}
