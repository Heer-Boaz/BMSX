import type { ParsedLuaChunk } from '../../../language/lua/lua_parse';
import { getCachedLuaParse } from '../../../language/lua/lua_analysis_cache';
import { editorRuntimeState } from '../../common/editor_runtime_state';
import { LuaSemanticWorkspace, type FileSemanticData, type LuaSemanticWorkspaceSnapshot } from './semantic_model';
import { Runtime } from '../../../../machine/runtime/runtime';
import * as runtimeLuaPipeline from '../../../runtime/runtime_lua_pipeline';
import { splitText } from '../../text/source_text';

export type SemanticWorkspacePathInput = {
	path: string;
	source: string;
	lines?: readonly string[];
	parsed?: ParsedLuaChunk;
	version?: number;
};

let primedProjectWorkspace: LuaSemanticWorkspace = null;
let semanticWorkspace: LuaSemanticWorkspace = null;

export function getOrCreateSemanticWorkspace(): LuaSemanticWorkspace {
	if (semanticWorkspace) {
		return semanticWorkspace;
	}
	semanticWorkspace = new LuaSemanticWorkspace();
	return semanticWorkspace;
}

export function resetSemanticWorkspace(): LuaSemanticWorkspace {
	primedProjectWorkspace = null;
	semanticWorkspace = new LuaSemanticWorkspace();
	return semanticWorkspace;
}

function cacheSemanticAnalysis(path: string, source: string, data: FileSemanticData, parsed?: ParsedLuaChunk): void {
	Runtime.instance.pathSemanticCache.set(path, {
		source,
		model: data.model,
		definitions: data.model.definitions,
		parsed,
		lines: data.lines,
		analysis: data,
	});
}

export function cacheSemanticWorkspaceAnalysis(path: string, source: string, data: FileSemanticData, parsed?: ParsedLuaChunk): void {
	cacheSemanticAnalysis(path, source, data, parsed);
}

export function cacheSemanticParseState(path: string, source: string, lines: readonly string[], parsed: ParsedLuaChunk): void {
	const cacheEntry = Runtime.instance.pathSemanticCache.get(path);
	Runtime.instance.pathSemanticCache.set(path, {
		source,
		model: cacheEntry?.model,
		definitions: cacheEntry?.definitions,
		parsed,
		lines,
	});
}

export function syncSemanticWorkspacePath(input: SemanticWorkspacePathInput, workspace: LuaSemanticWorkspace = getOrCreateSemanticWorkspace()): FileSemanticData {
	const parseEntry = getCachedLuaParse({
		path: input.path,
		source: input.source,
		lines: input.lines,
		version: input.version,
		withSyntaxError: false,
		parsed: input.parsed,
		canonicalization: editorRuntimeState.caseInsensitive ? editorRuntimeState.canonicalization : 'none',
	});
	const existing = workspace.getFileData(input.path);
	if (!existing || existing.source !== parseEntry.source) {
		workspace.updateFile(input.path, parseEntry.source, parseEntry.lines, parseEntry.parsed, input.version, editorRuntimeState.caseInsensitive ? editorRuntimeState.canonicalization : 'none');
	}
	const data = workspace.getFileData(input.path);
	cacheSemanticAnalysis(input.path, parseEntry.source, data, parseEntry.parsed);
	return data;
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

export function primeSemanticWorkspaceProjectSources(workspace: LuaSemanticWorkspace = getOrCreateSemanticWorkspace()): LuaSemanticWorkspace {
	if (primedProjectWorkspace === workspace) {
		return workspace;
	}
	const runtime = Runtime.instance;
	const registries = runtimeLuaPipeline.listLuaSourceRegistries(runtime);
	for (let registryIndex = 0; registryIndex < registries.length; registryIndex += 1) {
		const path2lua = registries[registryIndex]!.registry.path2lua;
		for (const path in path2lua) {
			const cacheEntry = runtime.pathSemanticCache.get(path);
			const source = cacheEntry ? cacheEntry.source : runtimeLuaPipeline.resourceSourceForChunk(runtime, path);
			const existing = workspace.getFileData(path);
			if (existing && existing.source === source) {
				continue;
			}
			const lines = cacheEntry?.lines ?? splitText(source);
			const parsed = cacheEntry?.parsed;
			workspace.updateFile(path, source, lines, parsed, undefined, editorRuntimeState.caseInsensitive ? editorRuntimeState.canonicalization : 'none');
			const data = workspace.getFileData(path);
			cacheSemanticAnalysis(path, source, data, parsed);
		}
	}
	primedProjectWorkspace = workspace;
	return workspace;
}

export function prepareSemanticWorkspaceForEditorBuffer(input: SemanticWorkspacePathInput): LuaSemanticWorkspaceSnapshot {
	const workspace = getOrCreateSemanticWorkspace();
	syncSemanticWorkspacePath(input, workspace);
	primeSemanticWorkspaceProjectSources(workspace);
	return workspace.getSnapshot();
}
