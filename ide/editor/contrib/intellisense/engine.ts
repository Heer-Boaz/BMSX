import type { RuntimeLuaTooling } from '../../../runtime/lua_tooling';
import type { RuntimeFaultState } from '../../../runtime/fault_state';
import type { LuaSourceRange } from '../../../../toolchain/ts/lua/syntax/ast/index';
import { LuaEnvironment } from '../../../language/lua/interpreter/environment';
import { LuaLexer } from '../../../../toolchain/ts/lua/syntax/lexer';
import { clamp } from '../../../../machine/ts/common/clamp';
import { getCachedLuaParse } from '../../../../toolchain/ts/lua/analysis/cache';
import { LuaInterpreter } from '../../../language/lua/interpreter/interpreter';
import { extractErrorMessage, isLuaFunctionValue, isLuaTable, LuaFunctionValue, LuaNativeValue, LuaTable, LuaValue, resolveNativeTypeName } from '../../../language/lua/interpreter/value';
import { blua32FunctionIndexAtAddress } from '../../../../toolchain/ts/rompack/blua32_image';
import {
	SuspendedGuestValueKind,
	type SuspendedGuestValue,
} from '../../../runtime/suspended_guest';
import {
	blua32InlineCallSitesAtPc,
	blua32SourceRangeAtPc,
	type Blua32LocalSlotDebug,
} from '../../../../toolchain/ts/rompack/blua32_symbols';
import type { SourceRange } from '../../../../toolchain/ts/lua/source_range';
import { resolveInlineLocalContextRange } from '../../../../toolchain/ts/lua/compiler/inline_debug';
import { DEFAULT_LUA_BUILTIN_NAMES } from '../../../../toolchain/ts/lua/builtin_descriptors';
import { listLuaBuiltinDescriptors, luaBuiltinMetadata } from '../../../runtime/lua_builtins';
import type { Runtime } from '../../../../machine/ts/machine/runtime/runtime';
import {
	blua32ToolingImageForDomain,
	type Blua32ToolingImage,
} from '../../../../toolchain/ts/rompack/blua32_media';
import {
	Blua32GlobalRegisterFile,
	resolveRuntimeLuaSourceForContext,
} from '../../../runtime/sources';
import type { LuaDefinitionLocation, LuaHoverResult, LuaHoverScope, LuaMemberCompletion, LuaSymbolEntry } from '../../../../toolchain/ts/lua/semantic_contracts';
import { ensureCursorVisible, updateDesiredColumn } from '../../ui/view/caret/caret';
import { editorCaretState } from '../../ui/view/caret/state';
import { intellisenseUiState } from './ui_state';
import { resetBlink } from '../../render/caret';
import { resolvePointerTextPosition } from '../../ui/view/view';
import type { CodeAreaBounds } from '../../ui/view/view';
import * as constants from '../../../common/constants';
import { editorRuntimeState } from '../../common/runtime_state';
import { clearEditorPointerSelectionState } from '../../../input/pointer/state';
import { parseLuaIdentifierChain } from '../../../language/lua/identifier_chain';
import type { LuaSemanticWorkspaceSnapshot } from '../../../../toolchain/ts/lua/semantic/model';
import { getOrCreateSemanticProject } from './semantic/workspace/state';
import { semanticSymbolKindToLuaSymbolKind } from '../../../../toolchain/ts/lua/semantic/common';
import { isLuaCommentContext } from '../../../common/text';
import { writeWrappedOverlayLine } from '../../common/text/layout';
import type { EditorContextToken, LuaCompletionItem, PointerSnapshot } from '../../../common/models';
import type { EditorDocumentContext } from '../../editing/document_state';
import {
	SYSTEM_RESOURCE_DOMAIN,
	type ResourceDomain,
} from '../../../common/resource';
import { KEYWORDS, LuaTokenType, type LuaToken } from '../../../../toolchain/ts/lua/syntax/token';
import { getTextSnapshot } from '../../text/source_text';
import type { TextBuffer } from '../../text/text_buffer';
import { editorDocumentState } from '../../editing/document_state';
import { clearSingleCursorSelection } from '../../editing/cursor/state';
import { editorViewState } from '../../ui/view/state';
import { referenceState } from '../references/state';
import { queryDefinitionsAt } from '../definitions/query';
import { definitionLocationFromSourceRange } from '../../navigation/source_range';
import { createEditorSemanticFrontend } from './frontend';
export const PREVIEW_MAX_ENTRIES = 12;
export const PREVIEW_MAX_DEPTH = 2;

type ResolvedIntellisenseValue =
	| {
		readonly source: 'runtime';
		readonly value: SuspendedGuestValue;
	}
	| {
		readonly source: 'interpreter';
		readonly value: LuaValue;
	};

let nativeMemberCompletionCache: WeakMap<object, { dot?: LuaMemberCompletion[]; colon?: LuaMemberCompletion[] }> = new WeakMap();

function isHiddenNativeMemberName(name: string): boolean {
	switch (name) {
		case '':
		case 'constructor':
		// disable-next-line legacy_sentinel_string_pattern -- JavaScript intrinsic native member, not a legacy BMSX sentinel key.
		case '__proto__':
		case 'prototype':
		case 'caller':
		case 'callee':
			return true;
		default:
			return false;
	}
}

function isFunctionPrototypeMemberName(name: string): boolean {
	switch (name) {
		case 'call':
		case 'apply':
		case 'bind':
			return true;
		default:
			return false;
	}
}

function isFunctionOwnMemberName(name: string): boolean {
	switch (name) {
		case 'length':
		case 'name':
		case 'arguments':
			return true;
		default:
			return false;
	}
}

function formatHoverValueTypeSuffix(valueType: string): string {
	if (valueType && valueType !== 'unknown') {
		return ` (${valueType})`;
	}
	return '';
}

function resolveTableChain(table: LuaTable): LuaTable[] {
	const chain: LuaTable[] = [];
	let current: LuaTable = table;
	const visited = new Set<LuaTable>();
	while (current && !visited.has(current)) {
		visited.add(current);
		chain.push(current);
		const metatable = current.metatable;
		if (metatable) {
			const metaIndex = metatable.get('__index');
			if (isLuaTable(metaIndex)) {
				current = metaIndex;
				continue;
			}
		}
		const ownIndex = current.get('__index');
		if (isLuaTable(ownIndex)) {
			current = ownIndex;
			continue;
		}
		break;
	}
	return chain;
}

function resolveTableTypeName(bridge: RuntimeLuaTooling, table: LuaTable): string {
	const chain = resolveTableChain(table);
	for (let i = 0; i < chain.length; i += 1) {
		const direct = bridge.luaInterpreter.resolveValueName(chain[i]);
		if (direct) {
			return direct;
		}
	}
	return null;
}

const globalSymbolsCache = new WeakMap<LuaSemanticWorkspaceSnapshot, LuaSymbolEntry[]>();

function hasStaticLuaBuiltinName(name: string): boolean {
	const trimmed = name.trim();
	if (trimmed.length === 0) {
		return false;
	}
	for (let index = 0; index < DEFAULT_LUA_BUILTIN_NAMES.length; index += 1) {
		if (DEFAULT_LUA_BUILTIN_NAMES[index] === trimmed) {
			return true;
		}
	}
	return false;
}

