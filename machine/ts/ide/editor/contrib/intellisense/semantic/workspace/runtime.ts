import type { ParsedLuaChunk } from '../../../../../../lua/analysis/parse';
import { splitText } from '../../../../../../common/text_lines';
import * as luaPipeline from '../../../../../runtime/lua_pipeline';
import { machineManager } from '../../../../../../core/machine_manager';
import { getOrCreateSemanticWorkspace, syncSemanticWorkspacePath, type SemanticWorkspacePathInput } from './state';
import type { LuaDefinitionInfo } from '../../../../../../lua/syntax/ast';
import type { FileSemanticData, LuaSemanticModel, LuaSemanticWorkspace, LuaSemanticWorkspaceSnapshot } from '../../../../../../lua/semantic/model';

export type RuntimeSemanticCacheEntry = {
	source: string;
	model?: LuaSemanticModel;
	definitions?: ReadonlyArray<LuaDefinitionInfo>;
	parsed?: ParsedLuaChunk;
	lines?: readonly string[];
	analysis?: FileSemanticData;
};

let primedProjectWorkspace: LuaSemanticWorkspace = null;
export const runtimeSemanticCache: Map<string, RuntimeSemanticCacheEntry> = new Map();

export function cacheRuntimeSemanticWorkspaceAnalysis(path: string, source: string, data: FileSemanticData, parsed?: ParsedLuaChunk): void {
	runtimeSemanticCache.set(path, {
		source,
		model: data.model,
		definitions: data.model.definitions,
		parsed,
		lines: data.lines,
		analysis: data,
	});
}

export function cacheRuntimeSemanticParseState(path: string, source: string, lines: readonly string[], parsed: ParsedLuaChunk): void {
	const cacheEntry = runtimeSemanticCache.get(path);
	runtimeSemanticCache.set(path, {
		source,
		model: cacheEntry?.model,
		definitions: cacheEntry?.definitions,
		parsed,
		lines,
	});
}

export function syncRuntimeSemanticWorkspacePath(input: SemanticWorkspacePathInput, workspace: LuaSemanticWorkspace = getOrCreateSemanticWorkspace()): FileSemanticData {
	const data = syncSemanticWorkspacePath(input, workspace);
	cacheRuntimeSemanticWorkspaceAnalysis(input.path, data.source, data, data.parsed);
	return data;
}

export function primeRuntimeSemanticWorkspaceProjectSources(workspace: LuaSemanticWorkspace = getOrCreateSemanticWorkspace()): LuaSemanticWorkspace {
	if (primedProjectWorkspace === workspace) {
		return workspace;
	}
	const sources = machineManager.sourceState;
	for (let registryIndex = 0; registryIndex < sources.luaSourceRegistries.length; registryIndex += 1) {
		const registry = sources.luaSourceRegistries[registryIndex];
		for (let recordIndex = 0; recordIndex < registry.records.length; recordIndex += 1) {
			const path = registry.records[recordIndex].source_path;
			const cacheEntry = runtimeSemanticCache.get(path);
			const source = cacheEntry ? cacheEntry.source : luaPipeline.resourceSourceForChunk(path);
			const existing = workspace.getFileData(path);
			if (existing && existing.source === source) {
				continue;
			}
			const lines = cacheEntry?.lines ?? splitText(source);
			const parsed = cacheEntry?.parsed;
			workspace.updateFile(path, source, lines, parsed, undefined);
			const data = workspace.getFileData(path);
			cacheRuntimeSemanticWorkspaceAnalysis(path, source, data, parsed);
		}
	}
	primedProjectWorkspace = workspace;
	return workspace;
}

export function prepareRuntimeSemanticWorkspaceForEditorBuffer(input: SemanticWorkspacePathInput): LuaSemanticWorkspaceSnapshot {
	const workspace = getOrCreateSemanticWorkspace();
	syncRuntimeSemanticWorkspacePath(input, workspace);
	primeRuntimeSemanticWorkspaceProjectSources(workspace);
	return workspace.getSnapshot();
}
