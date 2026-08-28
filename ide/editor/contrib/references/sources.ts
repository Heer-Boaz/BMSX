import { clamp } from '../../../../machine/ts/common/clamp';
import type { LuaDefinitionLocation } from '../../../../toolchain/ts/lua/semantic_contracts';
import {
	SYSTEM_RESOURCE_DOMAIN,
} from '../../../common/resource';
import type { SearchMatch, SymbolCatalogEntry } from '../../../common/models';
import type { EditorDocumentContext } from '../../editing/document_state';
import { parseLuaIdentifierChain } from '../../../language/lua/identifier_chain';
import * as luaPipeline from '../../../runtime/lua_pipeline';
import { createEditorSemanticFrontend } from '../intellisense/frontend';
import { LuaSemanticWorkspace } from '../intellisense/semantic/workspace/index';
import { syncSemanticWorkspacePaths, type SemanticWorkspacePathInput } from '../intellisense/semantic/workspace/state';
import type { ReferenceMatchInfo } from './state';
import { splitText } from '../../../../machine/ts/common/text_lines';
import { getLinesSnapshot, getTextSnapshot } from '../../text/source_text';
import type { Decl, LuaSemanticWorkspaceSnapshot } from '../../../../toolchain/ts/lua/semantic/model';
import { computeSourceLabel } from '../../../common/paths';
import type { RuntimeLuaTooling } from '../../../runtime/lua_tooling';
import { definitionLocationFromSourceRange, searchMatchFromSourceRange } from '../../navigation/source_range';

type FileMetadata = {
	path: string;
	lines: readonly string[];
	sourceLabel: string;
};

export function buildReferenceCatalogForExpression(bridge: RuntimeLuaTooling, options: {
	workspace: LuaSemanticWorkspace;
	info: ReferenceMatchInfo;
	source: string;
	lines: readonly string[];
	path: string;
	activeContext: EditorDocumentContext;
	codeTabContexts: Iterable<EditorDocumentContext>;
}): SymbolCatalogEntry[] {
	const { metadata, frontend } = prepareProjectSemanticFrontend(
		bridge,
		options.workspace,
		options.activeContext,
		options.codeTabContexts,
		options.path,
		options.source,
		options.lines,
	);
	const entries: SymbolCatalogEntry[] = [];

	for (let definitionIndex = 0; definitionIndex < options.info.definitionKeys.length; definitionIndex += 1) {
		const definitionKey = options.info.definitionKeys[definitionIndex];
		const decl = frontend.snapshot.symbolResolver.getDeclaration(definitionKey);
		const meta = metadata.get(decl.file);
		entries.push(createCatalogEntry({
			meta,
			match: searchMatchFromSourceRange(decl.range),
			location: definitionLocationFromSourceRange(decl.range),
			expression: options.info.expression,
		}));
	}
	const references = frontend.snapshot.symbolResolver.getReferencesForSymbols(options.info.definitionKeys);
	for (let referenceIndex = 0; referenceIndex < references.length; referenceIndex += 1) {
		const reference = references[referenceIndex];
		const referenceMeta = metadata.get(reference.file);
		entries.push(createCatalogEntry({
			meta: referenceMeta,
			match: searchMatchFromSourceRange(reference.range),
			location: definitionLocationFromSourceRange(reference.range),
			expression: options.info.expression,
		}));
	}
	return entries;
}

export function resolveDefinitionLocationForExpression(bridge: RuntimeLuaTooling, options: {
	expression: string;
	activeContext: EditorDocumentContext;
	codeTabContexts: Iterable<EditorDocumentContext>;
	workspace: LuaSemanticWorkspace;
	currentPath: string;
	currentSource: string;
	currentLines: readonly string[];
}): LuaDefinitionLocation {
	const namePath = parseLuaIdentifierChain(options.expression);
	if (!namePath || namePath.length === 0) {
		return null;
	}
	const { frontend } = prepareProjectSemanticFrontend(
		bridge,
		options.workspace,
		options.activeContext,
		options.codeTabContexts,
		options.currentPath,
		options.currentSource,
		options.currentLines,
	);
	const candidates = frontend.findDeclarationsByNamePath(namePath);
	let best: Decl = null;
	let bestScore = Number.NEGATIVE_INFINITY;
	for (let index = 0; index < candidates.length; index += 1) {
		const decl = candidates[index];
		const score = declarationPriority(decl);
		if (!best || score > bestScore || (score === bestScore && preferDeclaration(decl, best))) {
			best = decl;
			bestScore = score;
		}
	}
	if (!best) {
		return null;
	}
	return definitionLocationFromSourceRange(best.range);
}

