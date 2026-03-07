import type { ParsedLuaChunk } from './lua_parse';
import { getCachedLuaParse } from './lua_analysis_cache';
import { ide_state } from './ide_state';
import { LuaSemanticWorkspace, type FileSemanticData } from './semantic_model';
import { Runtime } from '../runtime';
import * as runtimeLuaPipeline from '../runtime_lua_pipeline';
import { splitText } from './source_text';
import { $ } from '../../core/engine_core';

export type SemanticWorkspacePathInput = {
	path: string;
	source: string;
	lines?: readonly string[];
	parsed?: ParsedLuaChunk;
	version?: number;
};

let primedProjectWorkspace: LuaSemanticWorkspace = null;

export function getOrCreateSemanticWorkspace(): LuaSemanticWorkspace {
	const workspace = ide_state.semanticWorkspace;
	if (workspace) {
		return workspace;
	}
	const created = new LuaSemanticWorkspace();
	ide_state.semanticWorkspace = created;
	return created;
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
	});
	const existing = workspace.getFileData(input.path);
	if (!existing || existing.source !== parseEntry.source) {
		workspace.updateFile(input.path, parseEntry.source, parseEntry.lines, parseEntry.parsed, input.version);
	}
	const data = workspace.getFileData(input.path);
	cacheSemanticAnalysis(input.path, parseEntry.source, data, parseEntry.parsed);
	return data;
}

export function primeSemanticWorkspaceProjectSources(workspace: LuaSemanticWorkspace = getOrCreateSemanticWorkspace()): LuaSemanticWorkspace {
	if (primedProjectWorkspace === workspace) {
		return workspace;
	}
	const runtime = Runtime.instance;
	const path2lua = $.lua_sources.path2lua;
	for (const path in path2lua) {
		const cacheEntry = runtime.pathSemanticCache.get(path);
		const source = cacheEntry ? cacheEntry.source : runtimeLuaPipeline.resourceSourceForChunk(runtime, path);
		const existing = workspace.getFileData(path);
		if (existing && existing.source === source) {
			continue;
		}
		const lines = cacheEntry?.lines ?? splitText(source);
		const parsed = cacheEntry?.parsed;
		workspace.updateFile(path, source, lines, parsed);
		const data = workspace.getFileData(path);
		cacheSemanticAnalysis(path, source, data, parsed);
	}
	primedProjectWorkspace = workspace;
	return workspace;
}

export function prepareSemanticWorkspaceForEditorBuffer(input: SemanticWorkspacePathInput): LuaSemanticWorkspace {
	const workspace = getOrCreateSemanticWorkspace();
	syncSemanticWorkspacePath(input, workspace);
	primeSemanticWorkspaceProjectSources(workspace);
	return workspace;
}
