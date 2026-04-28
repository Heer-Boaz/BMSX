import { clamp } from '../../../../common/clamp';
import type { LuaDefinitionLocation, LuaSymbolEntry } from '../../../../lua/semantic_contracts';
import type { ResourceDescriptor } from '../../../../rompack/resource';
import type { CodeTabContext, SearchMatch, SymbolSearchResult } from '../../../common/models';
import { parseLuaIdentifierChain } from '../../../language/lua/identifier_chain';
import * as luaPipeline from '../../../runtime/lua_pipeline';
import { createEditorSemanticFrontend } from '../intellisense/frontend';
import { LuaSemanticWorkspace } from '../intellisense/semantic/workspace';
import { syncSemanticWorkspacePaths, type SemanticWorkspacePathInput } from '../intellisense/semantic/workspace/state';
import { ReferenceState, type ReferenceMatchInfo } from './state';
import { splitText } from '../../../../common/text_lines';
import { getLinesSnapshot, getTextSnapshot } from '../../text/source_text';
import { listResources } from '../../../workspace/workspace';
import type { Decl, LuaSemanticWorkspaceSnapshot } from '../../../../lua/semantic/model';
import { computeSourceLabel } from '../../../common/paths';

export type ProjectReferenceEnvironment = {
	activeContext: CodeTabContext;
	activeSource: string;
	activeLines: readonly string[];
	codeTabContexts: Iterable<CodeTabContext>;
	listResources?: () => ResourceDescriptor[];
	loadLuaResource?: (asset_id: string) => string;
};

export type ReferenceSymbolEntry = LuaSymbolEntry & {
	__referenceMatch: SearchMatch;
	__referenceIndex: number;
	__referenceColumn: number;
};

export type ReferenceCatalogEntry = {
	symbol: ReferenceSymbolEntry;
	displayName: string;
	searchKey: string;
	line: number;
	kindLabel: string;
	sourceLabel: string;
};

type FileMetadata = {
	path: string;
	lines: readonly string[];
	sourceLabel: string;
	asset_id?: string;
};

export function buildReferenceCatalogForExpression(options: {
	workspace: LuaSemanticWorkspace;
	info: ReferenceMatchInfo;
	source: string;
	lines: readonly string[];
	path: string;
	environment: ProjectReferenceEnvironment;
}): ReferenceCatalogEntry[] {
	const { metadata, frontend } = prepareProjectSemanticFrontend(options.workspace, options.environment, options.path, options.source, options.lines);
	const entries: ReferenceCatalogEntry[] = [];
	const existingKeys = new Set<string>();
	let nextIndex = 0;

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
				referenceIndex: nextIndex,
			});
			appendCatalogEntry(entries, existingKeys, entry);
			nextIndex += 1;
		}
	}

	const decl = frontend.getDecl(options.info.definitionKey);
	if (decl) {
		const meta = metadata.get(decl.file);
		if (meta) {
			const match = rangeToSearchMatch(decl.range, meta.lines);
			if (match) {
				const entry = createCatalogEntry({
					meta,
					match,
					location: toDefinitionLocation(decl.range, meta.asset_id),
					expression: options.info.expression,
					referenceIndex: nextIndex,
				});
				appendCatalogEntry(entries, existingKeys, entry);
				nextIndex += 1;
			}
		}
	}

	const references = frontend.getReferences(options.info.definitionKey);
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
			location: toDefinitionLocation(reference.range, meta.asset_id),
			expression: options.info.expression,
			referenceIndex: nextIndex,
		});
		appendCatalogEntry(entries, existingKeys, entry);
		nextIndex += 1;
	}
	return entries;
}

export function resolveDefinitionLocationForExpression(options: {
	expression: string;
	environment: ProjectReferenceEnvironment;
	workspace: LuaSemanticWorkspace;
	currentPath: string;
	currentSource: string;
	currentLines: readonly string[];
}): LuaDefinitionLocation {
	const namePath = parseLuaIdentifierChain(options.expression);
	if (!namePath || namePath.length === 0) {
		return null;
	}
	const { metadata, frontend } = prepareProjectSemanticFrontend(options.workspace, options.environment, options.currentPath, options.currentSource, options.currentLines);
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
	const meta = metadata.get(best.file);
	return toDefinitionLocation(best.range, meta?.asset_id);
}

