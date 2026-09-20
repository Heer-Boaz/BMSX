import type { LuaChunk } from '../../../../toolchain/ts/lua/syntax/ast';
import type { RuntimeLuaTooling } from '../../../runtime/lua_tooling';
import type { RuntimeFaultState } from '../../../runtime/fault_state';
import { LuaLexer } from '../../../../toolchain/ts/lua/syntax/lexer';
import { clamp } from '../../../../machine/ts/common/clamp';
import {
	SuspendedGuestValueKind,
	type SuspendedGuestValue,
} from '../../../runtime/suspended_guest';
import { listLuaBuiltinDescriptors } from '../../../runtime/lua_builtins';
import type { Runtime } from '../../../../machine/ts/machine/runtime/runtime';
import { resolveRuntimeLuaSourceForContext } from '../../../runtime/sources';
import { readRuntimeLuaValue } from '../../../runtime/lua_inspection';
import type { LuaDefinitionLocation, LuaMemberCompletion, LuaSymbolEntry } from '../../../../toolchain/ts/lua/semantic_contracts';
import { ensureCursorVisible, updateDesiredColumn } from '../../ui/view/caret/caret';
import { editorCaretState } from '../../ui/view/caret/state';
import { intellisenseUiState } from './ui_state';
import { resetBlink } from '../../render/caret';
import { editorRuntimeState } from '../../common/runtime_state';
import { clearEditorPointerSelectionState } from '../../../input/pointer/state';
import { parseLuaIdentifierChain } from '../../../language/lua/identifier_chain';
import type { FileSemanticData, LuaSemanticWorkspaceSnapshot } from '../../../../toolchain/ts/lua/semantic/model';
import { getOrCreateSemanticProject } from './semantic/workspace/state';
import { semanticSymbolKindToLuaSymbolKind } from '../../../../toolchain/ts/lua/semantic/common';
import { getLuaTextContext, LuaTextContext } from '../../../common/text';
import type { EditorContextToken, LuaCompletionItem } from '../../../common/models';
import type { CodeEditorContext } from '../../ui/code_editor_state';
import {
	type ResourceDomain,
} from '../../../common/resource';
import { KEYWORDS, isLuaTrivia, LuaTokenType, type LuaToken } from '../../../../toolchain/ts/lua/syntax/token';
import type { TextBuffer } from '../../text/text_buffer';
import { activeCodeEditor } from '../../ui/code_editor_state';
import { clearSingleCursorSelection } from '../../editing/cursor/state';
import { editorViewState } from '../../ui/view/state';
import { referenceState } from '../references/state';
import { queryDefinitionsAt } from '../definitions/query';
import { definitionLocationFromSourceRange } from '../../navigation/source_range';
import { createEditorSemanticFrontend } from './frontend';
export const PREVIEW_MAX_ENTRIES = 12;
export const PREVIEW_MAX_DEPTH = 2;

const globalSymbolsCache = new WeakMap<LuaSemanticWorkspaceSnapshot, LuaSymbolEntry[]>();

export function buildMemberCompletionItems(
	bridge: RuntimeLuaTooling,
	fault: RuntimeFaultState,
	runtime: Runtime,
	chain: readonly string[],
	operator: '.' | ':',
	domain: ResourceDomain,
	analysis: FileSemanticData,
	line: number,
	column: number,
): LuaCompletionItem[] {
	const resolved = readRuntimeLuaValue(runtime, bridge.sources, fault, bridge.suspendedGuest, analysis, domain, chain, line, column);
	if (resolved.kind !== 'value' || bridge.suspendedGuest.kind(resolved.value) !== SuspendedGuestValueKind.Table) return [];
	const response = buildSuspendedGuestTableMemberCompletionEntries(bridge, resolved.value, operator);
	if (response.length === 0) {
		return [];
	}
	const items = new Array<LuaCompletionItem>(response.length);
	for (let index = 0; index < response.length; index += 1) {
		const entry = response[index];
		const kind = entry.kind === 'method' ? 'native_method' : 'native_property';
		const parameters = entry.parameters.length > 0 ? entry.parameters : undefined;
		const detail = entry.detail;
		items[index] = {
			label: entry.name,
			insertText: entry.name,
			sortKey: `${kind}:${entry.name}`,
			kind,
			detail,
			parameters,
		};
	}
	items.sort((a, b) => a.label.localeCompare(b.label));
	return items;
}

