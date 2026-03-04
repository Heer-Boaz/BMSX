import { clamp } from '../../utils/clamp';
import type { LuaDefinitionLocation, LuaSymbolEntry } from '../types';
import type { CodeTabContext, EditorContextMenuEntry, EditorContextToken, SearchMatch, SymbolSearchResult } from './types';
import {
	LuaSyntaxKind,
	type LuaCallExpression,
	type LuaMemberExpression,
	type LuaSourceRange,
} from '../../lua/lua_ast';
import { listResources } from '../workspace';
import { Runtime } from '../runtime';
import * as runtimeLuaPipeline from '../runtime_lua_pipeline';
import { CodeLayout } from './code_layout';
import { LuaSemanticWorkspace, Decl, type Ref, type SymbolID } from './semantic_model';
import type { TextBuffer } from './text_buffer';
import { getTextSnapshot, splitText } from './source_text';

export type ProjectReferenceEnvironment = {
	activeContext: CodeTabContext;
	activeLines: readonly string[];
	codeTabContexts: Iterable<CodeTabContext>;
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

export function computeSourceLabel(path: string, fallback: string): string {
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

export function buildEditorContextMenuEntries(token: EditorContextToken, editable: boolean): EditorContextMenuEntry[] {
	if (!token || token.kind !== 'identifier' || !token.expression || token.expression.length === 0) {
		return [];
	}
	if (isBuiltinContextExpression(token.expression)) {
		return [];
	}
	const entries: EditorContextMenuEntry[] = [
		{ action: 'go_to_definition', label: 'Go to Definition', enabled: true },
		{ action: 'go_to_references', label: 'Go to References', enabled: true },
		{ action: 'call_hierarchy', label: 'Show Call Hierarchy', enabled: true },
	];
	if (editable) {
		entries.push({ action: 'rename_symbol', label: 'Rename Symbol', enabled: true });
	}
	return entries;
}

function isBuiltinContextExpression(expression: string): boolean {
	const root = expression.split('.', 1)[0].trim().toLowerCase();
	if (root.length === 0) {
		return false;
	}
	return Runtime.instance.luaBuiltinMetadata.has(root);
}

type CallerScope = {
	key: string;
	label: string;
	location: LuaDefinitionLocation;
	symbolId: SymbolID;
};

type CallHierarchyPathIndex = {
	callByPosition: Map<string, LuaCallExpression>;
	callerByPosition: Map<string, CallerScope>;
};

type IncomingCallerGroup = {
	caller: CallerScope;
	calls: Ref[];
};

type IncomingCallHierarchyNode = {
	caller: CallerScope;
	calls: Ref[];
	children: IncomingCallHierarchyNode[];
};

type BuildIncomingCallHierarchyCatalogOptions = {
	workspace: LuaSemanticWorkspace;
	rootSymbolId: SymbolID;
	rootExpression: string;
	maxDepth?: number;
};

function rangeContainsPosition(range: LuaSourceRange, line: number, column: number): boolean {
	if (line < range.start.line || line > range.end.line) {
		return false;
	}
	if (line === range.start.line && column < range.start.column) {
		return false;
	}
	if (line === range.end.line && column > range.end.column) {
		return false;
	}
	return true;
}

function positionKey(line: number, column: number): string {
	return `${line}:${column}`;
}

function comparePositions(
	lineA: number,
	columnA: number,
	lineB: number,
	columnB: number
): number {
	if (lineA !== lineB) {
		return lineA - lineB;
	}
	return columnA - columnB;
}

function isRangeInside(inner: LuaSourceRange, outer: LuaSourceRange): boolean {
	return comparePositions(inner.start.line, inner.start.column, outer.start.line, outer.start.column) >= 0
		&& comparePositions(inner.end.line, inner.end.column, outer.end.line, outer.end.column) <= 0;
}

function toDefinitionLocation(range: LuaSourceRange): LuaDefinitionLocation {
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

function buildChunkCallerScope(path: string): CallerScope {
	const fallbackRange: LuaSourceRange = {
		path,
		start: { line: 1, column: 1 },
		end: { line: 1, column: 1 },
	};
	return {
		key: `chunk:${path}`,
		label: '<chunk>',
		location: toDefinitionLocation(fallbackRange),
		symbolId: null,
	};
}

function buildDeclCallerScope(decl: Decl): CallerScope {
	const label = decl.namePath.length > 0 ? decl.namePath.join('.') : decl.name;
	return {
		key: `decl:${decl.id}`,
		label,
		location: toDefinitionLocation(decl.range),
		symbolId: decl.id,
	};
}

function resolveCallerDeclaration(functionDecls: readonly Decl[], line: number, column: number): Decl {
	let best: Decl = null;
	for (let index = 0; index < functionDecls.length; index += 1) {
		const decl = functionDecls[index];
		if (!rangeContainsPosition(decl.scope, line, column)) {
			continue;
		}
		if (!best || isRangeInside(decl.scope, best.scope)) {
			best = decl;
		}
	}
	return best;
}

function resolveCallExpressionForReference(ref: Ref, calls: readonly LuaCallExpression[]): LuaCallExpression {
	if (ref.isWrite) {
		return null;
	}
	for (let index = 0; index < calls.length; index += 1) {
		const call = calls[index];
		if (call.methodName) {
			if (ref.name !== call.methodName) {
				continue;
			}
			if (rangeContainsPosition(call.range, ref.range.start.line, ref.range.start.column)) {
				return call;
			}
			continue;
		}
		if (!rangeContainsPosition(call.callee.range, ref.range.start.line, ref.range.start.column)) {
			continue;
		}
		if (call.callee.kind === LuaSyntaxKind.MemberExpression) {
			const member = call.callee as LuaMemberExpression;
			const expectedLine = member.range.end.line;
			const expectedColumn = member.range.end.column - member.identifier.length + 1;
			if (ref.range.start.line !== expectedLine || ref.range.start.column !== expectedColumn) {
				continue;
			}
		}
		return call;
	}
	return null;
}

function callHierarchyIndexForPath(
	path: string,
	workspace: LuaSemanticWorkspace,
	cache: Map<string, CallHierarchyPathIndex>
): CallHierarchyPathIndex {
	const cached = cache.get(path);
	if (cached) {
		return cached;
	}
	const index: CallHierarchyPathIndex = {
		callByPosition: new Map<string, LuaCallExpression>(),
		callerByPosition: new Map<string, CallerScope>(),
	};
	const data = workspace.getFileData(path);
	if (!data) {
		cache.set(path, index);
		return index;
	}
	const functionDecls: Decl[] = [];
	for (let indexDecl = 0; indexDecl < data.decls.length; indexDecl += 1) {
		const decl = data.decls[indexDecl];
		if (decl.kind === 'function') {
			functionDecls.push(decl);
		}
	}
	const refs = data.refs;
	const calls = data.callExpressions;
	for (let indexRef = 0; indexRef < refs.length; indexRef += 1) {
		const ref = refs[indexRef];
		const call = resolveCallExpressionForReference(ref, calls);
		if (!call) {
			continue;
		}
		const key = positionKey(ref.range.start.line, ref.range.start.column);
		index.callByPosition.set(key, call);
		if (index.callerByPosition.has(key)) {
			continue;
		}
		const callerDecl = resolveCallerDeclaration(functionDecls, call.range.start.line, call.range.start.column);
		const caller = callerDecl ? buildDeclCallerScope(callerDecl) : buildChunkCallerScope(path);
		index.callerByPosition.set(key, caller);
	}
	cache.set(path, index);
	return index;
}

function createCallHierarchyCallerEntry(caller: CallerScope, depth: number, referenceIndex: number): ReferenceCatalogEntry {
	const range = caller.location.range;
	const startRow = Math.max(0, range.startLine - 1);
	const startColumn = Math.max(0, range.startColumn - 1);
	const endColumn = Math.max(startColumn + 1, range.endColumn);
	const symbol: ReferenceSymbolEntry = {
		name: caller.label,
		location: caller.location,
		path: computeSourceLabel(caller.location.path, caller.location.path),
		kind: 'assignment',
		__referenceMatch: { row: startRow, start: startColumn, end: endColumn },
		__referenceIndex: referenceIndex,
		__referenceColumn: range.startColumn,
	};
	const sourceLabel = computeSourceLabel(caller.location.path, caller.location.path);
	const indent = depth > 0 ? '  '.repeat(depth) : '';
	return {
		symbol,
		displayName: `${indent}${caller.label}`,
		searchKey: `${caller.label.toLowerCase()} ${sourceLabel.toLowerCase()}`.trim(),
		line: range.startLine,
		kindLabel: 'CALLER',
		sourceLabel,
	};
}

function createCallHierarchyRootEntry(decl: Decl, expression: string): ReferenceCatalogEntry {
	const location = toDefinitionLocation(decl.range);
	const sourceLabel = computeSourceLabel(location.path, location.path);
	const startRow = Math.max(0, location.range.startLine - 1);
	const startColumn = Math.max(0, location.range.startColumn - 1);
	const endColumn = Math.max(startColumn + 1, location.range.endColumn);
	const label = `Incoming Call Hierarchy: ${expression}`;
	const symbol: ReferenceSymbolEntry = {
		name: expression,
		location,
		path: sourceLabel,
		kind: 'assignment',
		__referenceMatch: { row: startRow, start: startColumn, end: endColumn },
		__referenceIndex: 0,
		__referenceColumn: location.range.startColumn,
	};
	return {
		symbol,
		displayName: label,
		searchKey: `${expression.toLowerCase()} ${sourceLabel.toLowerCase()} incoming call hierarchy`.trim(),
		line: location.range.startLine,
		kindLabel: 'ROOT',
		sourceLabel,
	};
}

function ensureWorkspaceFileMetadata(path: string, workspace: LuaSemanticWorkspace, metadata: Map<string, FileMetadata>): FileMetadata {
	const existing = metadata.get(path);
	if (existing) {
		return existing;
	}
	const data = workspace.getFileData(path);
	if (!data) {
		return null;
	}
	const meta: FileMetadata = {
		path,
		lines: data.lines,
		sourceLabel: computeSourceLabel(path, path),
	};
	metadata.set(path, meta);
	return meta;
}

function createCallHierarchyCallEntry(
	workspace: LuaSemanticWorkspace,
	metadata: Map<string, FileMetadata>,
	reference: Ref,
	expression: string,
	referenceIndex: number
): ReferenceCatalogEntry {
	const meta = ensureWorkspaceFileMetadata(reference.file, workspace, metadata);
	if (!meta) {
		return null;
	}
	const match = rangeToSearchMatch(reference.range, meta.lines);
	if (!match) {
		return null;
	}
	return createCatalogEntry({
		meta,
		match,
		range: toRangeLike(reference.range),
		expression,
		referenceIndex,
	});
}

function compareCallerScope(a: CallerScope, b: CallerScope): number {
	const pathA = a.location.path;
	const pathB = b.location.path;
	const pathDiff = pathA.localeCompare(pathB);
	if (pathDiff !== 0) {
		return pathDiff;
	}
	const lineDiff = a.location.range.startLine - b.location.range.startLine;
	if (lineDiff !== 0) {
		return lineDiff;
	}
	const columnDiff = a.location.range.startColumn - b.location.range.startColumn;
	if (columnDiff !== 0) {
		return columnDiff;
	}
	return a.label.localeCompare(b.label);
}

function collectIncomingCallerGroups(
	symbolId: SymbolID,
	workspace: LuaSemanticWorkspace,
	pathCache: Map<string, CallHierarchyPathIndex>
): IncomingCallerGroup[] {
	const grouped = new Map<string, { caller: CallerScope; calls: Ref[] }>();
	const references = workspace.getReferences(symbolId);
	for (let index = 0; index < references.length; index += 1) {
		const reference = references[index];
		const path = reference.file;
		if (!path || reference.isWrite) {
			continue;
		}
		const hierarchyIndex = callHierarchyIndexForPath(path, workspace, pathCache);
		const callKey = positionKey(reference.range.start.line, reference.range.start.column);
		if (!hierarchyIndex.callByPosition.has(callKey)) {
			continue;
		}
		const caller = hierarchyIndex.callerByPosition.get(callKey) ?? buildChunkCallerScope(path);
		const bucketKey = `${path}|${caller.key}`;
		let bucket = grouped.get(bucketKey);
		if (!bucket) {
			bucket = { caller, calls: [] };
			grouped.set(bucketKey, bucket);
		}
		bucket.calls.push(reference);
	}
	const groups: IncomingCallerGroup[] = [];
	for (const bucket of grouped.values()) {
		const calls = bucket.calls;
		calls.sort((a, b) => comparePositions(a.range.start.line, a.range.start.column, b.range.start.line, b.range.start.column));
		groups.push({ caller: bucket.caller, calls });
	}
	groups.sort((a, b) => compareCallerScope(a.caller, b.caller));
	return groups;
}

function buildIncomingCallHierarchyNodes(
	symbolId: SymbolID,
	workspace: LuaSemanticWorkspace,
	pathCache: Map<string, CallHierarchyPathIndex>,
	visited: Set<SymbolID>,
	depth: number,
	maxDepth: number
): IncomingCallHierarchyNode[] {
	if (depth >= maxDepth) {
		return [];
	}
	const groups = collectIncomingCallerGroups(symbolId, workspace, pathCache);
	const nodes: IncomingCallHierarchyNode[] = [];
	for (let index = 0; index < groups.length; index += 1) {
		const group = groups[index];
		let children: IncomingCallHierarchyNode[] = [];
		const callerSymbolId = group.caller.symbolId;
		if (callerSymbolId && !visited.has(callerSymbolId)) {
			visited.add(callerSymbolId);
			children = buildIncomingCallHierarchyNodes(callerSymbolId, workspace, pathCache, visited, depth + 1, maxDepth);
			visited.delete(callerSymbolId);
		}
		nodes.push({
			caller: group.caller,
			calls: group.calls,
			children,
		});
	}
	return nodes;
}

function appendHierarchyNodesToCatalog(options: {
	nodes: readonly IncomingCallHierarchyNode[];
	workspace: LuaSemanticWorkspace;
	metadata: Map<string, FileMetadata>;
	entries: ReferenceCatalogEntry[];
	rootExpression: string;
	depth: number;
	nextReferenceIndex: { value: number };
}): void {
	const { nodes, workspace, metadata, entries, rootExpression, depth, nextReferenceIndex } = options;
	for (let index = 0; index < nodes.length; index += 1) {
		const node = nodes[index];
		entries.push(createCallHierarchyCallerEntry(node.caller, depth, nextReferenceIndex.value));
		nextReferenceIndex.value += 1;
		for (let callIndex = 0; callIndex < node.calls.length; callIndex += 1) {
			const call = node.calls[callIndex];
			const callEntry = createCallHierarchyCallEntry(
				workspace,
				metadata,
				call,
				rootExpression,
				nextReferenceIndex.value
			);
			if (!callEntry) {
				continue;
			}
			const indent = '  '.repeat(depth + 1);
			entries.push({
				...callEntry,
				displayName: `${indent}${callEntry.displayName}`,
				searchKey: `${callEntry.searchKey} ${node.caller.label.toLowerCase()}`.trim(),
				kindLabel: 'CALL',
			});
			nextReferenceIndex.value += 1;
		}
		if (node.children.length > 0) {
			appendHierarchyNodesToCatalog({
				nodes: node.children,
				workspace,
				metadata,
				entries,
				rootExpression,
				depth: depth + 1,
				nextReferenceIndex,
			});
		}
	}
}

export function buildIncomingCallHierarchyCatalog(options: BuildIncomingCallHierarchyCatalogOptions): ReferenceCatalogEntry[] {
	const { workspace, rootSymbolId, rootExpression } = options;
	const maxDepth = options.maxDepth ?? 8;
	const rootDecl = workspace.getDecl(rootSymbolId);
	if (!rootDecl) {
		return [];
	}
	const pathCache = new Map<string, CallHierarchyPathIndex>();
	const visited = new Set<SymbolID>([rootSymbolId]);
	const nodes = buildIncomingCallHierarchyNodes(rootSymbolId, workspace, pathCache, visited, 0, maxDepth);
	if (nodes.length === 0) {
		return [];
	}
	const entries: ReferenceCatalogEntry[] = [createCallHierarchyRootEntry(rootDecl, rootExpression)];
	const metadata = new Map<string, FileMetadata>();
	const nextReferenceIndex = { value: 1 };
	appendHierarchyNodesToCatalog({
		nodes,
		workspace,
		metadata,
		entries,
		rootExpression,
		depth: 0,
		nextReferenceIndex,
	});
	return entries;
}

type FileMetadata = {
	path: string;
	lines: readonly string[];
	sourceLabel: string;
};

type CollectMetadataOptions = {
	workspace: LuaSemanticWorkspace;
	environment: ProjectReferenceEnvironment;
	currentPath: string;
	currentLines: readonly string[];
};

type BuildReferenceCatalogOptions = {
	workspace: LuaSemanticWorkspace;
	info: ReferenceMatchInfo;
	lines: readonly string[];
	path: string;
	environment: ProjectReferenceEnvironment;
};

type ResolveDefinitionLocationOptions = {
	expression: string;
	environment: ProjectReferenceEnvironment;
	workspace: LuaSemanticWorkspace;
	currentPath: string;
	currentLines: readonly string[];
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
	const { workspace, info, lines, path, environment } = options;
	const metadata = collectFileMetadata({
		workspace,
		environment,
		currentPath: path,
		currentLines: lines,
	});
	const entries: ReferenceCatalogEntry[] = [];
	const existingKeys: Set<string> = new Set();
	let nextIndex = 0;
	const baseMeta = metadata.get(path);
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

export function resolveDefinitionLocationForExpression(options: ResolveDefinitionLocationOptions): LuaDefinitionLocation {
	const { expression, environment, workspace, currentPath, currentLines } = options;
	const namePath = expression.split('.').filter(part => part.length > 0);
	if (namePath.length === 0) {
		return null;
	}
	const metadata = collectFileMetadata({
		workspace,
		environment,
		currentPath,
		currentLines,
	});
	let bestDecl: Decl = null;
	let bestMeta: FileMetadata = null;
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
	const location: LuaDefinitionLocation = {
		path: bestMeta.path,
		range: {
			startLine: range.start.line,
			startColumn: range.start.column,
			endLine: range.end.line,
			endColumn: range.end.column,
		},
	};
	if (bestMeta.path) {
		location.path = bestMeta.path;
	} else if (bestMeta.path && bestMeta.path !== '<anynomous>') {
		location.path = bestMeta.path;
	}
	return location;
}

export function referenceEntryKey(entry: ReferenceCatalogEntry): string {
	const location = entry.symbol.location;
	const range = location.range;
	const path = location.path ?? '<anynomous>';
	return `${path}:${range.startLine}:${range.startColumn}`;
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
	const { workspace, environment, currentPath, currentLines } = options;
	const metadata: Map<string, FileMetadata> = new Map();
	const register = (path: string, lines: readonly string[], labelHint: string, version?: number): void => {
		if (metadata.has(path)) {
			return;
		}
		const sourceLabel = computeSourceLabel(labelHint ?? path ?? path, path);
		workspace.updateFile(path, lines.join('\n'), lines, null, version);
		metadata.set(path, {
			path,
			lines,
			sourceLabel,
		});
	};
	register(currentPath, currentLines, null, environment.activeContext.textVersion);
	const activeContext = environment.activeContext;
	const contexts = Array.from(environment.codeTabContexts);
	for (let index = 0; index < contexts.length; index += 1) {
		const context = contexts[index];
		const descriptor = context.descriptor;
		const path = descriptor.path;
		if (metadata.has(path)) {
			continue;
		}
		let lines: readonly string[] = null;
		if (activeContext && context === activeContext) {
			lines = environment.activeLines;
		} else {
			const source = getTextSnapshot(context.buffer);
			lines = splitText(source);
		}
		if (!lines || lines.length === 0) {
			continue;
		}
		register(path, lines, null, context.textVersion);
	}
	const descriptors = listResources();
	for (let index = 0; index < descriptors.length; index += 1) {
		const descriptor = descriptors[index];
		if (!(descriptor.type === 'lua' || descriptor.path.endsWith('.lua'))) {
			continue;
		}
		const path = descriptor.path;
		if (metadata.has(path)) {
			continue;
		}
		const source = runtimeLuaPipeline.resourceSourceForChunk(Runtime.instance, path);
		const lines = splitText(source);
		if (!lines || lines.length === 0) {
			continue;
		}
		register(path, lines, null, null);
	}
	return metadata;
}

function toRangeLike(range: { start: { line: number; column: number }; end: { line: number; column: number } }): LuaSourceRangeLike {
	return {
		startLine: range.start.line,
		startColumn: range.start.column,
		endLine: range.end.line,
		endColumn: range.end.column,
	};
}

function buildReferenceSnippet(lines: readonly string[], match: SearchMatch): string {
	const line = lines[match.row] ?? '';
	const start = clamp(match.start - 20, 0, line.length);
	const end = clamp(match.end + 20, start, line.length);
	const snippet = line.slice(start, end).trim();
	return snippet.length > 0 ? snippet : line.trim();
}

function createCatalogEntry(args: CatalogEntryArgs): ReferenceCatalogEntry {
	const { meta, match, range, expression, referenceIndex } = args;
	const snippet = buildReferenceSnippet(meta.lines, match);
	const symbolName = expression.length > 0 ? expression : snippet;
	const location: LuaDefinitionLocation = {
		path: meta.path,
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
export type ExtractIdentifierExpression = (row: number, column: number) => { expression: string; startColumn: number; endColumn: number; };

export type ReferenceLookupOptions = {
	layout: CodeLayout;
	workspace: LuaSemanticWorkspace;
	buffer: TextBuffer;
	textVersion: number;
	cursorRow: number;
	cursorColumn: number;
	extractExpression: ExtractIdentifierExpression;
	path: string;
};

export type ReferenceMatchInfo = {
	matches: SearchMatch[];
	expression: string;
	definitionKey: string;
	documentVersion: number;
};

export type ReferenceLookupResult = { kind: 'success'; info: ReferenceMatchInfo; initialIndex: number; } |
{ kind: 'error'; message: string; duration: number; };

export class ReferenceState {
	private matches: SearchMatch[] = [];
	private activeIndex = -1;
	private expression: string = null;
	private definitionKey: string = null;

	public clear(): void {
		this.matches = [];
		this.activeIndex = -1;
		this.expression = null;
		this.definitionKey = null;
	}

	public getMatches(): readonly SearchMatch[] {
		return this.matches;
	}

	public getActiveIndex(): number {
		return this.activeIndex;
	}

	public getExpression(): string {
		return this.expression;
	}

	public getDefinitionKey(): string {
		return this.definitionKey;
	}

	public apply(info: ReferenceMatchInfo, activeIndex: number): void {
		this.matches = info.matches.slice();
		if (this.matches.length === 0) {
			this.activeIndex = -1;
		} else {
			const clampedIndex = clamp(activeIndex, 0, this.matches.length - 1);
			this.activeIndex = clampedIndex;
		}
		this.expression = info.expression;
		this.definitionKey = info.definitionKey;
	}

	public setActiveIndex(index: number): void {
		if (this.matches.length === 0) {
			this.activeIndex = -1;
			return;
		}
		this.activeIndex = clamp(index, 0, this.matches.length - 1);
	}
}

export function resolveReferenceLookup(options: ReferenceLookupOptions): ReferenceLookupResult {
	const {
		layout, workspace, buffer, textVersion, cursorRow, cursorColumn, extractExpression, path,
	} = options;
	const model = layout.getSemanticModel(buffer, textVersion, path);
	if (!model) {
		return { kind: 'error', message: 'References unavailable', duration: 1.6 };
	}
	const identifier = extractExpression(cursorRow, cursorColumn);
	if (!identifier) {
		return { kind: 'error', message: 'No identifier at cursor', duration: 1.6 };
	}
	const resolution = workspace.findReferencesByPosition(path, cursorRow + 1, cursorColumn + 1);
	if (!resolution) {
		return {
			kind: 'error',
			message: `Definition not found for ${identifier.expression}`,
			duration: 1.8,
		};
	}
	const matches: SearchMatch[] = [];
	const seen = new Set<string>();
	const definitionRange = resolution.decl.range;
	if (definitionRange.path === path) {
		const definitionMatch = rangeToSearchMatchInBuffer(definitionRange, buffer);
		if (definitionMatch) {
			const key = `${definitionMatch.row}:${definitionMatch.start}`;
			seen.add(key);
			matches.push(definitionMatch);
		}
	}
	const references = resolution.references;
	for (let index = 0; index < references.length; index += 1) {
		const reference = references[index];
		if (reference.file !== path) {
			continue;
		}
		const match = rangeToSearchMatchInBuffer(reference.range, buffer);
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
	matches.sort((a, b) => {
		if (a.row !== b.row) {
			return a.row - b.row;
		}
		return a.start - b.start;
	});
	let initialIndex = 0;
	for (let index = 0; index < matches.length; index += 1) {
		const match = matches[index];
		if (match.row === cursorRow && cursorColumn >= match.start && cursorColumn < match.end) {
			initialIndex = index;
			break;
		}
	}
	const info: ReferenceMatchInfo = {
		matches,
		expression: identifier.expression,
		definitionKey: resolution.id,
		documentVersion: textVersion,
	};
	return { kind: 'success', info, initialIndex };
}

function rangeToSearchMatchInBuffer(range: LuaSourceRange, buffer: TextBuffer): SearchMatch {
	const rowIndex = range.start.line - 1;
	const lineCount = buffer.getLineCount();
	if (rowIndex < 0 || rowIndex >= lineCount) {
		return null;
	}
	const line = buffer.getLineContent(rowIndex);
	return rangeToSearchMatchForLine(range, line, rowIndex);
}

function rangeToSearchMatch(range: LuaSourceRange, lines: readonly string[]): SearchMatch {
	const rowIndex = range.start.line - 1;
	if (rowIndex < 0 || rowIndex >= lines.length) {
		return null;
	}
	const line = lines[rowIndex] ?? '';
	return rangeToSearchMatchForLine(range, line, rowIndex);
}

function rangeToSearchMatchForLine(range: LuaSourceRange, line: string, rowIndex: number): SearchMatch {
	const startColumn = clamp(range.start.column - 1, 0, line.length);
	const endInclusive = Math.max(startColumn, range.end.column - 1);
	const endExclusive = clamp(endInclusive + 1, startColumn, line.length);
	if (endExclusive <= startColumn) {
		return null;
	}
	return { row: rowIndex, start: startColumn, end: endExclusive };
}