function prepareProjectSemanticFrontend(
	bridge: RuntimeLuaTooling,
	workspace: LuaSemanticWorkspace,
	activeContext: EditorDocumentContext,
	codeTabContexts: Iterable<EditorDocumentContext>,
	currentPath: string,
	currentSource: string,
	currentLines: readonly string[],
): {
	metadata: Map<string, FileMetadata>;
	snapshot: LuaSemanticWorkspaceSnapshot;
	frontend: ReturnType<typeof createEditorSemanticFrontend>;
} {
	const metadata = new Map<string, FileMetadata>();
	const inputs: SemanticWorkspacePathInput[] = [];
	registerProjectFile(inputs, metadata, currentPath, currentSource, currentLines);

	const activeDomain = activeContext.resource.domain;
	const sourceDomains = activeDomain === SYSTEM_RESOURCE_DOMAIN
		? [activeDomain]
		: [activeDomain, SYSTEM_RESOURCE_DOMAIN] as const;
	for (let domainIndex = 0; domainIndex < sourceDomains.length; domainIndex += 1) {
		const domain = sourceDomains[domainIndex];
		for (const context of codeTabContexts) {
			if (context.resource.domain !== domain) {
				continue;
			}
			const path = context.resource.path;
			if (metadata.has(path)) {
				continue;
			}
			const source = context === activeContext
				? currentSource
				: getTextSnapshot(context.buffer);
			const lines = context === activeContext
				? currentLines
				: getLinesSnapshot(context.buffer);
			registerProjectFile(inputs, metadata, path, source, lines);
		}
	}

	const resources = bridge.sources.luaResources;
	for (let domainIndex = 0; domainIndex < sourceDomains.length; domainIndex += 1) {
		const domain = sourceDomains[domainIndex];
		for (let index = 0; index < resources.length; index += 1) {
			const resource = resources[index];
			if (resource.domain !== domain || metadata.has(resource.path)) {
				continue;
			}
			const source = luaPipeline.resourceSourceForChunk(bridge.sources, resource);
			const lines = splitText(source);
			registerProjectFile(inputs, metadata, resource.path, source, lines);
		}
	}
	const snapshot = syncSemanticWorkspacePaths(inputs, workspace);

	return {
		metadata,
		snapshot,
		frontend: createEditorSemanticFrontend(bridge, snapshot),
	};
}

function registerProjectFile(
	inputs: SemanticWorkspacePathInput[],
	metadata: Map<string, FileMetadata>,
	path: string,
	source: string,
	lines: readonly string[],
): void {
	if (metadata.has(path)) {
		return;
	}
	inputs.push({ path, source });
	metadata.set(path, {
		path,
		lines,
		sourceLabel: computeSourceLabel(path),
	});
}

function createCatalogEntry(args: {
	meta: FileMetadata;
	match: SearchMatch;
	location: LuaDefinitionLocation;
	expression: string;
}): SymbolCatalogEntry {
	const snippet = buildReferenceSnippet(args.meta.lines, args.match);
	const symbolName = args.expression.length > 0 ? args.expression : snippet;
	return {
		symbol: {
			name: symbolName,
			path: args.meta.sourceLabel,
			kind: 'assignment',
			location: args.location,
		},
		displayName: snippet,
		searchKey: [snippet, symbolName, args.meta.sourceLabel].join(' ').trim().toLowerCase(),
		line: args.match.row + 1,
		kindLabel: 'REF',
		sourceLabel: args.meta.sourceLabel,
	};
}

function buildReferenceSnippet(lines: readonly string[], match: SearchMatch): string {
	const line = lines[match.row];
	const start = clamp(match.start - 20, 0, line.length);
	const end = clamp(match.end + 20, start, line.length);
	const snippet = line.slice(start, end).trim();
	return snippet.length > 0 ? snippet : line.trim();
}

function declarationPriority(decl: Decl): number {
	const topLevel = decl.scope.start.line === 1 && decl.scope.start.column === 1;
	switch (decl.kind) {
		case 'property':
			return 700;
		case 'function':
			return topLevel ? 650 : 520;
		case 'constant':
			return topLevel ? 560 : 380;
		case 'parameter':
			return 400;
		case 'global':
			return 600;
		default:
			return topLevel ? 500 : 350;
	}
}

function preferDeclaration(candidate: Decl, current: Decl): boolean {
	if (candidate.range.start.line !== current.range.start.line) {
		return candidate.range.start.line < current.range.start.line;
	}
	if (candidate.range.start.column !== current.range.start.column) {
		return candidate.range.start.column < current.range.start.column;
	}
	return candidate.name.localeCompare(current.name) < 0;
}