export function requestSemanticRefresh(): void {
	switch (activeCodeEditor.model.mode) {
		case 'lua':
			editorViewState.layout.requestSemanticUpdate(
				activeCodeEditor.model.buffer,
				activeCodeEditor.model.version,
				activeCodeEditor.model.resource,
			);
			return;
		case 'yaml':
		case 'aem':
			return;
	}
}
function extractIdentifierExpression(buffer: TextBuffer, row: number, column: number, path: string): { expression: string; startColumn: number; endColumn: number; } {
	if (row < 0 || row >= buffer.getLineCount()) {
		return null;
	}
	const line = buffer.getLineContent(row);
	const safeColumn = clamp(column, 0, line.length);
	if (getLuaTextContext(buffer, row, safeColumn) === LuaTextContext.Comment) {
		return null;
	}
	if (line.length === 0) {
		return null;
	}
	const tokenMatch = findContextMenuTokenMatch(row, safeColumn, path, buffer);
	if (tokenMatch && tokenMatch.token.type === LuaTokenType.String) {
		return null;
	}
	const clampedColumn = clamp(column, 0, line.length - 1);
	let probe = clampedColumn;
	if (!LuaLexer.isIdentifierPart(line.charAt(probe))) {
		if (isIdentifierChainSeparator(line.charCodeAt(probe)) && probe > 0) {
			probe -= 1;
		}
		else if (probe > 0 && LuaLexer.isIdentifierPart(line.charAt(probe - 1))) {
			probe -= 1;
		}
		else {
			return null;
		}
	}
	let expressionStart = probe;
	while (expressionStart > 0 && LuaLexer.isIdentifierPart(line.charAt(expressionStart - 1))) {
		expressionStart -= 1;
	}
	if (!LuaLexer.isIdentifierStart(line.charAt(expressionStart))) {
		return null;
	}
	let expressionEnd = probe + 1;
	while (expressionEnd < line.length && LuaLexer.isIdentifierPart(line.charAt(expressionEnd))) {
		expressionEnd += 1;
	}
	// extend to include preceding segments (left of initial segment)
	let left = expressionStart;
	while (left > 0) {
		const separatorIndex = left - 1;
		if (!isIdentifierChainSeparator(line.charCodeAt(separatorIndex))) {
			break;
		}
		let segmentStart = separatorIndex - 1;
		while (segmentStart >= 0 && LuaLexer.isIdentifierPart(line.charAt(segmentStart))) {
			segmentStart -= 1;
		}
		segmentStart += 1;
		if (segmentStart >= separatorIndex) {
			break;
		}
		if (!LuaLexer.isIdentifierStart(line.charAt(segmentStart))) {
			break;
		}
		left = segmentStart;
	}
	expressionStart = left;
	let right = expressionEnd;
	while (right < line.length) {
		if (!isIdentifierChainSeparator(line.charCodeAt(right))) {
			break;
		}
		const identifierStart = right + 1;
		if (identifierStart >= line.length) {
			break;
		}
		if (!LuaLexer.isIdentifierStart(line.charAt(identifierStart))) {
			break;
		}
		let identifierEnd = identifierStart + 1;
		while (identifierEnd < line.length && LuaLexer.isIdentifierPart(line.charAt(identifierEnd))) {
			identifierEnd += 1;
		}
		right = identifierEnd;
	}
	expressionEnd = right;
	if (expressionEnd <= expressionStart) {
		return null;
	}
	const segments: Array<{ text: string; start: number; end: number; }> = [];
	let segmentStart = expressionStart;
	while (segmentStart < expressionEnd) {
		let segmentEnd = segmentStart;
		while (segmentEnd < expressionEnd && !isIdentifierChainSeparator(line.charCodeAt(segmentEnd))) {
			segmentEnd += 1;
		}
		if (segmentEnd > segmentStart) {
			segments.push({ text: line.slice(segmentStart, segmentEnd), start: segmentStart, end: segmentEnd });
		}
		segmentStart = segmentEnd + 1;
	}
	if (segments.length === 0) {
		return null;
	}
	let pointerColumn = Math.min(column, expressionEnd - 1);
	if (pointerColumn < expressionStart) {
		pointerColumn = expressionStart;
	}
	if (isIdentifierChainSeparator(line.charCodeAt(pointerColumn)) && pointerColumn > expressionStart) {
		pointerColumn -= 1;
	}
	let segmentIndex = -1;
	for (let i = 0; i < segments.length; i += 1) {
		const seg = segments[i];
		if (pointerColumn >= seg.start && pointerColumn < seg.end) {
			segmentIndex = i;
			break;
		}
	}
	if (segmentIndex === -1) {
		segmentIndex = segments.length - 1;
	}
	const targetSegment = segments[segmentIndex];
	const expression = line.slice(expressionStart, targetSegment.end);
	if (expression.length === 0) {
		return null;
	}
	return { expression, startColumn: targetSegment.start, endColumn: targetSegment.end };
}

