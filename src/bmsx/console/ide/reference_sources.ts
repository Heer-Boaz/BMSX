import { clamp } from '../../utils/clamp';
import type { ConsoleLuaDefinitionLocation, ConsoleLuaSymbolEntry, ConsoleResourceDescriptor } from '../types';
import type { CodeTabContext, SearchMatch, SymbolSearchResult } from './types';
import type { ReferenceMatchInfo } from './reference_navigation';
import { ReferenceState } from './reference_navigation';
import { LuaSemanticWorkspace } from './semantic_workspace';
import type { Decl } from './semantic_model';

export type ProjectReferenceEnvironment = {
	activeContext: CodeTabContext | null;
	activeLines: readonly string[];
	codeTabContexts: Iterable<CodeTabContext>;
	listResources(): readonly ConsoleResourceDescriptor[];
	loadLuaResource(asset_id: string): string;
};

export type ReferenceSymbolEntry = ConsoleLuaSymbolEntry & {
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
	sourceLabel: string | null;
};

export function computeSourceLabel(path: string | null, fallback: string): string {
	if (path && path.length > 0) {
		const normalized = path.replace(/\\/g, '/');
		const lastSlash = normalized.lastIndexOf('/');
		if (lastSlash !== -1 && lastSlash + 1 < normalized.length) {
			return normalized.slice(lastSlash + 1);
		}
		return normalized;
	}
	return fallback;
}

export function isLuaResourceDescriptor(descriptor: ConsoleResourceDescriptor): boolean {
	const type = descriptor.type.toLowerCase();
	if (type === 'lua') {
		return true;
	}
	const normalizedPath = descriptor.path.toLowerCase();
	return normalizedPath.endsWith('.lua');
}

type FileMetadata = {
	chunkName: string;
	lines: readonly string[];
	asset_id: string | null;
	path: string | null;
	sourceLabel: string;
};

type CollectMetadataOptions = {
	workspace: LuaSemanticWorkspace;
	environment: ProjectReferenceEnvironment;
	currentChunkName: string;
	currentLines: readonly string[];
	currentasset_id: string | null;
	sourceLabelPath?: string | null;
};

type BuildReferenceCatalogOptions = {
	workspace: LuaSemanticWorkspace;
	info: ReferenceMatchInfo;
	lines: readonly string[];
	chunkName: string;
	asset_id: string | null;
	environment: ProjectReferenceEnvironment;
	sourceLabelPath?: string | null;
};

type ResolveDefinitionLocationOptions = {
	expression: string;
	environment: ProjectReferenceEnvironment;
	workspace: LuaSemanticWorkspace;
	currentChunkName: string;
	currentLines: readonly string[];
	currentasset_id: string | null;
	sourceLabelPath?: string | null;
};

type LuaSourceRangeLike = {
	startLine: number;
	startColumn: number;
	endLine: number;
	endColumn: number;
};

type CatalogEntryArgs = {
	meta: FileMetadata;
	match: SearchMatch;
	range: LuaSourceRangeLike;
	expression: string;
	referenceIndex: number;
};

export function buildReferenceCatalogForExpression(options: BuildReferenceCatalogOptions): ReferenceCatalogEntry[] {
	const { workspace, info, lines, chunkName, asset_id, environment, sourceLabelPath } = options;
	const metadata = collectFileMetadata({
		workspace,
		environment,
		currentChunkName: chunkName,
		currentLines: lines,
		currentasset_id: asset_id,
		sourceLabelPath,
	});
	const entries: ReferenceCatalogEntry[] = [];
	const existingKeys: Set<string> = new Set();
	let nextIndex = 0;
	const baseMeta = metadata.get(chunkName);
	if (baseMeta) {
		for (let index = 0; index < info.matches.length; index += 1) {
			const match = info.matches[index];
			const range = matchToRange(match);
			const entry = createCatalogEntry({ meta: baseMeta, match, range, expression: info.expression, referenceIndex: nextIndex });
			appendCatalogEntry(entries, existingKeys, entry);
			nextIndex += 1;
		}
	}
	const decl = workspace.getDecl(info.definitionKey);
	if (decl) {
		const meta = metadata.get(decl.file);
		if (meta) {
			const match = rangeToSearchMatch(decl.range, meta.lines);
			if (match) {
				const entry = createCatalogEntry({ meta, match, range: toRangeLike(decl.range), expression: info.expression, referenceIndex: nextIndex });
				appendCatalogEntry(entries, existingKeys, entry);
				nextIndex += 1;
			}
		}
	}
	const references = workspace.getReferences(info.definitionKey);
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
		const entry = createCatalogEntry({ meta, match, range: toRangeLike(reference.range), expression: info.expression, referenceIndex: nextIndex });
		appendCatalogEntry(entries, existingKeys, entry);
		nextIndex += 1;
	}
	return entries;
}

