import type { ReferenceMatchInfo, ReferenceState } from './reference_navigation';
import type { SymbolCatalogEntry, SymbolSearchResult, SearchMatch } from './types';
import type { ConsoleLuaDefinitionLocation, ConsoleLuaSymbolEntry } from '../types';
import type { LuaSemanticModel } from './semantic_model';
import type { LuaDefinitionInfo, LuaSourceRange } from '../../lua/ast.ts';

export type ReferenceSymbolEntry = ConsoleLuaSymbolEntry & {
	__referenceMatch: SearchMatch;
	__referenceIndex: number;
	__referenceColumn: number;
};

export type ReferenceCatalogEntry = SymbolCatalogEntry & {
	symbol: ReferenceSymbolEntry;
};

export type ReferenceProjectSource = {
	semanticModel: LuaSemanticModel | null;
	identifierPositions: Set<string>;
	chunkName: string;
	assetId: string | null;
	path: string | null;
	sourceLabel: string | null;
	lines: readonly string[];
};

type BuildCatalogOptions = {
	info: ReferenceMatchInfo;
	lines: readonly string[];
	chunkName: string;
	assetId: string | null;
	path: string | null;
	sourceLabel: string | null;
};

export function buildReferenceCatalog(options: BuildCatalogOptions): ReferenceCatalogEntry[] {
	const { info, lines, chunkName, assetId, path, sourceLabel } = options;
	const entries: ReferenceCatalogEntry[] = [];
	const expressionLabel = info.expression ?? '';
	for (let index = 0; index < info.matches.length; index += 1) {
		const match = info.matches[index];
		const snippet = buildReferenceSnippet(lines, match);
		const location: ConsoleLuaDefinitionLocation = {
			chunkName,
			assetId,
			path: path ?? undefined,
			range: {
				startLine: match.row + 1,
				startColumn: match.start + 1,
				endLine: match.row + 1,
				endColumn: match.end,
			},
		};
		const symbolName = expressionLabel.length > 0 ? expressionLabel : snippet;
		const referenceSymbol: ReferenceSymbolEntry = {
			name: symbolName,
			path: sourceLabel ?? chunkName,
			kind: 'assignment',
			location,
			__referenceMatch: match,
			__referenceIndex: index,
			__referenceColumn: match.start + 1,
		};
		const searchTokens: string[] = [snippet.toLowerCase()];
		if (symbolName.length > 0) {
			searchTokens.push(symbolName.toLowerCase());
		}
		if (sourceLabel) {
			searchTokens.push(sourceLabel.toLowerCase());
		}
		if (info.expression) {
			searchTokens.push(info.expression.toLowerCase());
		}
		const entry: ReferenceCatalogEntry = {
			symbol: referenceSymbol,
			displayName: snippet,
			searchKey: searchTokens.join(' ').trim(),
			line: match.row + 1,
			kindLabel: 'REF',
			sourceLabel: sourceLabel ?? null,
		};
		entries.push(entry);
	}
	return entries;
}

type FilterCatalogOptions = {
	catalog: readonly ReferenceCatalogEntry[];
	query: string;
	state: ReferenceState;
	pageSize: number;
};

export function filterReferenceCatalog(options: FilterCatalogOptions): {
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
			matches.push({
				entry,
				matchIndex: matchIndex === -1 ? Number.MAX_SAFE_INTEGER : matchIndex,
			});
		}
	}
	if (matches.length === 0) {
		state.setActiveIndex(-1);
		return { matches: [], selectionIndex: -1, displayOffset: 0 };
	}
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

export function referenceEntryKey(entry: ReferenceCatalogEntry): string {
	const location = entry.symbol.location;
	const range = location.range;
	const chunk = location.chunkName ?? '<console>';
	return `${chunk}:${range.startLine}:${range.startColumn}`;
}

type CatalogSourcesOptions = {
	expression: string;
	sources: readonly ReferenceProjectSource[];
	definitionKey: string;
	existingKeys?: Set<string>;
};

