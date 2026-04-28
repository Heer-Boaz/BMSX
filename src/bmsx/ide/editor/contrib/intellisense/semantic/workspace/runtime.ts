import type { ParsedLuaChunk } from '../../../../../../lua/analysis/parse';
import { splitText } from '../../../../../../common/text_lines';
import { Runtime } from '../../../../../../machine/runtime/runtime';
import * as luaPipeline from '../../../../../runtime/lua_pipeline';
import {
	getOrCreateSemanticWorkspace,
	syncSemanticWorkspacePath,
	type SemanticWorkspacePathInput,
} from './state';
import type { FileSemanticData, LuaSemanticWorkspace, LuaSemanticWorkspaceSnapshot } from '../../../../../../lua/semantic/model';

let primedProjectWorkspace: LuaSemanticWorkspace = null;

export function cacheRuntimeSemanticWorkspaceAnalysis(path: string, source: string, data: FileSemanticData, parsed?: ParsedLuaChunk): void {
	Runtime.instance.pathSemanticCache.set(path, {
		source,
		model: data.model,
		definitions: data.model.definitions,
		parsed,
		lines: data.lines,
		analysis: data,
	});
}

export function cacheRuntimeSemanticParseState(path: string, source: string, lines: readonly string[], parsed: ParsedLuaChunk): void {
	const cacheEntry = Runtime.instance.pathSemanticCache.get(path);
	Runtime.instance.pathSemanticCache.set(path, {
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
	const runtime = Runtime.instance;
	const registries = luaPipeline.listLuaSourceRegistries();
	for (let registryIndex = 0; registryIndex < registries.length; registryIndex += 1) {
		const path2lua = registries[registryIndex]!.registry.path2lua;
		for (const path in path2lua) {
			const cacheEntry = runtime.pathSemanticCache.get(path);
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
