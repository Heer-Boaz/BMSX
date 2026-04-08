import { DEFAULT_LUA_BUILTIN_NAMES } from '../lua_builtin_descriptors';
import { Runtime } from '../runtime';
import type { LuaDefinitionLocation } from '../types';
import type { LuaIncomingCallHierarchyNode } from '../lua_semantic_frontend';
import { resolveLuaIdentifierChainRoot } from './lua/lua_identifier_chain';
import { createLuaSemanticFrontendFromSnapshot } from './semantic_workspace';
import { prepareSemanticWorkspaceForEditorBuffer } from './semantic_workspace_sync';
import type { TextBuffer } from './text/text_buffer';
import { getTextSnapshot, splitText } from './text/source_text';
import type { EditorContextMenuEntry, EditorContextToken, SearchMatch } from './types';
import type { ReferenceMatchInfo } from './reference_state';
import type { LuaSemanticWorkspaceSnapshot, SymbolID } from './semantic_model';

export type CallHierarchyViewNodeKind = 'root' | 'caller' | 'call';

export type CallHierarchyViewNode = {
	id: string;
	kind: CallHierarchyViewNodeKind;
	label: string;
	location: LuaDefinitionLocation;
	children: CallHierarchyViewNode[];
};

export type CallHierarchyView = {
	title: string;
	root: CallHierarchyViewNode;
};

export type ExtractIdentifierExpression = (row: number, column: number) => { expression: string; startColumn: number; endColumn: number };

export type ReferenceLookupOptions = {
	buffer: TextBuffer;
	textVersion: number;
	cursorRow: number;
	cursorColumn: number;
	extractExpression: ExtractIdentifierExpression;
	path: string;
};

export type ReferenceLookupResult =
	| { kind: 'success'; info: ReferenceMatchInfo; initialIndex: number; }
	| { kind: 'error'; message: string; duration: number; };

export function buildEditorContextMenuEntries(token: EditorContextToken, editable: boolean): EditorContextMenuEntry[] {
	if (!token || token.kind !== 'identifier' || !token.expression || token.expression.length === 0) {
		return [];
	}
	if (isBuiltinContextExpression(token.expression)) {
		return [];
	}
	const entries: EditorContextMenuEntry[] = [
		{ action: 'goToDefinition', label: 'Go to Definition', enabled: true },
		{ action: 'referenceSearch', label: 'Go to References', enabled: true },
		{ action: 'callHierarchy', label: 'Show Call Hierarchy', enabled: true },
	];
	if (editable) {
		entries.push({ action: 'rename', label: 'Rename Symbol', enabled: true });
	}
	return entries;
}