function extractFunctionParameters(fn: (...args: unknown[]) => unknown): string[] {
	const source = Function.prototype.toString.call(fn);
	const openIndex = source.indexOf('(');
	if (openIndex === -1) {
		return [];
	}
	let index = openIndex + 1;
	let depth = 1;
	let closeIndex = source.length;
	while (index < source.length) {
		const ch = source.charAt(index);
		if (ch === '(') {
			depth += 1;
		} else if (ch === ')') {
			depth -= 1;
			if (depth === 0) {
				closeIndex = index;
				break;
			}
		}
		index += 1;
	}
	if (depth !== 0 || closeIndex <= openIndex) {
		return [];
	}
	const slice = source.slice(openIndex + 1, closeIndex);
	const withoutBlockComments = slice.replace(/\/\*[\s\S]*?\*\//g, '');
	const withoutLineComments = withoutBlockComments.replace(/\/\/.*$/gm, '');
	const rawTokens = withoutLineComments.split(',');
	const names: string[] = [];
	for (let i = 0; i < rawTokens.length; i += 1) {
		const token = rawTokens[i].trim();
		if (token.length === 0) {
			continue;
		}
		names.push(sanitizeParameterName(token, i));
	}
	return names;
}

function sanitizeParameterName(token: string, index: number): string {
	let candidate = token.trim();
	if (candidate.length === 0) {
		return `arg${index + 1}`;
	}
	if (candidate.startsWith('...')) {
		return '...';
	}
	const equalsIndex = candidate.indexOf('=');
	if (equalsIndex >= 0) {
		candidate = candidate.slice(0, equalsIndex).trim();
	}
	const colonIndex = candidate.indexOf(':');
	if (colonIndex >= 0) {
		candidate = candidate.slice(0, colonIndex).trim();
	}
	const bracketIndex = Math.max(candidate.indexOf('{'), candidate.indexOf('['));
	if (bracketIndex !== -1) {
		return `arg${index + 1}`;
	}
	const sanitized = candidate.replace(/[^A-Za-z0-9_]/g, '');
	if (sanitized.length === 0) {
		return `arg${index + 1}`;
	}
	return sanitized;
}

function wrapHoverLines(lines: string[]): string[] {
	const wrapWidth = Math.max(
		editorViewState.spaceAdvance,
		editorViewState.viewportWidth - constants.HOVER_TOOLTIP_PADDING_X * 2 - editorViewState.spaceAdvance * 2
	);
	const wrapped: string[] = [];
	for (let i = 0; i < lines.length; i += 1) {
		writeWrappedOverlayLine(wrapped, lines[i], wrapWidth);
	}
	return wrapped;
}

export function buildHoverContentLines(result: LuaHoverResult): string[] {
	const lines: string[] = [];
	if (result.state === 'not_defined') {
		lines.push(`${result.expression} = not defined`);
		return wrapHoverLines(lines);
	}
	const valueLines = result.lines.length > 0 ? result.lines : [''];
	if (valueLines.length === 1) {
		const suffix = formatHoverValueTypeSuffix(result.valueType);
		lines.push(`${result.expression} = ${valueLines[0]}${suffix}`);
		return wrapHoverLines(lines);
	}
	const suffix = formatHoverValueTypeSuffix(result.valueType);
	lines.push(`${result.expression}${suffix}`);
	for (const line of valueLines) lines.push(`  ${line}`);
	return wrapHoverLines(lines);
}

export function updateHoverTooltip(
	bridge: RuntimeLuaTooling,
	fault: RuntimeFaultState,
	runtime: Runtime,
	snapshot: PointerSnapshot,
	context: EditorDocumentContext,
	bounds?: CodeAreaBounds,
): void {
	const pointer = resolvePointerTextPosition(snapshot.viewportX, snapshot.viewportY, bounds);
	const row = pointer.row;
	const column = pointer.column;
	const path = context.resource.path;
	const token = extractHoverExpression(row, column, path);
	if (!token) {
		clearHoverTooltip();
		return;
	}
	const inspection = inspectLuaExpression(
		bridge,
		fault,
		runtime,
		token.expression,
		path,
		row + 1,
		token.startColumn + 1,
		context,
	);
	const previousInspection = intellisenseUiState.lastInspectorResult;
	intellisenseUiState.lastInspectorResult = inspection;
	if (!inspection) {
		clearHoverTooltip();
		return;
	}
	if (inspection.isFunction && (inspection.isLocalFunction || inspection.isBuiltin) && inspection.state !== 'value') {
		clearHoverTooltip();
		return;
	}
	const contentLines = buildHoverContentLines(inspection);
	const existing = intellisenseUiState.hoverTooltip;
	if (existing && existing.expression === inspection.expression && existing.path === path) {
		existing.contentLines = contentLines;
		existing.valueType = inspection.valueType;
		existing.scope = inspection.scope;
		existing.state = inspection.state;
		existing.path = path;
		existing.row = row;
		existing.startColumn = token.startColumn;
		existing.endColumn = token.endColumn;
		existing.bubbleBounds = null;
		if (!previousInspection || previousInspection.expression !== inspection.expression) {
			existing.scrollOffset = 0;
			existing.visibleLineCount = 0;
		}
		const visibleLineCount = existing.visibleLineCount || 1;
		const maxOffset = contentLines.length > visibleLineCount ? contentLines.length - visibleLineCount : 0;
		if (existing.scrollOffset > maxOffset) {
			existing.scrollOffset = maxOffset;
		}
		return;
	}
	intellisenseUiState.hoverTooltip = {
		expression: inspection.expression,
		contentLines,
		valueType: inspection.valueType,
		scope: inspection.scope,
		state: inspection.state,
		path,
		row,
		startColumn: token.startColumn,
		endColumn: token.endColumn,
		scrollOffset: 0,
		visibleLineCount: 0,
		bubbleBounds: null,
	};
}

export function clearHoverTooltip(): void {
	intellisenseUiState.hoverTooltip = null;
	intellisenseUiState.lastInspectorResult = null;
}

export function buildMemberCompletionItems(bridge: RuntimeLuaTooling, fault: RuntimeFaultState, runtime: Runtime, objectName: string, operator: '.' | ':', domain: ResourceDomain, path: string): LuaCompletionItem[] {
	if (objectName.length === 0) {
		return [];
	}
	const response = listLuaObjectMembers(bridge, fault, runtime, objectName, domain, path, operator);
	if (response.length === 0) {
		return [];
	}
	const items: LuaCompletionItem[] = [];
	for (let index = 0; index < response.length; index += 1) {
		const entry = response[index];
		if (!entry || !entry.name || entry.name.length === 0) {
			continue;
		}
		const kind = entry.kind === 'method' ? 'native_method' : 'native_property';
		const parameters = entry.parameters && entry.parameters.length > 0 ? entry.parameters.slice() : undefined;
		const detail = entry.detail;
		items.push({
			label: entry.name,
			insertText: entry.name,
			sortKey: `${kind}:${entry.name}`,
			kind,
			detail,
			parameters,
		});
	}
	items.sort((a, b) => a.label.localeCompare(b.label));
	return items;
}

export function requestSemanticRefresh(): void {
	switch (editorDocumentState.mode) {
		case 'lua':
			editorViewState.layout.requestSemanticUpdate(
				editorDocumentState.buffer,
				editorDocumentState.textVersion,
				editorDocumentState.resource,
			);
			return;
		case 'aem':
			return;
	}
}
export function extractHoverExpression(row: number, column: number, path: string): { expression: string; startColumn: number; endColumn: number; } {
	return extractHoverExpressionFromBuffer(editorDocumentState.buffer, row, column, path);
}

export function extractHoverExpressionFromBuffer(buffer: TextBuffer, row: number, column: number, path: string): { expression: string; startColumn: number; endColumn: number; } {
	if (row < 0 || row >= buffer.getLineCount()) {
		return null;
	}
	const line = buffer.getLineContent(row);
	const safeColumn = clamp(column, 0, line.length);
	if (isLuaCommentContext(buffer, row, safeColumn)) {
		return null;
	}
	if (line.length === 0) {
		return null;
	}
	const source = getTextSnapshot(buffer);
	const tokenMatch = findContextMenuTokenMatch(row, safeColumn, path, source);
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
	tokens: readonly LuaToken[];
};

function findContextMenuTokenMatch(row: number, column: number, path: string, source: string): ContextMenuTokenMatch {
	const tokens = getCachedLuaParse({
		path,
		source,
	}).parsed.tokens;
	const targetLine = row + 1;
	let adjacent: ContextMenuTokenMatch = null;
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (token.type === LuaTokenType.Eof) {
			break;
		}
		if (token.line < targetLine) {
			continue;
		}
		if (token.line > targetLine) {
			break;
		}
		const tokenLength = token.lexeme.length;
		if (tokenLength === 0) {
			continue;
		}
		const tokenStart = token.column - 1;
		const tokenEnd = tokenStart + tokenLength;
		if (column >= tokenStart && column < tokenEnd) {
			return {
				token,
				index,
				startColumn: tokenStart,
				endColumn: tokenEnd,
				tokens,
			};
		}
		if (column === tokenEnd) {
			adjacent = {
				token,
				index,
				startColumn: tokenStart,
				endColumn: tokenEnd,
				tokens,
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
	const tokens = match.tokens;
	for (let index = match.index + 1; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (token.type === LuaTokenType.Eof || token.line !== targetLine) {
			break;
		}
		if (token.type !== LuaTokenType.Identifier) {
			continue;
		}
		return extractHoverExpression(row, token.column - 1, path);
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
	if (row < 0 || row >= editorDocumentState.buffer.getLineCount()) {
		return null;
	}
	const line = editorDocumentState.buffer.getLineContent(row);
	if (line.length === 0) {
		return null;
	}
	const safeColumn = clamp(column, 0, line.length);
	if (isLuaCommentContext(editorDocumentState.buffer, row, safeColumn)) {
		return null;
	}
	const expression = extractHoverExpression(row, safeColumn, path);
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
	const source = getTextSnapshot(editorDocumentState.buffer);
	const match = findContextMenuTokenMatch(row, safeColumn, path, source);
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
	context: EditorDocumentContext,
): void {
	switch (context.mode) {
		case 'lua':
			break;
		case 'aem':
			clearGotoHoverHighlight();
			return;
	}
	const path = context.resource.path;
	const definitions = queryDefinitionsAt(bridge, context, row, column);
	const token = extractHoverExpression(row, column, path);
	if (definitions.length === 0 && !token) {
		clearGotoHoverHighlight();
		return;
	}
	const highlightStart = token ? token.startColumn : column;
	const highlightEnd = token ? token.endColumn : column;
	const highlightExpression = token ? token.expression : '';
	const existing = intellisenseUiState.gotoHoverHighlight;
	if (existing
		&& existing.row === row
		&& column >= existing.startColumn
		&& column <= existing.endColumn
		&& existing.expression === highlightExpression) {
		return;
	}
	if (definitions.length === 0) {
		clearGotoHoverHighlight();
		return;
	}
	intellisenseUiState.gotoHoverHighlight = {
		row,
		startColumn: highlightStart,
		endColumn: highlightEnd,
		expression: highlightExpression,
	};
}

export function clearGotoHoverHighlight(): void {
	intellisenseUiState.gotoHoverHighlight = null;
}

export function clearReferenceHighlights(): void {
	referenceState.clear();
}

export function inspectLuaExpression(bridge: RuntimeLuaTooling, fault: RuntimeFaultState, runtime: Runtime, expression: string, path: string, row: number, column: number, activeContext: EditorDocumentContext): LuaHoverResult {
	const trimmed = expression.trim();
	if (trimmed.length === 0) {
		return null;
	}
	const chain = parseLuaIdentifierChain(trimmed);
	if (!chain) {
		return null;
	}
	const resolved = resolveLuaChainValue(
		bridge,
		fault,
		runtime,
		chain,
		activeContext.resource.domain,
		path,
		row,
		column,
	);
	const staticDefinition = findStaticDefinitionLocation(bridge, row, column, path, activeContext);
	if (!resolved) {
		if (!staticDefinition) {
			return null;
		}
		return {
			expression: trimmed,
			lines: ['static definition'],
			valueType: 'unknown',
			scope: 'path',
			state: 'not_defined',
			isFunction: false,
			isLocalFunction: false,
			isBuiltin: false,
			definition: staticDefinition,
		};
	}
	if (resolved.kind === 'not_defined') {
		return {
			expression: trimmed,
			lines: ['not defined'],
			valueType: 'undefined',
			scope: resolved.scope,
			state: 'not_defined',
			isFunction: false,
			isLocalFunction: false,
			isBuiltin: false,
			definition: staticDefinition,
		};
	}
	const formatted = resolved.source === 'runtime'
		? describeSuspendedGuestValueForInspector(bridge, resolved.value)
		: describeLuaValueForInspector(bridge, resolved.value);
	const isFunction = formatted.isFunction;
	const isLocalFunction = isFunction && resolved.scope === 'path';
	const isBuiltin = isFunction && chain.length === 1 && isLuaBuiltinFunctionName(chain[0]);
	let definition: LuaDefinitionLocation = null;
	if (!isBuiltin) {
		definition = resolveLuaDefinitionMetadata(bridge, resolved.definitionRange);
		if (!definition) {
			definition = staticDefinition;
		}
	}
	return {
		expression: trimmed,
		lines: formatted.lines,
		valueType: formatted.valueType,
		scope: resolved.scope,
		state: 'value',
		isFunction,
		isLocalFunction,
		isBuiltin,
		definition,
	};
}

export function listLuaObjectMembers(bridge: RuntimeLuaTooling, fault: RuntimeFaultState, runtime: Runtime, expression: string, domain: ResourceDomain, path: string, operator: '.' | ':'): LuaMemberCompletion[] {
	const trimmed = expression.trim();
	if (trimmed.length === 0) {
		return [];
	}
	const chain = parseLuaIdentifierChain(trimmed);
	if (!chain) {
		return [];
	}
	const resolved = resolveLuaChainValue(bridge, fault, runtime, chain, domain, path, null, null);
	if (!resolved || resolved.kind !== 'value') {
		return [];
	}
	if (resolved.source === 'runtime') {
		return bridge.suspendedGuest.kind(resolved.value) === SuspendedGuestValueKind.Table
			? buildSuspendedGuestTableMemberCompletionEntries(
				bridge,
				resolved.value,
				operator,
			)
			: [];
	}
	const value = resolved.value;
	if (value === null) {
		return [];
	}
	if (value instanceof LuaNativeValue) {
		return getNativeMemberCompletionEntries(bridge, value, operator);
	}
	if (isLuaTable(value)) {
		const typeName = resolveTableTypeName(bridge, value);
		return buildTableMemberCompletionEntries(value, operator, typeName);
	}
	return [];
}

export function resolveLuaDefinitionMetadata(bridge: RuntimeLuaTooling, range: LuaSourceRange): LuaDefinitionLocation {
	if (!range) {
		return null;
	}
	const sourceMatch = resolveRuntimeLuaSourceForContext(
		bridge.sources,
		bridge.sources.activeCartridgeSlot,
		range.path,
	);
	if (sourceMatch && sourceMatch.record.source_path !== range.path) {
		range = {
			path: sourceMatch.record.source_path,
			start: range.start,
			end: range.end,
		};
	}
	return definitionLocationFromSourceRange(range);
}


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
		const location = definitionLocationFromSourceRange(declaration.range);
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
			location: definitionLocationFromSourceRange(decl.range),
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
	activeContext: EditorDocumentContext,
): LuaDefinitionLocation {
	const source = resolveRuntimeLuaSourceForContext(
		bridge.sources,
		activeContext.resource.domain,
		path,
	);
	if (!source) {
		return null;
	}
	const sourcePath = source.record.source_path;
	const project = getOrCreateSemanticProject(activeContext.resource.domain);
	project.synchronizeRuntimeSources(bridge.sources);
	if (activeContext.resource.path === sourcePath) {
		project.updateDocument(sourcePath, getTextSnapshot(editorDocumentState.buffer));
	}
	const frontend = createEditorSemanticFrontend(bridge, project.getSnapshot());
	const symbols = frontend.findSymbolsByPosition(sourcePath, usageRow, usageColumn);
	return symbols && symbols.targets.length === 1
		? definitionLocationFromSourceRange(symbols.targets[0].declaration.range)
		: null;
}

export function positionWithinRange(row: number, column: number, range: LuaSourceRange): boolean {
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

function positionAfterOrEqual(
	row: number,
	column: number,
	start: { line: number; column: number },
): boolean {
	if (row > start.line) {
		return true;
	}
	if (row < start.line) {
		return false;
	}
	return column >= start.column;
}

function rangeArea(range: SourceRange): number {
	const lineSpan = range.end.line - range.start.line;
	const columnSpan = range.end.column - range.start.column;
	return (lineSpan * 100000) + columnSpan;
}

function resolveTableChainMemberValue(table: LuaTable, key: string): LuaValue {
	const chain = resolveTableChain(table);
	for (let index = 0; index < chain.length; index += 1) {
		const value = chain[index].get(key);
		if (value !== null) {
			return value;
		}
	}
	return null;
}

function resolveNativePropertyNameForIntellisense(target: object | Function, propertyName: string): string | null {
	if (propertyName in target) {
		return propertyName;
	}
	const upper = propertyName.toUpperCase();
	let prototype: object = target;
	while (prototype && prototype !== Object.prototype) {
		const propertyNames = Object.getOwnPropertyNames(prototype);
		for (let index = 0; index < propertyNames.length; index += 1) {
			const candidate = propertyNames[index];
			if (candidate === propertyName) {
				return candidate;
			}
			if (candidate.toUpperCase() === upper) {
				return candidate;
			}
		}
		prototype = Object.getPrototypeOf(prototype);
	}
	return null;
}

function wrapHostValueForIntellisense(bridge: RuntimeLuaTooling, value: unknown): LuaValue {
	if (value == null) {
		return null;
	}
	if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
		return value;
	}
	if (isLuaTable(value) || isLuaFunctionValue(value) || value instanceof LuaNativeValue) {
		return value;
	}
	if (typeof value === 'object' || value instanceof Function) {
		const native = value as object | Function;
		return bridge.luaInterpreter.getOrCreateNativeValue(native, resolveNativeTypeName(native));
	}
	return null;
}

function walkValueChain(bridge: RuntimeLuaTooling, root: LuaValue, parts: ReadonlyArray<string>, startIndex: number): LuaValue | null {
	let current: LuaValue = root;
	for (let index = startIndex; index < parts.length; index += 1) {
		const part = parts[index];
		if (isLuaTable(current)) {
			current = resolveTableChainMemberValue(current, part);
		} else if (current instanceof LuaNativeValue) {
			current = resolveNativeChainMemberValue(bridge, current, part);
		} else {
			return null;
		}
		if (current == null) {
			return null;
		}
	}
	return current;
}

function resolveRuntimeLocalChainValue(
	bridge: RuntimeLuaTooling,
	fault: RuntimeFaultState,
	runtime: Runtime,
	parts: ReadonlyArray<string>,
	path: string,
	usageRow: number,
	usageColumn: number,
): ({ kind: 'value'; value: SuspendedGuestValue; definitionRange: LuaSourceRange } | { kind: 'not_defined' }) | null {
	if (parts.length === 0 || !path || usageRow === null) {
		return null;
	}
	let requestedPath = path;
	const requestedSource = resolveRuntimeLuaSourceForContext(
		bridge.sources,
		runtime.machine.cpu.activeCartridgeSlot(),
		path,
	);
	if (requestedSource) {
		requestedPath = requestedSource.record.module_path;
	}
	const cpu = runtime.machine.cpu;
	const useFaultSnapshot = Boolean(fault.faultSnapshot);
	const faultFrames = fault.lastCpuFaultSnapshot;
	const frameDepth = useFaultSnapshot ? faultFrames.length : cpu.getFrameDepth();
	if (frameDepth === 0) {
		return null;
	}
	const media = bridge.sources.currentBlua32Media;
	const rootName = parts[0];
	let selectedFrameIndex = -1;
	let selectedSlot: Blua32LocalSlotDebug = null;
	let upvalueFound = false;
	let rawUpvalue: SuspendedGuestValue = null;
	for (let frameIndex = frameDepth - 1; frameIndex >= 0; frameIndex -= 1) {
		let functionIndex: number;
		let textAddress: number;
		let tracePc: number;
		let image: Blua32ToolingImage | null;
		if (useFaultSnapshot) {
			const frame = faultFrames[frameIndex];
			functionIndex = frame.functionIndex;
			textAddress = frame.toolingImage.layout.header.textAddress;
			tracePc = frame.tracePc;
			image = frame.toolingImage;
		} else {
			const executionDomainId = cpu.readFrameExecutionDomain(frameIndex);
			image = blua32ToolingImageForDomain(media, executionDomainId);
			if (!image) {
				continue;
			}
			functionIndex = blua32FunctionIndexAtAddress(
				image.layout,
				cpu.readFrameFunctionAddress(frameIndex),
			);
			if (functionIndex < 0) {
				continue;
			}
			textAddress = image.layout.header.textAddress;
			if (frameIndex + 1 < frameDepth) {
				tracePc = cpu.readFrameCallSitePc(frameIndex + 1);
			} else {
				const functionRecord = image.layout.functions[functionIndex];
				tracePc = cpu.readLastExecutionDomain() === executionDomainId
					&& cpu.lastPc >= functionRecord.codeAddress
					&& cpu.lastPc < functionRecord.codeAddress + functionRecord.codeByteCount
					? cpu.lastPc
					: cpu.readFramePc(frameIndex);
			}
		}
		if (!image || functionIndex < 0 || image.symbols === null) {
			continue;
		}
		const symbols = image.symbols;
		const frameRange = blua32SourceRangeAtPc(symbols, textAddress, tracePc);
		if (frameRange === null) {
			continue;
		}
		const frameInlineCallSites = blua32InlineCallSitesAtPc(symbols, textAddress, tracePc);
		const physicalFrameRange = frameInlineCallSites.length === 0
			? frameRange
			: frameInlineCallSites[0].callRange;
		const slots = symbols.metadata.localSlotsByFunction[functionIndex];
		let frameBest: Blua32LocalSlotDebug = null;
		for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
			const slot = slots[slotIndex];
			if (slot.name !== rootName) {
				continue;
			}
			const slotFrameRange = resolveInlineLocalContextRange(
				slot,
				frameRange,
				frameInlineCallSites,
			);
			if (slotFrameRange === null || slotFrameRange.path !== requestedPath) {
				continue;
			}
			const slotScope = slot.scope;
			const frameRow = slotFrameRange.start.line;
			const frameColumn = slotFrameRange.start.column;
			const usageInScope = positionWithinRange(usageRow, usageColumn, slotScope);
			const usageAfterDef = positionAfterOrEqual(usageRow, usageColumn, slot.definition.start);
			const frameInScope = positionWithinRange(frameRow, frameColumn, slotScope);
			const isTopFrame = frameIndex === frameDepth - 1;
			const frameAfterDef = positionAfterOrEqual(frameRow, frameColumn, slot.definition.start);
			if (!usageInScope || !usageAfterDef || !frameInScope || (isTopFrame && !frameAfterDef)) {
				continue;
			}
			if (!frameBest || rangeArea(slot.scope) < rangeArea(frameBest.scope)) {
				frameBest = slot;
			}
		}
		if (frameBest) {
			selectedFrameIndex = frameIndex;
			selectedSlot = frameBest;
			break;
		}
		if (!upvalueFound && physicalFrameRange.path === requestedPath) {
			const frameUpvalueNames = symbols.metadata.upvalueNamesByFunction[functionIndex];
			const upvalueIndex = frameUpvalueNames.indexOf(rootName);
			const upvalueCount = useFaultSnapshot
				? faultFrames[frameIndex].upvalues.length
				: cpu.getFrameUpvalueCount(frameIndex);
			if (upvalueIndex >= 0 && upvalueIndex < upvalueCount) {
				rawUpvalue = useFaultSnapshot
					? faultFrames[frameIndex].upvalues[upvalueIndex]
					: cpu.readFrameUpvalue(frameIndex, upvalueIndex);
				upvalueFound = true;
			}
		}
	}
	if (selectedFrameIndex < 0 || !selectedSlot) {
		if (upvalueFound) {
			const chained = bridge.suspendedGuest.readStringPath(
				rawUpvalue,
				parts,
				1,
			);
			if (chained === null) {
				return { kind: 'not_defined' };
			}
			return { kind: 'value', value: chained, definitionRange: null };
		}
		return null;
	}
	const rawRegValue = useFaultSnapshot
		? faultFrames[selectedFrameIndex].registers[selectedSlot.registerIndex]
		: cpu.readFrameRegister(selectedFrameIndex, selectedSlot.registerIndex);
	const chained = bridge.suspendedGuest.readStringPath(rawRegValue, parts, 1);
	if (chained === null) {
		return { kind: 'not_defined' };
	}
	return {
		kind: 'value',
		value: chained,
		definitionRange: selectedSlot.definition,
	};
}

function resolveRuntimeGlobalChainValue(
	bridge: RuntimeLuaTooling,
	parts: ReadonlyArray<string>,
	domain: ResourceDomain,
): ({ kind: 'value'; value: SuspendedGuestValue } | { kind: 'not_defined' }) | null {
	const image = domain === SYSTEM_RESOURCE_DOMAIN
		? bridge.sources.currentBlua32Media.system
		: bridge.sources.currentBlua32Media.cartridgeSlots[domain];
	if (!image) {
		return null;
	}
	const registerFile = image.globalRegisterFileByName.get(parts[0]);
	if (!registerFile) {
		return null;
	}
	const rootRaw = registerFile === Blua32GlobalRegisterFile.System
		? bridge.suspendedGuest.systemGlobal(parts[0])
		: bridge.suspendedGuest.global(parts[0]);
	if (rootRaw === null) {
		return null;
	}
	const chained = bridge.suspendedGuest.readStringPath(rootRaw, parts, 1);
	if (chained === null) {
		return { kind: 'not_defined' };
	}
	return { kind: 'value', value: chained };
}

function resolveNativeChainMemberValue(bridge: RuntimeLuaTooling, target: LuaNativeValue, key: string): LuaValue {
	const metatable = target.metatable;
	if (metatable) {
		const indexHandler = metatable.get('__index');
		if (isLuaTable(indexHandler)) {
			const tableValue = resolveTableChainMemberValue(indexHandler, key);
			if (tableValue !== null) {
				return tableValue;
			}
		}
	}
	const resolvedName = resolveNativePropertyNameForIntellisense(target.native, key);
	if (!resolvedName) {
		return null;
	}
	return wrapHostValueForIntellisense(bridge, Reflect.get(target.native, resolvedName));
}

export function resolveLuaChainValue(
	bridge: RuntimeLuaTooling,
	fault: RuntimeFaultState,
	runtime: Runtime,
	parts: string[],
	domain: ResourceDomain,
	path: string,
	usageRow: number,
	usageColumn: number,
): (
	| ({ kind: 'value'; scope: LuaHoverScope; definitionRange: LuaSourceRange } & ResolvedIntellisenseValue)
	| { kind: 'not_defined'; scope: LuaHoverScope }
) {
	if (!parts || parts.length === 0) {
		return null;
	}
	const interpreter = bridge.luaInterpreter;
	const root = parts[0];
	const globalEnv = interpreter.globalEnvironment;

	// Priority 1: CPU local slots (bytecode CPU execution / fault)
	const localResult = resolveRuntimeLocalChainValue(bridge, fault, runtime, parts, path, usageRow, usageColumn);
	if (localResult) {
		if (localResult.kind === 'not_defined') {
			return { kind: 'not_defined', scope: 'path' };
		}
		return {
			kind: 'value',
			source: 'runtime',
			value: localResult.value,
			scope: 'path',
			definitionRange: localResult.definitionRange,
		};
	}

	// Priority 2: CPU globals table
	const globalResult = resolveRuntimeGlobalChainValue(bridge, parts, domain);
	if (globalResult) {
		if (globalResult.kind === 'not_defined') {
			return { kind: 'not_defined', scope: 'global' };
		}
		return {
			kind: 'value',
			source: 'runtime',
			value: globalResult.value,
			scope: 'global',
			definitionRange: null,
		};
	}

	// Priority 3: Interpreter fault environment (tree-walker)
	const frameEnv = interpreter.lastFaultEnvironment;
	if (frameEnv) {
		const resolved = resolveIdentifierThroughChain(frameEnv, root, interpreter);
		if (resolved) {
			const chained = walkValueChain(bridge, resolved.value, parts, 1);
			if (chained === null) {
				return { kind: 'not_defined', scope: resolved.scope };
			}
			return {
				kind: 'value',
				source: 'interpreter',
				value: chained,
				scope: resolved.scope,
				definitionRange: resolved.environment.getDefinition(root),
			};
		}
	}

	// Priority 4: Interpreter globals
	if (globalEnv.hasLocal(root)) {
		const chained = walkValueChain(bridge, globalEnv.get(root) as LuaValue, parts, 1);
		if (chained === null) {
			return { kind: 'not_defined', scope: 'global' };
		}
		return {
			kind: 'value',
			source: 'interpreter',
			value: chained,
			scope: 'global',
			definitionRange: globalEnv.getDefinition(root),
		};
	}

	return null;
}

export function resolveIdentifierThroughChain(environment: LuaEnvironment, name: string, interpreter: LuaInterpreter): { environment: LuaEnvironment; value: LuaValue; scope: LuaHoverScope } {
	let current: LuaEnvironment = environment;
	const globalEnv = interpreter.globalEnvironment;
	while (current) {
		if (current.hasLocal(name)) {
			const value = current.get(name);
			const scope: LuaHoverScope = current === globalEnv ? 'global' : 'path';
			return { environment: current, value, scope };
		}
		current = current.getParent();
	}
	return null;
}

function describeSuspendedGuestValueForInspector(
	bridge: RuntimeLuaTooling,
	value: SuspendedGuestValue,
): { lines: string[]; valueType: string; isFunction: boolean } {
	const inspection = bridge.suspendedGuest;
	switch (inspection.kind(value)) {
		case SuspendedGuestValueKind.Nil:
			return { lines: ['Nil'], valueType: 'nil', isFunction: false };
		case SuspendedGuestValueKind.Boolean:
			return {
				lines: [inspection.formatValue(value)],
				valueType: 'boolean',
				isFunction: false,
			};
		case SuspendedGuestValueKind.Number:
			return {
				lines: [inspection.formatValue(value)],
				valueType: 'number',
				isFunction: false,
			};
		case SuspendedGuestValueKind.String:
			return {
				lines: [JSON.stringify(inspection.formatValue(value))],
				valueType: 'string',
				isFunction: false,
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
				isFunction: false,
			};
		case SuspendedGuestValueKind.Function:
			return { lines: ['<function>'], valueType: 'function', isFunction: true };
	}
}

export function describeLuaValueForInspector(bridge: RuntimeLuaTooling, value: LuaValue): { lines: string[]; valueType: string; isFunction: boolean } {
	const resolvedName = bridge.luaInterpreter.resolveValueName(value);
	if (value === null) {
		return { lines: ['Nil'], valueType: 'nil', isFunction: false };
	}
	if (typeof value === 'boolean') {
		return { lines: [value ? 'true' : 'false'], valueType: 'boolean', isFunction: false };
	}
	if (typeof value === 'number') {
		const numeric = Number.isFinite(value) ? String(value) : 'nan';
		return { lines: [numeric], valueType: 'number', isFunction: false };
	}
	if (typeof value === 'string') {
		return { lines: [JSON.stringify(value)], valueType: 'string', isFunction: false };
	}
	if (isLuaFunctionValue(value)) {
		const fnName = value.name && value.name.length > 0 ? value.name : '<anonymous>';
		return { lines: [`<function ${fnName}>`], valueType: 'function', isFunction: true };
	}
	if (value instanceof LuaNativeValue) {
		const native = value.native;
		const typeName = value.typeName && value.typeName.length > 0 ? value.typeName : resolveNativeTypeName(native);
		const labelName = resolvedName ?? typeName;
		if (native instanceof Function) {
			const params = extractFunctionParameters(native as (...args: unknown[]) => unknown);
			const paramSegment = params.length > 0 ? params.join(', ') : '';
			const signature = paramSegment.length > 0 ? `(${paramSegment})` : '()';
			const label = labelName && labelName.length > 0 ? `<native function ${labelName}${signature}>` : `<native function${signature}>`;
			return { lines: [label], valueType: labelName ?? 'native', isFunction: true };
		}
		let summary = `<${labelName ?? 'native'}>`;
		const identifier = (native as { id?: unknown }).id;
		if (identifier != null) {
			summary = `${summary} id=${String(identifier)}`;
		}
		return { lines: [summary], valueType: labelName ?? 'native', isFunction: false };
	}
	if (isLuaTable(value)) {
		const tableName = resolveTableTypeName(bridge, value);
		const preview = formatLuaValuePreview(value);
		const lines = tableName ? [`<table ${tableName}>`] : ['<table>'];
		lines.push(preview);
		return { lines, valueType: tableName ?? 'table', isFunction: false };
	}
	const summary = formatLuaValuePreview(value);
	return { lines: [summary], valueType: 'unknown', isFunction: false };
}

export function getNativeMemberCompletionEntries(bridge: RuntimeLuaTooling, value: LuaNativeValue, operator: '.' | ':'): LuaMemberCompletion[] {
	const native = value.native;
	const typeName = value.typeName && value.typeName.length > 0 ? value.typeName : resolveNativeTypeName(native);
	const registry = new Map<string, LuaMemberCompletion>();
	const includeProperties = operator === '.';
	const metatable = value.metatable;
	if (metatable) {
		const indexValue = metatable.get('__index');
		if (isLuaTable(indexValue)) {
			const luaEntries = buildTableMemberCompletionEntries(indexValue, operator, resolveTableTypeName(bridge, indexValue));
			for (let index = 0; index < luaEntries.length; index += 1) {
				registerNativeCompletion(registry, luaEntries[index]);
			}
		}
	}
	populateNativeMembersFromTarget(native, operator, typeName, registry, includeProperties);
	const prototypeEntries = getCachedPrototypeNativeEntries(native, operator, typeName);
	for (let index = 0; index < prototypeEntries.length; index += 1) {
		registerNativeCompletion(registry, prototypeEntries[index]);
	}
	const result: LuaMemberCompletion[] = [];
	for (const entry of registry.values()) {
		result.push({
			name: entry.name,
			kind: entry.kind,
			detail: entry.detail,
			parameters: entry.parameters.slice(),
		});
	}
	result.sort((a, b) => a.name.localeCompare(b.name));
	return result;
}

export function getCachedPrototypeNativeEntries(native: object | Function, operator: '.' | ':', typeName: string): LuaMemberCompletion[] {
	const cacheKey = resolveNativeCompletionCacheKey(native);
	const cacheField = operator === ':' ? 'colon' : 'dot';
	let cache = nativeMemberCompletionCache.get(cacheKey);
	const cached = cache && cache[cacheField];
	if (cached) {
		return cloneMemberCompletions(cached);
	}
	const built = buildNativePrototypeMemberEntries(native, operator, typeName);
	if (!cache) {
		cache = {};
		nativeMemberCompletionCache.set(cacheKey, cache);
	}
	cache[cacheField] = built;
	return cloneMemberCompletions(built);
}

export function buildNativePrototypeMemberEntries(native: object | Function, operator: '.' | ':', typeName: string): LuaMemberCompletion[] {
	const registry = new Map<string, LuaMemberCompletion>();
	const includeProperties = operator === '.';
	const visited = new Set<object>();
	const traverse = (target: object): void => {
		let current = target;
		while (current && !visited.has(current)) {
			if (current === Object.prototype || current === Function.prototype) {
				return;
			}
			visited.add(current);
			populateNativeMembersFromTarget(current, operator, typeName, registry, includeProperties);
			current = Object.getPrototypeOf(current);
		}
	};
	if (native instanceof Function) {
		if (native.prototype) {
			traverse(native.prototype);
		}
		if (operator === '.') {
			const functionPrototype = Object.getPrototypeOf(native);
			traverse(functionPrototype);
		}
	} else {
		traverse(Object.getPrototypeOf(native));
	}
	const entries: LuaMemberCompletion[] = [];
	for (const entry of registry.values()) {
		entries.push({ name: entry.name, kind: entry.kind, detail: entry.detail, parameters: entry.parameters.slice() });
	}
	entries.sort((a, b) => a.name.localeCompare(b.name));
	return entries;
}

function registerTableMemberCompletion(
	registry: Map<string, LuaMemberCompletion>,
	key: string,
	isFunction: boolean,
	operator: '.' | ':',
	typeName?: string,
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
	const detail = isFunction
		? (typeName ? `function ${typeName}${operator === ':' ? ':' : '.'}${key}` : `function ${key}`)
		: (typeName ? `${typeName}.${key}` : `table field '${key}'`);
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

export function buildTableMemberCompletionEntries(table: LuaTable, operator: '.' | ':', typeName?: string): LuaMemberCompletion[] {
	const registry = new Map<string, LuaMemberCompletion>();

	const appendFromTable = (target: LuaTable) => {
		const entries = target.entriesArray();
		for (let index = 0; index < entries.length; index += 1) {
			const [key, entryValue] = entries[index];
			if (typeof key !== 'string') {
				continue;
			}
			registerTableMemberCompletion(
				registry,
				key,
				isLuaFunctionValue(entryValue),
				operator,
				typeName,
			);
		}
	};

	const chain = resolveTableChain(table);
	for (let i = 0; i < chain.length; i += 1) {
		appendFromTable(chain[i]);
	}

	return sortedTableMemberCompletions(registry);
}

export function resolveNativeCompletionCacheKey(native: object | Function): object {
	if (native instanceof Function) {
		return native;
	}
	const prototype = Object.getPrototypeOf(native);
	if (prototype && typeof prototype === 'object') {
		return prototype;
	}
	return native;
}

export function populateNativeMembersFromTarget(target: object | Function, operator: '.' | ':', typeName: string, registry: Map<string, LuaMemberCompletion>, includeProperties: boolean): void {
	const propertyNames = Object.getOwnPropertyNames(target);
	const isFunctionTarget = target instanceof Function;
	const skipFunctionPrototypeMembers = target === Function.prototype;
	for (let index = 0; index < propertyNames.length; index += 1) {
		const name = propertyNames[index];
		if (isHiddenNativeMemberName(name)) {
			continue;
		}
		if (skipFunctionPrototypeMembers && isFunctionPrototypeMemberName(name)) {
			continue;
		}
		if (isFunctionTarget && isFunctionOwnMemberName(name)) {
			continue;
		}
		const descriptor = Object.getOwnPropertyDescriptor(target, name);
		if (!descriptor) {
			continue;
		}
		if (descriptor.value instanceof Function) {
			const rawParams = extractFunctionParameters(descriptor.value);
			const params = operator === ':' ? adjustMethodParametersForColon(rawParams) : rawParams.slice();
			const detail = formatNativeMethodDetail(typeName, name, params, operator);
			registerNativeCompletion(registry, { name, kind: 'method', detail, parameters: params });
			continue;
		}
		const hasGetter = descriptor.get !== undefined;
		const hasSetter = descriptor.set !== undefined;
		if (includeProperties && (hasGetter || 'value' in descriptor)) {
			const detail = formatNativePropertyDetail(typeName, name, hasGetter, hasSetter);
			registerNativeCompletion(registry, { name, kind: 'property', detail, parameters: [] });
		}
	}
}

export function registerNativeCompletion(registry: Map<string, LuaMemberCompletion>, entry: LuaMemberCompletion): void {
	if (registry.has(entry.name)) {
		return;
	}
	registry.set(entry.name, {
		name: entry.name,
		kind: entry.kind,
		detail: entry.detail,
		parameters: entry.parameters.slice(),
	});
}

export function adjustMethodParametersForColon(params: string[]): string[] {
	if (!params || params.length === 0) {
		return [];
	}
	const first = params[0];
	const normalized = first.trim();
	if (normalized === 'self' || normalized === 'this') {
		return params.slice(1);
	}
	return params.slice();
}

export function formatNativeMethodDetail(typeName: string, name: string, parameters: readonly string[], operator: '.' | ':'): string {
	const paramSegment = parameters.length > 0 ? parameters.join(', ') : '';
	const signature = paramSegment.length > 0 ? `(${paramSegment})` : '()';
	const separator = operator === ':' ? ':' : '.';
	if (typeName && typeName.length > 0) {
		return `${typeName}${separator}${name}${signature}`;
	}
	return `${name}${signature}`;
}

export function formatNativePropertyDetail(typeName: string, name: string, hasGetter: boolean, hasSetter: boolean): string {
	const base = typeName && typeName.length > 0 ? `${typeName}.${name}` : name;
	if (hasGetter && hasSetter) {
		return `${base} (property)`;
	}
	if (hasGetter) {
		return `${base} (read-only)`;
	}
	if (hasSetter) {
		return `${base} (write-only)`;
	}
	return `${base}`;
}

export function cloneMemberCompletions(entries: LuaMemberCompletion[]): LuaMemberCompletion[] {
	const cloned: LuaMemberCompletion[] = [];
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		cloned.push({ name: entry.name, kind: entry.kind, detail: entry.detail, parameters: entry.parameters.slice() });
	}
	return cloned;
}

export function clearNativeMemberCompletionCache(): void {
	nativeMemberCompletionCache = new WeakMap<object, { dot?: LuaMemberCompletion[]; colon?: LuaMemberCompletion[] }>();
}

export function isLuaBuiltinFunctionName(name: string): boolean {
	if (!name || name.length === 0) {
		return false;
	}
	return luaBuiltinMetadata.has(name) || hasStaticLuaBuiltinName(name);
}

export function describeLuaFunctionValue(value: LuaFunctionValue): string {
	const name = value.name && value.name.length > 0 ? value.name : '<anonymous>';
	return `function ${name}`;
}

export function describeLuaTable(table: LuaTable, depth: number, visited: Set<unknown>): string {
	if (visited.has(table) || depth >= PREVIEW_MAX_DEPTH) {
		return '{…}';
	}
	visited.add(table);
	const entries = table.entriesArray();
	if (entries.length === 0) {
		return '{}';
	}
	const numeric = new Map<number, LuaValue>();
	const stringEntries: Array<{ key: string; value: LuaValue }> = [];
	const otherEntries: Array<{ key: string; value: LuaValue }> = [];
	for (let i = 0; i < entries.length; i += 1) {
		const [key, entryValue] = entries[i];
		if (typeof key === 'number' && Number.isInteger(key)) {
			numeric.set(key, entryValue);
			continue;
		}
		if (typeof key === 'string') {
			if (key === '__index' || key === '__metatable') {
				continue;
			}
			stringEntries.push({ key, value: entryValue });
			continue;
		}
			otherEntries.push({ key: formatLuaValuePreview(key as LuaValue, depth + 1, visited), value: entryValue });
	}
	const sequentialValues: LuaValue[] = [];
	let seqIndex = 1;
	while (numeric.has(seqIndex)) {
		sequentialValues.push(numeric.get(seqIndex)!);
		seqIndex += 1;
	}
	const isPureSequence = sequentialValues.length === numeric.size && stringEntries.length === 0 && otherEntries.length === 0;
	if (isPureSequence) {
		return `[${formatValueList(sequentialValues, depth, visited)}${numeric.size > PREVIEW_MAX_ENTRIES ? ', …' : ''}]`;
	}
	const parts: string[] = [];
	const limit = PREVIEW_MAX_ENTRIES;
	let consumed = 0;
	const appendEntry = (label: string, entryValue: LuaValue): void => {
		if (consumed >= limit) {
			return;
		}
			parts.push(`${label} = ${formatLuaValuePreview(entryValue, depth + 1, visited)}`);
		consumed += 1;
	};
	stringEntries.sort((a, b) => a.key.localeCompare(b.key));
	for (let i = 0; i < stringEntries.length && consumed < limit; i += 1) {
		const entry = stringEntries[i];
		appendEntry(entry.key, entry.value);
	}
	const numericKeys = Array.from(numeric.keys()).filter(key => key < 1 || key >= seqIndex);
	numericKeys.sort((a, b) => a - b);
	for (let i = 0; i < numericKeys.length && consumed < limit; i += 1) {
		const key = numericKeys[i];
		const val = numeric.get(key);
		if (val !== undefined) {
			appendEntry(`[${key}]`, val);
		}
	}
	for (let i = 0; i < otherEntries.length && consumed < limit; i += 1) {
		const entry = otherEntries[i];
		appendEntry(`[${entry.key}]`, entry.value);
	}
	if (sequentialValues.length > 0 && consumed < limit) {
		parts.push(`array = [${formatValueList(sequentialValues, depth, visited)}${sequentialValues.length > limit ? ', …' : ''}]`);
	}
	if (parts.length === 0) {
		return '{…}';
	}
	if (consumed >= limit || parts.length < stringEntries.length + numericKeys.length + otherEntries.length) {
		parts.push('…');
	}
	return `{ ${parts.join(', ')} }`;
}

export function describeLuaNativeValue(value: LuaNativeValue, depth: number, visited: Set<unknown>): string {
	const native = value.native;
	const typeName = value.typeName && value.typeName.length > 0 ? value.typeName : resolveNativeTypeName(native);
	if (visited.has(native) || depth >= PREVIEW_MAX_DEPTH) {
		return `[${typeName ?? 'native'} …]`;
	}
	visited.add(native);
	if (Array.isArray(native)) {
		const preview = formatArrayPreview(native, depth + 1, visited);
		return `${typeName ?? 'array'} [${preview}]`;
	}
	if (native instanceof Function) {
		const label = native.name && native.name.length > 0 ? native.name : '<anonymous>';
		return `[native function ${label}]`;
	}
	if (native && typeof native === 'object') {
		const entries = Object.getOwnPropertyNames(native).sort();
		const limit = Math.min(entries.length, PREVIEW_MAX_ENTRIES);
		const parts: string[] = [];
		for (let i = 0; i < limit; i += 1) {
			const key = entries[i];
			let summary = '<unavailable>';
			try {
				const descriptor = (native as Record<string, unknown>)[key];
				summary = formatJsValue(descriptor, depth, visited);
			} catch (error) {
				summary = extractErrorMessage(error);
			}
			parts.push(`${key}: ${summary}`);
		}
		if (entries.length > limit) {
			parts.push('…');
		}
		return `${typeName ?? 'native'} { ${parts.join(', ')} }`;
	}
	return `${typeName ?? 'native'} ${String(native)}`;
}

export function formatArrayPreview(values: unknown[], depth: number, visited: Set<unknown>): string {
	const preview: string[] = [];
	const limit = Math.min(values.length, PREVIEW_MAX_ENTRIES);
	for (let i = 0; i < limit; i += 1) {
		preview.push(formatJsValue(values[i], depth, visited));
	}
	if (values.length > limit) {
		preview.push('…');
	}
	return preview.join(', ');
}

export function formatValueList(values: LuaValue[], depth: number, visited: Set<unknown>): string {
	const parts: string[] = [];
	const limit = Math.min(values.length, PREVIEW_MAX_ENTRIES);
	for (let i = 0; i < limit; i += 1) {
		parts.push(formatLuaValuePreview(values[i], depth + 1, visited));
	}
	return parts.join(', ');
}

export function formatJsValue(value: unknown, depth: number, visited: Set<unknown>): string {
	if (value === null) {
		return 'null';
	}
	if (Array.isArray(value)) {
		return `[${formatArrayPreview(value, depth + 1, visited)}]`;
	}
	const type = typeof value;
	if (type === 'string') {
		return `"${value}"`;
	}
	if (type === 'number' || type === 'boolean') {
		return String(value);
	}
	if (type === 'function') {
		const fn = value as Function;
		const label = fn.name && fn.name.length > 0 ? fn.name : '<anonymous>';
		return `[function ${label}]`;
	}
	if (isLuaTable(value)) {
		return describeLuaTable(value, depth + 1, visited);
	}
	if (value instanceof LuaNativeValue) {
		return describeLuaNativeValue(value, depth + 1, visited);
	}
	if (value && typeof value === 'object') {
		if (visited.has(value)) {
			return '{…}';
		}
		visited.add(value);
		const entries = Object.keys(value as Record<string, unknown>).sort();
		const limit = Math.min(entries.length, PREVIEW_MAX_ENTRIES);
		const parts: string[] = [];
		for (let i = 0; i < limit; i += 1) {
			const key = entries[i];
			let summary = '<unavailable>';
			try {
				summary = formatJsValue((value as Record<string, unknown>)[key], depth + 1, visited);
			} catch (error) {
				summary = extractErrorMessage(error);
			}
			parts.push(`${key}: ${summary}`);
		}
		if (entries.length > limit) {
			parts.push('…');
		}
		return `{ ${parts.join(', ')} }`;
	}
	return String(value);
}

function formatLuaValuePreview(value: LuaValue, depth = 0, visited: Set<unknown> = new Set()): string {
	if (value === null) {
		return 'nil';
	}
	if (typeof value === 'boolean') {
		return value ? 'true' : 'false';
	}
	if (typeof value === 'number') {
		return Number.isFinite(value) ? String(value) : 'nan';
	}
	if (typeof value === 'string') {
		return value;
	}
	if (isLuaTable(value)) {
		return describeLuaTable(value, depth, visited);
	}
	if (value instanceof LuaNativeValue) {
		return describeLuaNativeValue(value, depth, visited);
	}
	if (isLuaFunctionValue(value)) {
		return describeLuaFunctionValue(value);
	}
	return 'function';
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
	const lastRowIndex = editorDocumentState.buffer.getLineCount() - 1;
	const startRow = clamp(range.startLine - 1, 0, lastRowIndex);
	const startLine = editorDocumentState.buffer.getLineContent(startRow);
	const startColumn = clamp(range.startColumn - 1, 0, startLine.length);
	editorDocumentState.cursorRow = startRow;
	editorDocumentState.cursorColumn = startColumn;
	clearSingleCursorSelection(editorDocumentState);
	clearEditorPointerSelectionState();
	updateDesiredColumn();
	resetBlink();
	editorCaretState.cursorRevealSuspended = false;
	ensureCursorVisible();
	editorDocumentState.emitCursorMoved();
}

export function findFunctionDefinitionRowInActiveFile(functionName: string): number {
	if (typeof functionName !== 'string' || functionName.length === 0) {
		return null;
	}
	const escaped = functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const patterns = [
		new RegExp(`^\\s*function\\s+${escaped}\\b`),
		new RegExp(`^\\s*local\\s+function\\s+${escaped}\\b`),
		new RegExp(`\\b${escaped}\\s*=\\s*function\\b`),
	];
	const lineCount = editorDocumentState.buffer.getLineCount();
	for (let row = 0; row < lineCount; row += 1) {
		const line = editorDocumentState.buffer.getLineContent(row);
		for (let index = 0; index < patterns.length; index += 1) {
			if (patterns[index].test(line)) {
				return row;
			}
		}
	}
	return null;
}
