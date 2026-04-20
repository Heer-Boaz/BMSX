import type { ParsedLuaChunk } from '../../../language/lua/parse';
import { getCachedLuaParse } from '../../../language/lua/analysis_cache';
import { LuaSemanticWorkspace, type FileSemanticData, type LuaSemanticWorkspaceSnapshot } from './semantic_model';

export type SemanticWorkspacePathInput = {
	path: string;
	source: string;
	lines?: readonly string[];
	parsed?: ParsedLuaChunk;
	version?: number;
};

let semanticWorkspace: LuaSemanticWorkspace = null;

export function getOrCreateSemanticWorkspace(): LuaSemanticWorkspace {
	if (semanticWorkspace) {
		return semanticWorkspace;
	}
	semanticWorkspace = new LuaSemanticWorkspace();
	return semanticWorkspace;
}

export function resetSemanticWorkspace(): LuaSemanticWorkspace {
	semanticWorkspace = new LuaSemanticWorkspace();
	return semanticWorkspace;
}

export function syncSemanticWorkspacePath(input: SemanticWorkspacePathInput, workspace: LuaSemanticWorkspace = getOrCreateSemanticWorkspace()): FileSemanticData {
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
	workspace: LuaSemanticWorkspace = getOrCreateSemanticWorkspace(),
): LuaSemanticWorkspaceSnapshot {
	for (let index = 0; index < inputs.length; index += 1) {
		syncSemanticWorkspacePath(inputs[index], workspace);
	}
	return workspace.getSnapshot();
}