export function resolveReferenceLookup(options: ReferenceLookupOptions): ReferenceLookupResult {
	const source = getTextSnapshot(options.buffer);
	const snapshot = prepareSemanticWorkspaceForEditorBuffer({
		path: options.path,
		source,
		lines: splitText(source),
		version: options.textVersion,
	});
	const identifier = options.extractExpression(options.cursorRow, options.cursorColumn);
	if (!identifier) {
		return { kind: 'error', message: 'No identifier at cursor', duration: 1.6 };
	}
	const frontend = createLuaSemanticFrontendFromSnapshot(snapshot, {
		extraGlobalNames: Runtime.instance ? Array.from(Runtime.instance.interpreter.globalEnvironment.keys()) : [],
	});
	const resolution = frontend.findReferencesByPosition(options.path, options.cursorRow + 1, options.cursorColumn + 1);
	if (!resolution) {
		return { kind: 'error', message: `Definition not found for ${identifier.expression}`, duration: 1.8 };
	}
	const matches: SearchMatch[] = [];
	const seen = new Set<string>();
	if (resolution.decl.file === options.path) {
		const definitionMatch = rangeToSearchMatchInBuffer(resolution.decl.range, options.buffer);
		if (definitionMatch) {
			const key = `${definitionMatch.row}:${definitionMatch.start}`;
			seen.add(key);
			matches.push(definitionMatch);
		}
	}
	for (let index = 0; index < resolution.references.length; index += 1) {
		const reference = resolution.references[index];
		if (reference.file !== options.path) {
			continue;
		}
		const match = rangeToSearchMatchInBuffer(reference.range, options.buffer);
		if (!match) {
			continue;
		}
		const key = `${match.row}:${match.start}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		matches.push(match);
	}
	if (matches.length === 0) {
		return { kind: 'error', message: 'No references found in this document', duration: 1.6 };
	}
	matches.sort((left, right) => left.row !== right.row ? left.row - right.row : left.start - right.start);
	let initialIndex = 0;
	for (let index = 0; index < matches.length; index += 1) {
		const match = matches[index];
		if (match.row === options.cursorRow && options.cursorColumn >= match.start && options.cursorColumn < match.end) {
			initialIndex = index;
			break;
		}
	}
	return {
		kind: 'success',
		info: {
			matches,
			expression: identifier.expression,
			definitionKey: resolution.id,
			documentVersion: options.textVersion,
		},
		initialIndex,
	};
}

export function buildIncomingCallHierarchyView(options: {
	snapshot: LuaSemanticWorkspaceSnapshot;
	rootSymbolId: SymbolID;
	rootExpression: string;
	maxDepth?: number;
	allowedPaths?: ReadonlySet<string>;
}): CallHierarchyView {
	const frontend = createLuaSemanticFrontendFromSnapshot(options.snapshot, {
		extraGlobalNames: Runtime.instance ? Array.from(Runtime.instance.interpreter.globalEnvironment.keys()) : [],
	});
	const rootDecl = frontend.getDecl(options.rootSymbolId);
	if (!rootDecl) {
		return null;
	}
	const nodes = frontend.buildIncomingCallHierarchy(options.rootSymbolId, {
		maxDepth: options.maxDepth,
		allowedPaths: options.allowedPaths,
	});
	if (nodes.length === 0) {
		return null;
	}
	const rootLocation = toDefinitionLocation(rootDecl.range);
	return {
		title: `Call Hierarchy: ${options.rootExpression}`,
		root: {
			id: `root:${rootDecl.id}`,
			kind: 'root',
			label: `${options.rootExpression} (${buildLocationLabel(rootLocation)})`,
			location: rootLocation,
			children: nodes.map(convertCallHierarchyNode),
		},
	};
}

function convertCallHierarchyNode(node: LuaIncomingCallHierarchyNode): CallHierarchyViewNode {
	const children: CallHierarchyViewNode[] = [];
	for (let index = 0; index < node.calls.length; index += 1) {
		const call = node.calls[index];
		children.push({
			id: buildCallNodeId(call),
			kind: 'call',
			label: `${call.name} (${computeSourceLabel(call.file)}:${call.range.start.line})`,
			location: toDefinitionLocation(call.range),
			children: [],
		});
	}
	for (let index = 0; index < node.children.length; index += 1) {
		children.push(convertCallHierarchyNode(node.children[index]));
	}
	return {
		id: node.caller.key,
		kind: 'caller',
		label: `${node.caller.label} (${buildLocationLabel(toDefinitionLocation(node.caller.range))})`,
		location: toDefinitionLocation(node.caller.range),
		children,
	};
}

function buildLocationLabel(location: LuaDefinitionLocation): string {
	return `${computeSourceLabel(location.path)}:${location.range.startLine}`;
}

function buildCallNodeId(call: { file: string; range: { start: { line: number; column: number }; end: { line: number; column: number } } }): string {
	return `call:${call.file}:${call.range.start.line}:${call.range.start.column}:${call.range.end.line}:${call.range.end.column}`;
}

function toDefinitionLocation(range: { path: string; start: { line: number; column: number }; end: { line: number; column: number } }): LuaDefinitionLocation {
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

function isBuiltinContextExpression(expression: string): boolean {
	const root = resolveLuaIdentifierChainRoot(expression);
	if (!root || root.length === 0) {
		return false;
	}
	const runtime = Runtime.instance;
	if (!runtime) {
		return false;
	}
	const name = root.trim();
	if (runtime.luaBuiltinMetadata.has(name)) {
		return true;
	}
	for (let index = 0; index < DEFAULT_LUA_BUILTIN_NAMES.length; index += 1) {
		if (DEFAULT_LUA_BUILTIN_NAMES[index] === name) {
			return true;
		}
	}
	return false;
}

function computeSourceLabel(path: string): string {
	const lastSlash = path.lastIndexOf('/');
	return lastSlash !== -1 && lastSlash + 1 < path.length ? path.slice(lastSlash + 1) : path;
}

function rangeToSearchMatchInBuffer(
	range: { start: { line: number; column: number }; end: { line: number; column: number } },
	buffer: TextBuffer,
): SearchMatch {
	const rowIndex = range.start.line - 1;
	if (rowIndex < 0 || rowIndex >= buffer.getLineCount()) {
		return null;
	}
	const line = buffer.getLineContent(rowIndex);
	const start = Math.max(0, Math.min(line.length, range.start.column - 1));
	const end = Math.max(start, Math.min(line.length, Math.max(start, range.end.column - 1) + 1));
	return end > start ? { row: rowIndex, start, end } : null;
}