function isIdentifierChainSeparator(value: number): boolean {
	return value === 46 || value === 58;
}

function isKeywordTokenType(type: LuaTokenType): boolean {
	return (type >= LuaTokenType.And && type <= LuaTokenType.While)
		|| type === LuaTokenType.HaltUntilIrq;
}

function resolveContextMenuTokenKind(type: LuaTokenType): EditorContextToken['kind'] {
	if (type === LuaTokenType.Identifier) {
		return 'identifier';
	}
	if (type === LuaTokenType.Number) {
		return 'number';
	}
	if (type === LuaTokenType.String) {
		return 'string';
	}
	if (isKeywordTokenType(type)) {
		return 'keyword';
	}
	return 'operator';
}

type ContextMenuTokenMatch = {
	token: LuaToken;
	index: number;
	startColumn: number;
	endColumn: number;
	chunk: LuaChunk;
};

function findContextMenuTokenMatch(row: number, column: number, path: string, buffer: TextBuffer): ContextMenuTokenMatch {
	const chunk = getOrCreateSemanticProject(activeCodeEditor.model.resource.domain)
		.analyzeDocument(path, buffer).chunk;
	const { tokens, locations } = chunk;
	const targetLine = row + 1;
	let adjacent: ContextMenuTokenMatch = null;
	for (const cursor = tokens.cursor(); cursor.token !== undefined; cursor.advance()) {
		const token = cursor.token;
		const index = cursor.index;
		if (isLuaTrivia(token.type)) continue;
		const position = locations.range(token).start;
		if (token.type === LuaTokenType.Eof) {
			break;
		}
		if (position.line < targetLine) {
			continue;
		}
		if (position.line > targetLine) {
			break;
		}
		const tokenLength = token.lexeme.length;
		if (tokenLength === 0) {
			continue;
		}
		const tokenStart = position.column - 1;
		const tokenEnd = tokenStart + tokenLength;
		if (column >= tokenStart && column < tokenEnd) {
			return {
				token,
				index,
				startColumn: tokenStart,
				endColumn: tokenEnd,
				chunk,
			};
		}
		if (column === tokenEnd) {
			adjacent = {
				token,
				index,
				startColumn: tokenStart,
				endColumn: tokenEnd,
				chunk,
			};
			continue;
		}
		if (column < tokenStart) {
			break;
		}
	}
	return adjacent;
}

function resolveIdentifierExpressionForKeyword(row: number, match: ContextMenuTokenMatch, path: string): { expression: string; startColumn: number; endColumn: number; } {
	if (match.token.type !== LuaTokenType.Local && match.token.type !== LuaTokenType.Function) {
		return null;
	}
	const targetLine = row + 1;
	const { tokens, locations } = match.chunk;
	for (const cursor = tokens.cursor(match.index + 1); cursor.token !== undefined; cursor.advance()) {
		const token = cursor.token;
		if (isLuaTrivia(token.type)) continue;
		const position = locations.range(token).start;
		if (token.type === LuaTokenType.Eof || position.line !== targetLine) {
			break;
		}
		if (token.type !== LuaTokenType.Identifier) {
			continue;
		}
		return extractIdentifierExpression(activeCodeEditor.model.buffer, row, position.column - 1, path);
	}
	return null;
}

function buildContextMenuToken(
	row: number,
	column: number,
	startColumn: number,
	endColumn: number,
	text: string,
	kind: EditorContextToken['kind'],
	expression: string
): EditorContextToken {
	return {
		kind,
		text,
		expression,
		row,
		column,
		startColumn,
		endColumn,
	};
}