export function filterReferenceCatalog(options: {
	catalog: readonly ReferenceCatalogEntry[];
	query: string;
	state: ReferenceState;
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
			matches.push({ entry, matchIndex: matchIndex === -1 ? Number.MAX_SAFE_INTEGER : matchIndex });
		}
	}
	if (matches.length === 0) {
		options.state.setActiveIndex(-1);
		return { matches: [], selectionIndex: -1, displayOffset: 0 };
	}
	matches.sort(compareReferenceSearchResult);
	let selectionIndex = options.state.getActiveIndex();
	if (selectionIndex < 0 || selectionIndex >= matches.length) {
		selectionIndex = 0;
	}
	options.state.setActiveIndex(selectionIndex);
	// start value-or-boundary -- reference result window offset is bounded once against the current filtered list.
	let displayOffset = clamp(selectionIndex - Math.floor(options.pageSize / 2), 0, Math.max(0, matches.length - options.pageSize));
	// end value-or-boundary
	if (selectionIndex >= displayOffset + options.pageSize) {
		displayOffset = selectionIndex - options.pageSize + 1;
	}
	return { matches, selectionIndex, displayOffset };
}

function prepareProjectSemanticFrontend(
	workspace: LuaSemanticWorkspace,
	environment: ProjectReferenceEnvironment,
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

	for (const context of environment.codeTabContexts) {
		const path = context.descriptor.path;
		if (metadata.has(path)) {
			continue;
		}
		const source = context === environment.activeContext
			? environment.activeSource
			: resolveContextSource(context);
		const lines = context === environment.activeContext
			? environment.activeLines
			: getLinesSnapshot(context.buffer);
		registerProjectFile(inputs, metadata, path, source, lines);
	}

	const resources = environment.listResources ? environment.listResources() : listResources();
	for (let index = 0; index < resources.length; index += 1) {
		const descriptor = resources[index];
		if (!(descriptor.type === 'lua' || descriptor.path.endsWith('.lua')) || metadata.has(descriptor.path)) {
			continue;
		}
		const source = environment.loadLuaResource && descriptor.asset_id
			? environment.loadLuaResource(descriptor.asset_id)
			: luaPipeline.resourceSourceForChunk(descriptor.path);
		const lines = splitText(source);
		registerProjectFile(inputs, metadata, descriptor.path, source, lines, descriptor.asset_id);
	}
	const snapshot = syncSemanticWorkspacePaths(inputs, workspace);

	return {
		metadata,
		snapshot,
		frontend: createEditorSemanticFrontend(snapshot),
	};
}

function registerProjectFile(
	inputs: SemanticWorkspacePathInput[],
	metadata: Map<string, FileMetadata>,
	path: string,
	source: string,
	lines: readonly string[],
	asset_id?: string,
): void {
	if (metadata.has(path)) {
		return;
	}
	inputs.push({ path, source, lines });
	metadata.set(path, {
		path,
		lines,
		sourceLabel: computeSourceLabel(path),
		asset_id,
	});
}

function resolveContextSource(context: CodeTabContext): string {
	return getTextSnapshot(context.buffer);
}

function toDefinitionLocation(
	range: { path: string; start: { line: number; column: number }; end: { line: number; column: number } },
	asset_id?: string,
): LuaDefinitionLocation {
	const location = {
		path: range.path,
		range: {
			startLine: range.start.line,
			startColumn: range.start.column,
			endLine: range.end.line,
			endColumn: range.end.column,
		},
	} as LuaDefinitionLocation & { asset_id?: string };
	if (asset_id) {
		location.asset_id = asset_id;
	}
	return location;
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
	referenceIndex: number;
}): ReferenceCatalogEntry {
	const snippet = buildReferenceSnippet(args.meta.lines, args.match);
	const symbolName = args.expression.length > 0 ? args.expression : snippet;
	return {
		symbol: {
			name: symbolName,
			path: args.meta.sourceLabel,
			kind: 'assignment',
			location: args.location,
			__referenceMatch: args.match,
			__referenceIndex: args.referenceIndex,
			__referenceColumn: args.match.start + 1,
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

function appendCatalogEntry(entries: ReferenceCatalogEntry[], existingKeys: Set<string>, entry: ReferenceCatalogEntry): void {
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
	const leftSymbol = left.entry.symbol as ReferenceSymbolEntry;
	const rightSymbol = right.entry.symbol as ReferenceSymbolEntry;
	if (leftSymbol.location.range.startLine !== rightSymbol.location.range.startLine) {
		return leftSymbol.location.range.startLine - rightSymbol.location.range.startLine;
	}
	if (leftSymbol.__referenceColumn !== rightSymbol.__referenceColumn) {
		return leftSymbol.__referenceColumn - rightSymbol.__referenceColumn;
	}
	return left.entry.displayName.localeCompare(right.entry.displayName);
}