export function resolveDefinitionLocationForExpression(options: ResolveDefinitionLocationOptions): ConsoleLuaDefinitionLocation | null {
	const { expression, environment, workspace, currentChunkName, currentLines, currentasset_id, sourceLabelPath } = options;
	const namePath = expression.split('.').filter(part => part.length > 0);
	if (namePath.length === 0) {
		return null;
	}
	const metadata = collectFileMetadata({
		workspace,
		environment,
		currentChunkName,
		currentLines,
		currentasset_id,
		sourceLabelPath,
	});
	let bestDecl: Decl | null = null;
	let bestMeta: FileMetadata | null = null;
	let bestScore = -Infinity;
	const files = workspace.listFiles();
	for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
		const file = files[fileIndex];
		const meta = metadata.get(file);
		const model = workspace.getModel(file);
		if (!model || !meta) {
			continue;
		}
		const decls = model.decls;
		for (let declIndex = 0; declIndex < decls.length; declIndex += 1) {
			const decl = decls[declIndex];
			if (!namePathMatches(decl.namePath, namePath)) {
				continue;
			}
			const score = declarationPriority(decl);
			if (!bestDecl || score > bestScore || (score === bestScore && isDeclarationPreferred(decl, bestDecl))) {
				bestDecl = decl;
				bestMeta = meta;
				bestScore = score;
			}
		}
	}
	if (!bestDecl || !bestMeta) {
		return null;
	}
	const range = bestDecl.range;
	const location: ConsoleLuaDefinitionLocation = {
		chunkName: bestMeta.chunkName,
		asset_id: bestMeta.asset_id,
		range: {
			startLine: range.start.line,
			startColumn: range.start.column,
			endLine: range.end.line,
			endColumn: range.end.column,
		},
	};
	if (bestMeta.path) {
		location.path = bestMeta.path;
	} else if (bestMeta.chunkName && bestMeta.chunkName !== '<console>') {
		location.path = bestMeta.chunkName;
	}
	return location;
}

export function referenceEntryKey(entry: ReferenceCatalogEntry): string {
	const location = entry.symbol.location;
	const range = location.range;
	const chunk = location.chunkName ?? '<console>';
	return `${chunk}:${range.startLine}:${range.startColumn}`;
}

export function filterReferenceCatalog(options: { catalog: readonly ReferenceCatalogEntry[]; query: string; state: ReferenceState; pageSize: number }): {
	matches: SymbolSearchResult[];
	selectionIndex: number;
	displayOffset: number;
} {
	const { catalog, query, state, pageSize } = options;
	const normalized = query.trim().toLowerCase();
	const matches: SymbolSearchResult[] = [];
	for (let index = 0; index < catalog.length; index += 1) {
		const entry = catalog[index];
		const key = entry.searchKey;
		const matchIndex = normalized.length === 0 ? 0 : key.indexOf(normalized);
		if (normalized.length === 0 || matchIndex !== -1) {
			matches.push({ entry, matchIndex: matchIndex === -1 ? Number.MAX_SAFE_INTEGER : matchIndex });
		}
	}
	if (matches.length === 0) {
		state.setActiveIndex(-1);
		return { matches: [], selectionIndex: -1, displayOffset: 0 };
	}
	sortReferenceResults(matches);
	const activeIndex = state.getActiveIndex();
	let selectionIndex = matches.length > 0 ? 0 : -1;
	if (activeIndex >= 0 && activeIndex < matches.length) {
		selectionIndex = activeIndex;
	}
	state.setActiveIndex(selectionIndex);
	let displayOffset = 0;
	if (selectionIndex >= 0) {
		displayOffset = clamp(selectionIndex - Math.floor(pageSize / 2), 0, Math.max(0, matches.length - pageSize));
		if (selectionIndex >= displayOffset + pageSize) {
			displayOffset = selectionIndex - pageSize + 1;
		}
		if (displayOffset < 0) {
			displayOffset = 0;
		}
	}
	return { matches, selectionIndex, displayOffset };
}

