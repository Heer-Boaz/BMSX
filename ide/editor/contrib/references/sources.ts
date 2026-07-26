import { clamp } from '../../../../machine/ts/common/clamp';
import type { LuaDefinitionLocation } from '../../../../machine/ts/lua/semantic_contracts';
import {
	SYSTEM_RESOURCE_DOMAIN,
} from '../../../common/resource';
import type { CodeTabContext, SearchMatch, SymbolCatalogEntry, SymbolSearchResult } from '../../../common/models';
import { parseLuaIdentifierChain } from '../../../language/lua/identifier_chain';
import * as luaPipeline from '../../../runtime/lua_pipeline';
import { createEditorSemanticFrontend } from '../intellisense/frontend';
import { LuaSemanticWorkspace } from '../intellisense/semantic/workspace/index';
import { syncSemanticWorkspacePaths, type SemanticWorkspacePathInput } from '../intellisense/semantic/workspace/state';
import type { ReferenceMatchInfo } from './state';
import { splitText } from '../../../../machine/ts/common/text_lines';
import { getLinesSnapshot, getTextSnapshot } from '../../text/source_text';
import type { Decl, LuaSemanticWorkspaceSnapshot } from '../../../../machine/ts/lua/semantic/model';
import { computeSourceLabel } from '../../../common/paths';
import type { RuntimeNativeBridge } from '../../../runtime/native_bridge';

type FileMetadata = {
	path: string;
	lines: readonly string[];
	sourceLabel: string;
};