export function buildReferenceCatalogForSources(options: CatalogSourcesOptions): ReferenceCatalogEntry[] {
	const { expression, sources, definitionKey, existingKeys } = options;
	if (!expression || sources.length === 0) {
		return [];
	}
	const namePath = expression.split('.').filter(part => part.length > 0);
	const lastSegment = namePath.length > 0 ? namePath[namePath.length - 1] : expression;
	const aggregated: ReferenceCatalogEntry[] = [];
	for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
		const source = sources[sourceIndex];
		const matches = findExpressionMatches(expression, source.lines);
		const filteredMatches = filterMatchesByDefinition(matches, source, namePath, lastSegment, definitionKey);
		if (filteredMatches.length === 0) {
			continue;
		}
		const info: ReferenceMatchInfo = {
			matches: filteredMatches,
			expression,
			definitionKey,
			documentVersion: -1,
		};
		const entries = buildReferenceCatalog({
			info,
			lines: source.lines,
			chunkName: source.chunkName,
			assetId: source.assetId,
			path: source.path,
			sourceLabel: source.sourceLabel,
		});
		for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
			const entry = entries[entryIndex];
			const key = referenceEntryKey(entry);
			if (existingKeys && existingKeys.has(key)) {
				continue;
			}
			aggregated.push(entry);
			if (existingKeys) {
				existingKeys.add(key);
			}
		}
	}
	return aggregated;
}

function buildReferenceSnippet(lines: readonly string[], match: SearchMatch): string {
	const line = lines[match.row] ?? '';
	if (!line) {
		return '<empty line>';
	}
	const windowSize = 48;
	const startWindow = Math.max(0, match.start - windowSize);
	const endWindow = Math.min(line.length, match.end + windowSize);
	const before = line.slice(startWindow, match.start).trimStart();
	const target = line.slice(match.start, match.end);
	const after = line.slice(match.end, endWindow).trimEnd();
	let snippet = `${before}${target}${after}`.replace(/\s+/g, ' ').trim();
	if (startWindow > 0) {
		snippet = `…${snippet}`;
	}
	if (endWindow < line.length) {
		snippet = `${snippet}…`;
	}
	if (snippet.length === 0) {
		return target.length > 0 ? target : '<empty reference>';
	}
	const maxLength = 160;
	if (snippet.length > maxLength) {
		snippet = `${snippet.slice(0, maxLength - 1)}…`;
	}
	return snippet;
}

function clamp(value: number, min: number, max: number): number {
	if (value < min) {
		return min;
	}
	if (value > max) {
		return max;
	}
	return value;
}

export function findExpressionMatches(expression: string, lines: readonly string[]): SearchMatch[] {
	if (!expression || lines.length === 0) {
		return [];
	}
	const normalizedExpression = expression.toLowerCase();
	const expressionLength = expression.length;
	const matches: SearchMatch[] = [];
	for (let row = 0; row < lines.length; row += 1) {
		const line = lines[row] ?? '';
		if (!line) {
			continue;
		}
		const normalizedLine = line.toLowerCase();
		let cursor = 0;
		while (cursor <= line.length - expressionLength) {
			const index = normalizedLine.indexOf(normalizedExpression, cursor);
			if (index === -1) {
				break;
			}
			const start = index;
			const end = index + expressionLength;
			const beforeChar = start > 0 ? line.charAt(start - 1) : '';
			const afterChar = end < line.length ? line.charAt(end) : '';
			const validBefore = start === 0 || (!isIdentifierChar(beforeChar) && beforeChar !== '.' && beforeChar !== ':');
			const validAfter = end >= line.length || (!isIdentifierChar(afterChar) && afterChar !== '.' && afterChar !== ':');
			if (validBefore && validAfter) {
				matches.push({ row, start, end });
			}
			cursor = index + 1;
		}
	}
	return matches;
}

function isIdentifierChar(ch: string): boolean {
	if (!ch) {
		return false;
	}
	const code = ch.charCodeAt(0);
	return (code >= 65 && code <= 90) // A-Z
		|| (code >= 97 && code <= 122) // a-z
		|| (code >= 48 && code <= 57) // 0-9
		|| code === 95; // _
}