export function resolveContextMenuToken(row: number, column: number, path: string): EditorContextToken {
	const buffer = activeCodeEditor.model.buffer;
	if (row < 0 || row >= buffer.getLineCount()) {
		return null;
	}
	const line = buffer.getLineContent(row);
	if (line.length === 0) {
		return null;
	}
	const safeColumn = clamp(column, 0, line.length);
	if (getLuaTextContext(buffer, row, safeColumn) === LuaTextContext.Comment) {
		return null;
	}
	const expression = extractIdentifierExpression(buffer, row, safeColumn, path);
	if (expression) {
		const segmentText = line.slice(expression.startColumn, expression.endColumn);
		const isKeyword = KEYWORDS.has(segmentText);
		if (!isKeyword) {
			return buildContextMenuToken(
				row,
				safeColumn,
				expression.startColumn,
				expression.endColumn,
				segmentText.length > 0 ? segmentText : expression.expression,
				'identifier',
				expression.expression,
			);
		}
	}
	const match = findContextMenuTokenMatch(row, safeColumn, path, buffer);
	if (!match) {
		return null;
	}
	const keywordExpression = resolveIdentifierExpressionForKeyword(row, match, path);
	if (keywordExpression) {
		const keywordText = line.slice(keywordExpression.startColumn, keywordExpression.endColumn);
		return buildContextMenuToken(
			row,
			safeColumn,
			keywordExpression.startColumn,
			keywordExpression.endColumn,
			keywordText.length > 0 ? keywordText : keywordExpression.expression,
			'identifier',
			keywordExpression.expression,
		);
	}
	const tokenStart = clamp(match.startColumn, 0, line.length);
	const tokenEnd = clamp(match.endColumn, tokenStart, line.length);
	if (tokenEnd <= tokenStart) {
		return null;
	}
	const tokenText = line.slice(tokenStart, tokenEnd);
	const kind = resolveContextMenuTokenKind(match.token.type);
	if (kind === 'keyword') {
		return null;
	}
	return buildContextMenuToken(
		row,
		safeColumn,
		tokenStart,
		tokenEnd,
		tokenText,
		kind,
		kind === 'identifier' ? tokenText : null,
	);
}

export function refreshGotoHoverHighlight(
	bridge: RuntimeLuaTooling,
	row: number,
	column: number,
	context: CodeEditorContext,
): void {
	switch (context.model.mode) {
		case 'lua':
			break;
		case 'yaml':
		case 'aem':
			clearGotoHoverHighlight();
			return;
	}
	const query = queryDefinitionsAt(bridge, context, row, column);
	if (!query) {
		clearGotoHoverHighlight();
		return;
	}
	const highlightStart = query.origin.start.column - 1;
	const highlightEnd = query.origin.end.column;
	const existing = intellisenseUiState.gotoHoverHighlight;
	if (existing
		&& existing.row === row
		&& column >= existing.startColumn
		&& column <= existing.endColumn
		&& existing.expression === query.label) {
		return;
	}
	intellisenseUiState.gotoHoverHighlight = {
		row,
		startColumn: highlightStart,
		endColumn: highlightEnd,
		expression: query.label,
	};
}

export function clearGotoHoverHighlight(): void {
	intellisenseUiState.gotoHoverHighlight = null;
}

export function clearReferenceHighlights(): void {
	referenceState.clear();
}

export type LuaRuntimeInspection = {
	readonly expression: string;
	readonly lines: readonly string[];
	readonly valueType: string;
	readonly state: 'value' | 'unavailable';
};

export function inspectLuaRuntimeExpression(
	bridge: RuntimeLuaTooling,
	fault: RuntimeFaultState,
	runtime: Runtime,
	expression: string,
	domain: ResourceDomain,
	analysis: FileSemanticData,
	line: number,
	column: number,
): LuaRuntimeInspection | null {
	const chain = parseLuaIdentifierChain(expression);
	if (chain === null) return null;
	const resolved = readRuntimeLuaValue(runtime, bridge.sources, fault, bridge.suspendedGuest, analysis, domain, chain, line, column);
	if (resolved.kind === 'unavailable') {
		return { expression, lines: [RUNTIME_UNAVAILABLE_LABELS[resolved.reason]], valueType: 'unknown', state: 'unavailable' };
	}
	const formatted = describeSuspendedGuestValueForInspector(bridge, resolved.value);
	return { expression, lines: formatted.lines, valueType: formatted.valueType, state: 'value' };
}