function collectFileMetadata(options: CollectMetadataOptions): Map<string, FileMetadata> {
	const { workspace, environment, currentChunkName, currentLines, currentasset_id, sourceLabelPath } = options;
	const metadata: Map<string, FileMetadata> = new Map();
	const register = (chunkName: string, lines: readonly string[], asset_id: string | null, path: string | null, labelHint: string | null): void => {
		if (metadata.has(chunkName)) {
			return;
		}
		const sourceLabel = computeSourceLabel(labelHint ?? path ?? asset_id ?? chunkName, chunkName);
		try {
			workspace.updateFile(chunkName, lines.join('\n'));
		} catch {
			// Ignore parse errors; we still register metadata so callers can inspect raw lines.
		}
		metadata.set(chunkName, {
			chunkName,
			lines,
			asset_id,
			path,
			sourceLabel,
		});
	};
	register(currentChunkName, currentLines, currentasset_id, null, sourceLabelPath ?? null);
	const activeContext = environment.activeContext;
	const contexts = Array.from(environment.codeTabContexts);
	for (let index = 0; index < contexts.length; index += 1) {
		const context = contexts[index];
		const descriptor = context.descriptor ?? null;
		const chunkName = resolveChunkName(descriptor, null);
		if (metadata.has(chunkName)) {
			continue;
		}
		let lines: readonly string[] | null = null;
		if (activeContext && context === activeContext) {
			lines = environment.activeLines;
		} else if (context.snapshot) {
			lines = context.snapshot.lines;
		} else {
			try {
				const source = context.load();
				lines = normalizeSourceLines(source);
			} catch {
				lines = null;
			}
		}
		if (!lines) {
			continue;
		}
		const asset_id = descriptor && descriptor.asset_id ? descriptor.asset_id : null;
		const path = descriptor && descriptor.path ? normalizePath(descriptor.path) : null;
		register(chunkName, lines, asset_id, path, null);
	}
	const descriptors = environment.listResources();
	for (let index = 0; index < descriptors.length; index += 1) {
		const descriptor = descriptors[index];
		if (!isLuaResourceDescriptor(descriptor)) {
			continue;
		}
		const chunkName = resolveChunkName(descriptor, null);
		if (metadata.has(chunkName)) {
			continue;
		}
		if (!descriptor.asset_id) {
			continue;
		}
		let lines: readonly string[] | null = null;
		try {
			const source = environment.loadLuaResource(descriptor.asset_id);
			lines = normalizeSourceLines(source);
		} catch {
			lines = null;
		}
		if (!lines) {
			continue;
		}
		register(chunkName, lines, descriptor.asset_id, normalizePath(descriptor.path ?? null), null);
	}
	return metadata;
}

function resolveChunkName(descriptor: ConsoleResourceDescriptor | null, fallback: string | null): string {
	if (descriptor) {
		if (descriptor.path && descriptor.path.length > 0) {
			return normalizePath(descriptor.path) ?? descriptor.path;
		}
		if (descriptor.asset_id && descriptor.asset_id.length > 0) {
			return descriptor.asset_id;
		}
	}
	if (fallback && fallback.length > 0) {
		return fallback;
	}
	return '<console>';
}

function normalizeSourceLines(source: string): string[] {
	return source.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
}

function normalizePath(path: string | null): string | null {
	if (!path) {
		return null;
	}
	return path.replace(/\\/g, '/');
}


function toRangeLike(range: { start: { line: number; column: number }; end: { line: number; column: number } }): LuaSourceRangeLike {
	return {
		startLine: range.start.line,
		startColumn: range.start.column,
		endLine: range.end.line,
		endColumn: range.end.column,
	};
}

function rangeToSearchMatch(range: { start: { line: number; column: number }; end: { line: number; column: number } }, lines: readonly string[]): SearchMatch | null {
	const rowIndex = range.start.line - 1;
	if (rowIndex < 0 || rowIndex >= lines.length) {
		return null;
	}
	const line = lines[rowIndex] ?? '';
	const startColumn = Math.max(0, range.start.column - 1);
	const endInclusive = Math.max(startColumn, range.end.column - 1);
	const endExclusive = Math.min(line.length, endInclusive + 1);
	const clampedStart = Math.min(startColumn, line.length);
	const clampedEnd = Math.max(clampedStart, endExclusive);
	if (clampedEnd <= clampedStart) {
		return null;
	}
	return { row: rowIndex, start: clampedStart, end: clampedEnd };
}