function filterMatchesByDefinition(
	matches: readonly SearchMatch[],
	source: ReferenceProjectSource,
	namePath: readonly string[],
	lastSegment: string,
	definitionKey: string
): SearchMatch[] {
	const model = source.semanticModel;
	if (!model || namePath.length === 0) {
		return [];
	}
	const filtered: SearchMatch[] = [];
	for (let index = 0; index < matches.length; index += 1) {
		const match = matches[index];
		const segmentStart = match.end - lastSegment.length;
		const column = Math.max(1, segmentStart + 1);
		const row = match.row + 1;
		const definition = model.lookupIdentifier(row, column, namePath);
		if (definition) {
			if (definitionKeyFromDefinition(definition) === definitionKey) {
				filtered.push(match);
			}
			continue;
		}
		if (isDefinitionToken(row, column, model.definitions, namePath)) {
			continue;
		}
		if (!isGlobalReferenceCandidate(source, row, column, namePath)) {
			continue;
		}
		if (namePath.length === 1) {
			filtered.push(match);
		}
	}
	return filtered;
}

function isGlobalReferenceCandidate(
	source: ReferenceProjectSource,
	row: number,
	column: number,
	namePath: readonly string[]
): boolean {
	if (namePath.length !== 1) {
		return false;
	}
	const model = source.semanticModel;
	if (!model) {
		return false;
	}
	const line = source.lines[row - 1] ?? '';
	if (!line) {
		return false;
	}
	const columnIndex = column - 1;
	if (!source.identifierPositions.has(`${row}:${column}`)) {
		return false;
	}
	if (isInComment(line, columnIndex) || isInStringLiteral(line, columnIndex)) {
		return false;
	}
	if (hasCoveringDefinition(model.definitions, row, column, namePath)) {
		return false;
	}
	return true;
}

function isInComment(line: string, columnIndex: number): boolean {
	const commentIndex = line.indexOf('--');
	return commentIndex !== -1 && commentIndex <= columnIndex;
}

function isInStringLiteral(line: string, columnIndex: number): boolean {
	let inSingle = false;
	let inDouble = false;
	for (let index = 0; index < columnIndex; index += 1) {
		const ch = line.charAt(index);
		if (ch === '\'' && !inDouble) {
			if (!isEscaped(line, index)) {
				inSingle = !inSingle;
			}
			continue;
		}
		if (ch === '"' && !inSingle) {
			if (!isEscaped(line, index)) {
				inDouble = !inDouble;
			}
		}
	}
	return inSingle || inDouble;
}

function isEscaped(line: string, index: number): boolean {
	let backslashCount = 0;
	for (let scan = index - 1; scan >= 0 && line.charAt(scan) === '\\'; scan -= 1) {
		backslashCount += 1;
	}
	return (backslashCount & 1) === 1;
}

function hasCoveringDefinition(
	definitions: readonly LuaDefinitionInfo[],
	row: number,
	column: number,
	namePath: readonly string[]
): boolean {
	for (let index = 0; index < definitions.length; index += 1) {
		const definition = definitions[index];
		if (!definitionMatchesNamePath(definition, namePath)) {
			continue;
		}
		if (positionWithinRange(row, column, definition.scope)) {
			return true;
		}
	}
	return false;
}

function isDefinitionToken(
	row: number,
	column: number,
	definitions: readonly LuaDefinitionInfo[],
	namePath: readonly string[],
): boolean {
	for (let index = 0; index < definitions.length; index += 1) {
		const definition = definitions[index];
		if (!definitionMatchesNamePath(definition, namePath)) {
			continue;
		}
		const range = definition.definition;
		if (row !== range.start.line) {
			continue;
		}
		if (column < range.start.column || column > range.end.column) {
			continue;
		}
		return true;
	}
	return false;
}

function definitionMatchesNamePath(definition: LuaDefinitionInfo, namePath: readonly string[]): boolean {
	if (definition.namePath.length !== namePath.length) {
		return false;
	}
	for (let index = 0; index < namePath.length; index += 1) {
		if (definition.namePath[index] !== namePath[index]) {
			return false;
		}
	}
	return true;
}

export function definitionKeyFromDefinition(definition: LuaDefinitionInfo): string {
	const path = definition.namePath.join('.');
	return `${definition.definition.start.line}:${definition.definition.start.column}:${definition.definition.end.line}:${definition.definition.end.column}:${definition.kind}:${path}`;
}

function positionWithinRange(row: number, column: number, range: LuaSourceRange): boolean {
	if (row < range.start.line || row > range.end.line) {
		return false;
	}
	if (row === range.start.line && column < range.start.column) {
		return false;
	}
	if (row === range.end.line && column > range.end.column) {
		return false;
	}
	return true;
}