const RUNTIME_UNAVAILABLE_LABELS = {
	source_changed: 'unavailable: source differs from installed code',
	not_loaded: 'unavailable: not loaded',
	not_in_scope: 'unavailable in the suspended stack',
	not_a_table: 'unavailable: member parent is not a table',
} as const;

export function listLuaSymbols(bridge: RuntimeLuaTooling, domain: ResourceDomain, path: string): LuaSymbolEntry[] {
	const source = resolveRuntimeLuaSourceForContext(bridge.sources, domain, path);
	if (!source) {
		return [];
	}
	const project = getOrCreateSemanticProject(domain);
	project.synchronizeRuntimeSources(bridge.sources);
	const analysis = project.getFileData(source.record.source_path);
	if (!analysis) {
		return [];
	}
	const declarations = analysis.decls;
	const symbols = new Array<LuaSymbolEntry>(declarations.length);
	for (let index = 0; index < declarations.length; index += 1) {
		const declaration = declarations[index];
		const location = definitionLocationFromSourceRange(analysis.chunk.locations.range(declaration.span));
		symbols[index] = {
			name: declaration.name,
			path: declaration.namePath.length > 0
				? declaration.namePath.join('.')
				: declaration.name,
			kind: semanticSymbolKindToLuaSymbolKind(declaration.kind),
			location,
		};
	}
	symbols.sort((a, b) => {
		const aLine = a.location.range.startLine;
		const bLine = b.location.range.startLine;
		if (aLine !== bLine) {
			return aLine - bLine;
		}
		return a.path.localeCompare(b.path);
	});
	return symbols;
}

export function listGlobalLuaSymbols(bridge: RuntimeLuaTooling, domain: ResourceDomain): LuaSymbolEntry[] {
	const project = getOrCreateSemanticProject(domain);
	project.synchronizeRuntimeSources(bridge.sources);
	const snapshot = project.getSnapshot();
	const cached = globalSymbolsCache.get(snapshot);
	if (cached) {
		return cached;
	}
	const entries: LuaSymbolEntry[] = [];
	const decls = snapshot.listGlobalDecls();
	for (let index = 0; index < decls.length; index += 1) {
		const decl = decls[index];
		const path = decl.namePath.length > 0 ? decl.namePath.join('.') : decl.name;
		entries.push({
			name: decl.name,
			path,
			kind: semanticSymbolKindToLuaSymbolKind(decl.kind),
			location: definitionLocationFromSourceRange(snapshot.getFileData(decl.file)!.chunk.locations.range(decl.span)),
		});
	}
	entries.sort((a, b) => {
		const pathA = a.location.path;
		const pathB = b.location.path;
		if (pathA !== pathB) {
			return pathA.localeCompare(pathB);
		}
		const lineA = a.location.range.startLine;
		const lineB = b.location.range.startLine;
		if (lineA !== lineB) {
			return lineA - lineB;
		}
		return a.path.localeCompare(b.path);
	});
	globalSymbolsCache.set(snapshot, entries);
	return entries;
}

export function findStaticDefinitionLocation(
	bridge: RuntimeLuaTooling,
	usageRow: number,
	usageColumn: number,
	path: string,
	activeContext: CodeEditorContext,
): LuaDefinitionLocation {
	const source = resolveRuntimeLuaSourceForContext(
		bridge.sources,
		activeContext.model.resource.domain,
		path,
	);
	if (!source) {
		return null;
	}
	const sourcePath = source.record.source_path;
	const project = getOrCreateSemanticProject(activeContext.model.resource.domain);
	project.synchronizeRuntimeSources(bridge.sources);
	if (activeContext.model.resource.path === sourcePath) {
		project.analyzeDocument(sourcePath, activeContext.model.buffer);
	}
	const frontend = createEditorSemanticFrontend(bridge, project.getSnapshot());
	const symbols = frontend.findSymbolsByPosition(sourcePath, usageRow, usageColumn);
	return symbols && symbols.targets.length === 1
		? definitionLocationFromSourceRange(symbols.targets[0].range)
		: null;
}

