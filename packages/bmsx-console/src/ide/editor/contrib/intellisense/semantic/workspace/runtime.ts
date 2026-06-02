import type { ParsedLuaChunk } from '../../../../../../lua/analysis/parse';
import { splitText } from '../../../../../../common/text_lines';
import * as luaPipeline from '../../../../../runtime/lua_pipeline';
import {
	getOrCreateSemanticWorkspace,
	syncSemanticWorkspacePath,
	type SemanticWorkspacePathInput,
} from './state';
import type { FileSemanticData, LuaSemanticWorkspace, LuaSemanticWorkspaceSnapshot } from '../../../../../../lua/semantic/model';
import type { Runtime } from '../../../../../../machine/runtime/runtime';

let primedProjectWorkspace: LuaSemanticWorkspace = null;

export function cacheRuntimeSemanticWorkspaceAnalysis(runtime: Runtime, path: string, source: string, data: FileSemanticData, parsed?: ParsedLuaChunk): void {
	runtime.pathSemanticCache.set(path, {
		source,
		model: data.model,
		definitions: data.model.definitions,
		parsed,
		lines: data.lines,
		analysis: data,
	});
}

export function cacheRuntimeSemanticParseState(runtime: Runtime, path: string, source: string, lines: readonly string[], parsed: ParsedLuaChunk): void {
	const cacheEntry = runtime.pathSemanticCache.get(path);
	runtime.pathSemanticCache.set(path, {
		source,
		model: cacheEntry?.model,
		definitions: cacheEntry?.definitions,
		parsed,
		lines,
	});
}

export function syncRuntimeSemanticWorkspacePath(runtime: Runtime, input: SemanticWorkspacePathInput, workspace: LuaSemanticWorkspace = getOrCreateSemanticWorkspace()): FileSemanticData {
	const data = syncSemanticWorkspacePath(input, workspace);
	cacheRuntimeSemanticWorkspaceAnalysis(runtime, input.path, data.source, data, data.parsed);
	return data;
}

export function primeRuntimeSemanticWorkspaceProjectSources(runtime: Runtime, workspace: LuaSemanticWorkspace = getOrCreateSemanticWorkspace()): LuaSemanticWorkspace {
	if (primedProjectWorkspace === workspace) {
		return workspace;
	}
	const registries = luaPipeline.listLuaSourceRegistries(runtime);
	for (let registryIndex = 0; registryIndex < registries.length; registryIndex += 1) {
		const path2lua = registries[registryIndex]!.registry.path2lua;
		for (const path in path2lua) {
			const cacheEntry = runtime.pathSemanticCache.get(path);
			const source = cacheEntry ? cacheEntry.source : luaPipeline.resourceSourceForChunk(runtime, path);
			const existing = workspace.getFileData(path);
			if (existing && existing.source === source) {
				continue;
			}
			const lines = cacheEntry?.lines ?? splitText(source);
			const parsed = cacheEntry?.parsed;
			workspace.updateFile(path, source, lines, parsed, undefined);
			const data = workspace.getFileData(path);
			cacheRuntimeSemanticWorkspaceAnalysis(runtime, path, source, data, parsed);
		}
	}
	primedProjectWorkspace = workspace;
	return workspace;
}

export function prepareRuntimeSemanticWorkspaceForEditorBuffer(runtime: Runtime, input: SemanticWorkspacePathInput): LuaSemanticWorkspaceSnapshot {
	const workspace = getOrCreateSemanticWorkspace();
	syncRuntimeSemanticWorkspacePath(runtime, input, workspace);
	primeRuntimeSemanticWorkspaceProjectSources(runtime, workspace);
	return workspace.getSnapshot();
}
