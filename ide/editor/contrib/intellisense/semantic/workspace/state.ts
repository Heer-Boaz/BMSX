import type { ParsedLuaChunk } from '../../../../../../toolchain/ts/lua/analysis/parse';
import { getCachedLuaParse } from '../../../../../../toolchain/ts/lua/analysis/cache';
import { LuaSemanticWorkspace, type FileSemanticData, type LuaSemanticWorkspaceSnapshot } from '../../../../../../toolchain/ts/lua/semantic/model';
import type { ResourceDomain } from '../../../../../common/resource';

export type SemanticWorkspacePathInput = {
	path: string;
	source: string;
	lines?: readonly string[];
	parsed?: ParsedLuaChunk;
	version?: number;
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

export function syncSemanticWorkspacePath(input: SemanticWorkspacePathInput, workspace: LuaSemanticWorkspace): FileSemanticData {
	const parseEntry = getCachedLuaParse({
		path: input.path,
		source: input.source,
		lines: input.lines,
		version: input.version,
		withSyntaxError: false,
		parsed: input.parsed,
	});
	const existing = workspace.getFileData(input.path);
	if (!existing || existing.source !== parseEntry.source) {
		workspace.updateFile(input.path, parseEntry.source, parseEntry.lines, parseEntry.parsed, input.version);
	}
	return workspace.getFileData(input.path);
}

export function syncSemanticWorkspacePaths(
	inputs: ReadonlyArray<SemanticWorkspacePathInput>,
	workspace: LuaSemanticWorkspace,
): LuaSemanticWorkspaceSnapshot {
	for (let index = 0; index < inputs.length; index += 1) {
		syncSemanticWorkspacePath(inputs[index], workspace);
	}
	return workspace.getSnapshot();
}
