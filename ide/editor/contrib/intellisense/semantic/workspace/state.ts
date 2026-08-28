import type { ParsedLuaChunk } from '../../../../../../toolchain/ts/lua/analysis/parse';
import { getCachedLuaParse } from '../../../../../../toolchain/ts/lua/analysis/cache';
import {
	buildLuaFileSemanticData,
	LuaSemanticWorkspace,
	type FileSemanticData,
	type LuaSemanticWorkspaceSnapshot,
} from '../../../../../../toolchain/ts/lua/semantic/model';
import type { ResourceDomain } from '../../../../../common/resource';

export type SemanticWorkspacePathInput = {
	path: string;
	source: string;
	parsed?: ParsedLuaChunk;
};

const semanticWorkspaces = new Map<ResourceDomain, LuaSemanticWorkspace>();

export function getOrCreateSemanticWorkspace(domain: ResourceDomain): LuaSemanticWorkspace {
	const workspace = semanticWorkspaces.get(domain);
	if (workspace) {
		return workspace;
	}
	const created = new LuaSemanticWorkspace();
	semanticWorkspaces.set(domain, created);
	return created;
}

export function resetSemanticWorkspace(domain: ResourceDomain): LuaSemanticWorkspace {
	const workspace = new LuaSemanticWorkspace();
	semanticWorkspaces.set(domain, workspace);
	return workspace;
}

export function resetSemanticWorkspaces(): void {
	semanticWorkspaces.clear();
}

export function syncSemanticWorkspacePath(
	workspace: LuaSemanticWorkspace,
	path: string,
	source: string,
	parsed?: ParsedLuaChunk,
): FileSemanticData {
	const parseEntry = getCachedLuaParse({
		path,
		source,
		parsed,
	});
	const existing = workspace.getFileData(path);
	if (!existing || existing.source !== parseEntry.source) {
		workspace.updateFile(path, parseEntry.source, parseEntry.parsed);
	}
	return workspace.getFileData(path);
}

export function syncSemanticWorkspacePaths(
	inputs: ReadonlyArray<SemanticWorkspacePathInput>,
	workspace: LuaSemanticWorkspace,
): LuaSemanticWorkspaceSnapshot {
	const changedAnalyses: FileSemanticData[] = [];
	for (let index = 0; index < inputs.length; index += 1) {
		const input = inputs[index];
		const parseEntry = getCachedLuaParse({
			path: input.path,
			source: input.source,
			parsed: input.parsed,
		});
		const existing = workspace.getFileData(input.path);
		if (!existing || existing.source !== parseEntry.source) {
			changedAnalyses.push(buildLuaFileSemanticData(
				parseEntry.source,
				input.path,
				parseEntry.parsed,
			));
		}
	}
	workspace.updateFiles(changedAnalyses);
	return workspace.getSnapshot();
}