function buildReferenceSnippet(lines: readonly string[], match: SearchMatch): string {
	const line = lines[match.row] ?? '';
	const start = Math.max(0, match.start - 20);
	const end = Math.min(line.length, match.end + 20);
	const snippet = line.slice(start, end).trim();
	return snippet.length > 0 ? snippet : line.trim();
}

function createCatalogEntry(args: CatalogEntryArgs): ReferenceCatalogEntry {
	const { meta, match, range, expression, referenceIndex } = args;
	const snippet = buildReferenceSnippet(meta.lines, match);
	const symbolName = expression.length > 0 ? expression : snippet;
	const location: ConsoleLuaDefinitionLocation = {
		chunkName: meta.chunkName,
		asset_id: meta.asset_id,
		range: {
			startLine: range.startLine,
			startColumn: range.startColumn,
			endLine: range.endLine,
			endColumn: range.endColumn,
		},
	};
	if (meta.path) {
		location.path = meta.path;
	}
	const referenceSymbol: ReferenceSymbolEntry = {
		name: symbolName,
		path: meta.sourceLabel,
		kind: 'assignment',
		location,
		__referenceMatch: match,
		__referenceIndex: referenceIndex,
		__referenceColumn: match.start + 1,
	};
	const searchTokens: string[] = [snippet.toLowerCase()];
	if (symbolName.length > 0) {
		searchTokens.push(symbolName.toLowerCase());
	}
	if (meta.sourceLabel.length > 0) {
		searchTokens.push(meta.sourceLabel.toLowerCase());
	}
	return {
		symbol: referenceSymbol,
		displayName: snippet,
		searchKey: searchTokens.join(' ').trim(),
		line: match.row + 1,
		kindLabel: 'REF',
		sourceLabel: meta.sourceLabel,
	};
}

function appendCatalogEntry(entries: ReferenceCatalogEntry[], existingKeys: Set<string>, entry: ReferenceCatalogEntry): void {
	const key = referenceEntryKey(entry);
	if (existingKeys.has(key)) {
		return;
	}
	entries.push(entry);
	existingKeys.add(key);
}

function namePathMatches(candidate: readonly string[], desired: readonly string[]): boolean {
	if (candidate.length !== desired.length) {
		return false;
	}
	for (let index = 0; index < desired.length; index += 1) {
		if (candidate[index] !== desired[index]) {
			return false;
		}
	}
	return true;
}

function declarationPriority(decl: Decl): number {
	const isTopLevelScope = decl.scope.start.line === 1 && decl.scope.start.column === 1;
	const isRootIdentifier = decl.namePath.length === 1;
	switch (decl.kind) {
		case 'tableField':
			return 700;
		case 'function':
			return isTopLevelScope && isRootIdentifier ? 650 : 520;
		case 'parameter':
			return 400;
		case 'global':
			return isRootIdentifier ? 600 : 450;
		case 'local':
		default:
			return isTopLevelScope ? 500 : 350;
	}
}

function isDeclarationPreferred(candidate: Decl, current: Decl): boolean {
	if (candidate.range.start.line !== current.range.start.line) {
		return candidate.range.start.line < current.range.start.line;
	}
	if (candidate.range.start.column !== current.range.start.column) {
		return candidate.range.start.column < current.range.start.column;
	}
	return candidate.name.localeCompare(current.name) < 0;
}

function sortReferenceResults(matches: SymbolSearchResult[]): void {
	matches.sort((a, b) => {
		if (a.matchIndex !== b.matchIndex) {
			return a.matchIndex - b.matchIndex;
		}
		const symbolA = a.entry.symbol as ReferenceSymbolEntry;
		const symbolB = b.entry.symbol as ReferenceSymbolEntry;
		const lineDiff = symbolA.location.range.startLine - symbolB.location.range.startLine;
		if (lineDiff !== 0) {
			return lineDiff;
		}
		const columnDiff = symbolA.__referenceColumn - symbolB.__referenceColumn;
		if (columnDiff !== 0) {
			return columnDiff;
		}
		return a.entry.displayName.localeCompare(b.entry.displayName);
	});
}

function matchToRange(match: SearchMatch): LuaSourceRangeLike {
	return {
		startLine: match.row + 1,
		startColumn: match.start + 1,
		endLine: match.row + 1,
		endColumn: match.end,
	};
}