function describeSuspendedGuestValueForInspector(
	bridge: RuntimeLuaTooling,
	value: SuspendedGuestValue,
): { lines: string[]; valueType: string } {
	const inspection = bridge.suspendedGuest;
	switch (inspection.kind(value)) {
		case SuspendedGuestValueKind.Nil:
			return { lines: ['Nil'], valueType: 'nil' };
		case SuspendedGuestValueKind.Boolean:
			return {
				lines: [inspection.formatValue(value)],
				valueType: 'boolean',
			};
		case SuspendedGuestValueKind.Number:
			return {
				lines: [inspection.formatValue(value)],
				valueType: 'number',
			};
		case SuspendedGuestValueKind.String:
			return {
				lines: [JSON.stringify(inspection.formatValue(value))],
				valueType: 'string',
			};
		case SuspendedGuestValueKind.Table:
			return {
				lines: [
					'<table>',
					bridge.suspendedGuest.previewValue(
						value,
						PREVIEW_MAX_DEPTH,
						PREVIEW_MAX_ENTRIES,
					),
				],
				valueType: 'table',
			};
		case SuspendedGuestValueKind.Function:
			return { lines: ['<function>'], valueType: 'function' };
	}
}

function registerTableMemberCompletion(
	registry: Map<string, LuaMemberCompletion>,
	key: string,
	isFunction: boolean,
	operator: '.' | ':',
): void {
	if (key.length === 0 || key === '__index' || key === '__metatable') {
		return;
	}
	if (operator === ':' && !isFunction) {
		return;
	}
	if (registry.has(key)) {
		return;
	}
	const kind: 'method' | 'property' = isFunction ? 'method' : 'property';
	const detail = isFunction ? `function ${key}` : `table field '${key}'`;
	registry.set(key, { name: key, kind, detail, parameters: [] });
}

function sortedTableMemberCompletions(
	registry: Map<string, LuaMemberCompletion>,
): LuaMemberCompletion[] {
	const results = Array.from(registry.values());
	results.sort((a, b) => a.name.localeCompare(b.name));
	return results;
}

function buildSuspendedGuestTableMemberCompletionEntries(
	bridge: RuntimeLuaTooling,
	table: SuspendedGuestValue,
	operator: '.' | ':',
): LuaMemberCompletion[] {
	const registry = new Map<string, LuaMemberCompletion>();
	bridge.suspendedGuest.visitTableStringMembers(
		table,
		(key, entryValue) => {
			registerTableMemberCompletion(
				registry,
				key,
				bridge.suspendedGuest.kind(entryValue) === SuspendedGuestValueKind.Function,
				operator,
			);
		},
	);
	return sortedTableMemberCompletions(registry);
}

let builtinIdentifierEpoch = 0;

export function getBuiltinIdentifiersSnapshot(): { epoch: number; ids: ReadonlySet<string> } {
	const cached = editorRuntimeState.builtinIdentifierCache;
	if (cached && cached.caseInsensitive === editorRuntimeState.caseInsensitive) {
		return cached;
	}
	const descriptors = listLuaBuiltinDescriptors();
	const names: string[] = [];
	for (let index = 0; index < descriptors.length; index += 1) {
		names.push(descriptors[index].name);
	}
	names.sort((a, b) => a.localeCompare(b));
	const ids = new Set<string>();
	for (let i = 0; i < names.length; i += 1) {
		const name = names[i];
		ids.add(name);
	}
	builtinIdentifierEpoch += 1;
	const entry = {
		epoch: builtinIdentifierEpoch,
		ids,
		caseInsensitive: editorRuntimeState.caseInsensitive,
	};
	editorRuntimeState.builtinIdentifierCache = entry;
	return entry;
}

export function applyDefinitionSelection(range: LuaDefinitionLocation['range']): void {
	const lastRowIndex = activeCodeEditor.model.buffer.getLineCount() - 1;
	const startRow = clamp(range.startLine - 1, 0, lastRowIndex);
	const startLine = activeCodeEditor.model.buffer.getLineContent(startRow);
	const startColumn = clamp(range.startColumn - 1, 0, startLine.length);
	activeCodeEditor.view.cursorRow = startRow;
	activeCodeEditor.view.cursorColumn = startColumn;
	clearSingleCursorSelection(activeCodeEditor.view);
	clearEditorPointerSelectionState();
	updateDesiredColumn();
	resetBlink();
	editorCaretState.cursorRevealSuspended = false;
	ensureCursorVisible();
	activeCodeEditor.emitCursorMoved();
}