export function buildReferenceCatalogForExpression(bridge: RuntimeNativeBridge, options: {
	workspace: LuaSemanticWorkspace;
	info: ReferenceMatchInfo;
	source: string;
	lines: readonly string[];
	path: string;
	activeContext: CodeTabContext;
	codeTabContexts: Iterable<CodeTabContext>;
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
	const existingKeys = new Set<string>();

	const baseMeta = metadata.get(options.path);
	if (baseMeta) {
		for (let index = 0; index < options.info.matches.length; index += 1) {
			const match = options.info.matches[index];
			const entry = createCatalogEntry({
				meta: baseMeta,
				match,
				location: {
					path: options.path,
					range: {
						startLine: match.row + 1,
						startColumn: match.start + 1,
						endLine: match.row + 1,
						endColumn: match.end,
					},
				},
				expression: options.info.expression,
			});
			appendCatalogEntry(entries, existingKeys, entry);
		}
	}

	const decl = frontend.snapshot.getDecl(options.info.definitionKey);
	if (decl) {
		const meta = metadata.get(decl.file);
		if (meta) {
			const match = rangeToSearchMatch(decl.range, meta.lines);
			if (match) {
				const entry = createCatalogEntry({
					meta,
					match,
					location: toDefinitionLocation(decl.range),
					expression: options.info.expression,
				});
				appendCatalogEntry(entries, existingKeys, entry);
			}
		}
	}

	const references = frontend.snapshot.getReferences(options.info.definitionKey);
	for (let index = 0; index < references.length; index += 1) {
		const reference = references[index];
		const meta = metadata.get(reference.file);
		if (!meta) {
			continue;
		}
		const match = rangeToSearchMatch(reference.range, meta.lines);
		if (!match) {
			continue;
		}
		const entry = createCatalogEntry({
			meta,
			match,
			location: toDefinitionLocation(reference.range),
			expression: options.info.expression,
		});
		appendCatalogEntry(entries, existingKeys, entry);
	}
	return entries;
}

export function resolveDefinitionLocationForExpression(bridge: RuntimeNativeBridge, options: {
	expression: string;
	activeContext: CodeTabContext;
	codeTabContexts: Iterable<CodeTabContext>;
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
	return toDefinitionLocation(best.range);
}

export function filterReferenceCatalog(options: {
	catalog: readonly SymbolCatalogEntry[];
	query: string;
	activeCatalogIndex: number;
	pageSize: number;
}): {
	matches: SymbolSearchResult[];
	selectionIndex: number;
	displayOffset: number;
} {
	const normalized = options.query.trim();
	const matches: SymbolSearchResult[] = [];
	for (let index = 0; index < options.catalog.length; index += 1) {
		const entry = options.catalog[index];
		const matchIndex = normalized.length === 0 ? 0 : entry.searchKey.indexOf(normalized);
		if (normalized.length === 0 || matchIndex !== -1) {
			matches.push({
				entry,
				matchIndex: matchIndex === -1 ? Number.MAX_SAFE_INTEGER : matchIndex,
				catalogIndex: index,
			});
		}
	}
	if (matches.length === 0) {
		return { matches: [], selectionIndex: -1, displayOffset: 0 };
	}
	matches.sort(compareReferenceSearchResult);
	let selectionIndex = 0;
	for (let index = 0; index < matches.length; index += 1) {
		if (matches[index].catalogIndex === options.activeCatalogIndex) {
			selectionIndex = index;
			break;
		}
	}
	// start value-or-boundary -- reference result window offset is bounded once against the current filtered list.
	let displayOffset = clamp(selectionIndex - Math.floor(options.pageSize / 2), 0, Math.max(0, matches.length - options.pageSize));
	// end value-or-boundary
	if (selectionIndex >= displayOffset + options.pageSize) {
		displayOffset = selectionIndex - options.pageSize + 1;
	}
	return { matches, selectionIndex, displayOffset };
}

function prepareProjectSemanticFrontend(
	bridge: RuntimeNativeBridge,
	workspace: LuaSemanticWorkspace,
	activeContext: CodeTabContext,
	codeTabContexts: Iterable<CodeTabContext>,
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
	inputs.push({ path, source, lines });
	metadata.set(path, {
		path,
		lines,
		sourceLabel: computeSourceLabel(path),
	});
}

function toDefinitionLocation(
	range: { path: string; start: { line: number; column: number }; end: { line: number; column: number } },
): LuaDefinitionLocation {
	return {
		path: range.path,
		range: {
			startLine: range.start.line,
			startColumn: range.start.column,
			endLine: range.end.line,
			endColumn: range.end.column,
		},
	};
}

function rangeToSearchMatch(
	range: { start: { line: number; column: number }; end: { line: number; column: number } },
	lines: readonly string[],
): SearchMatch {
	const rowIndex = range.start.line - 1;
	if (rowIndex < 0 || rowIndex >= lines.length) {
		return null;
	}
	const start = range.start.column - 1;
	const end = range.end.column;
	return end > start ? { row: rowIndex, start, end } : null;
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
		searchKey: [snippet, symbolName, args.meta.sourceLabel].join(' ').trim(),
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

function appendCatalogEntry(entries: SymbolCatalogEntry[], existingKeys: Set<string>, entry: SymbolCatalogEntry): void {
	const key = `${entry.symbol.location.path}:${entry.symbol.location.range.startLine}:${entry.symbol.location.range.startColumn}`;
	if (existingKeys.has(key)) {
		return;
	}
	entries.push(entry);
	existingKeys.add(key);
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

function compareReferenceSearchResult(left: SymbolSearchResult, right: SymbolSearchResult): number {
	if (left.matchIndex !== right.matchIndex) {
		return left.matchIndex - right.matchIndex;
	}
	const leftSymbol = left.entry.symbol;
	const rightSymbol = right.entry.symbol;
	if (leftSymbol.location.range.startLine !== rightSymbol.location.range.startLine) {
		return leftSymbol.location.range.startLine - rightSymbol.location.range.startLine;
	}
	if (leftSymbol.location.range.startColumn !== rightSymbol.location.range.startColumn) {
		return leftSymbol.location.range.startColumn - rightSymbol.location.range.startColumn;
	}
	return left.entry.displayName.localeCompare(right.entry.displayName);
}
