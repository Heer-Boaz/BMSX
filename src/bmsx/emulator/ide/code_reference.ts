import { clamp } from '../../utils/clamp';
import type { LuaDefinitionLocation, LuaSymbolEntry, ResourceDescriptor } from '../types';
import type { CodeTabContext, EditorContextMenuEntry, EditorContextToken, SearchMatch, SymbolSearchResult } from './types';
import {
	LuaSyntaxKind,
	LuaTableFieldKind,
	type LuaAssignmentStatement,
	type LuaBinaryExpression,
	type LuaBlock,
	type LuaCallExpression,
	type LuaDoStatement,
	type LuaExpression,
	type LuaForGenericStatement,
	type LuaForNumericStatement,
	type LuaFunctionDeclarationStatement,
	type LuaFunctionExpression,
	type LuaIfStatement,
	type LuaIndexExpression,
	type LuaLocalAssignmentStatement,
	type LuaLocalFunctionStatement,
	type LuaMemberExpression,
	type LuaRepeatStatement,
	type LuaReturnStatement,
	type LuaSourceRange,
	type LuaStatement,
	type LuaTableConstructorExpression,
	type LuaUnaryExpression,
	type LuaWhileStatement,
} from '../../lua/lua_ast';
import { listResources } from '../workspace';
import { Runtime } from '../runtime';
import * as runtimeLuaPipeline from '../runtime_lua_pipeline';
import { CodeLayout } from './code_layout';
import { LuaSemanticWorkspace, Decl, type Ref } from './semantic_model';
import type { TextBuffer } from './text_buffer';
import { getTextSnapshot, splitText } from './source_text';
import { getCachedLuaParse } from './lua_analysis_cache';

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
	let entries: EditorContextMenuEntry[] = [];
	if (!token) {
		return entries;
	}
	switch (token.kind) {
		case 'identifier':
			if (!isBuiltinContextExpression(token.expression)) {
				entries.push(
					{ action: 'go_to_definition', label: 'Go to Definition', enabled: true },
					{ action: 'go_to_references', label: 'Go to References', enabled: true },
					{ action: 'call_hierarchy', label: 'Show Call Hierarchy', enabled: true },
				);
			}
			break;
	}
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
	range: LuaSourceRange;
	location: LuaDefinitionLocation;
};

type CallHierarchyPathIndex = {
	positions: Set<string>;
	callerByPosition: Map<string, CallerScope>;
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
		key: '<chunk>@1:1',
		label: '<chunk>',
		range: fallbackRange,
		location: toDefinitionLocation(fallbackRange),
	};
}

function buildFunctionDeclarationLabel(statement: LuaFunctionDeclarationStatement): string {
	const identifiers = statement.name.identifiers.slice();
	if (statement.name.methodName && statement.name.methodName.length > 0) {
		identifiers.push(statement.name.methodName);
	}
	if (identifiers.length === 0) {
		return `<function ${statement.range.start.line}:${statement.range.start.column}>`;
	}
	return identifiers.join('.');
}

function collectCallerScopes(path: string, source: string): CallerScope[] {
	const chunk = getCachedLuaParse({ path, source }).parsed.chunk;
	if (!chunk) {
		return [];
	}
	const scopes: CallerScope[] = [];
	const registerScope = (label: string, range: LuaSourceRange, locationRange?: LuaSourceRange): void => {
		const location = toDefinitionLocation(locationRange ?? range);
		scopes.push({
			key: `${label}@${location.range.startLine}:${location.range.startColumn}`,
			label,
			range,
			location,
		});
	};
	const visitBlock = (block: LuaBlock): void => {
		const statements = block.body;
		for (let index = 0; index < statements.length; index += 1) {
			visitStatement(statements[index]);
		}
	};
	const visitExpression = (expression: LuaExpression): void => {
		switch (expression.kind) {
			case LuaSyntaxKind.TableConstructorExpression: {
				const table = expression as LuaTableConstructorExpression;
				for (let index = 0; index < table.fields.length; index += 1) {
					const field = table.fields[index];
					switch (field.kind) {
						case LuaTableFieldKind.Array:
							visitExpression(field.value);
							break;
						case LuaTableFieldKind.IdentifierKey:
							visitExpression(field.value);
							break;
						case LuaTableFieldKind.ExpressionKey:
							visitExpression(field.key);
							visitExpression(field.value);
							break;
					}
				}
				return;
			}
			case LuaSyntaxKind.FunctionExpression: {
				const fn = expression as LuaFunctionExpression;
				const label = `<function ${fn.range.start.line}:${fn.range.start.column}>`;
				registerScope(label, fn.range, fn.range);
				visitBlock(fn.body);
				return;
			}
			case LuaSyntaxKind.BinaryExpression: {
				const binary = expression as LuaBinaryExpression;
				visitExpression(binary.left);
				visitExpression(binary.right);
				return;
			}
			case LuaSyntaxKind.UnaryExpression: {
				const unary = expression as LuaUnaryExpression;
				visitExpression(unary.operand);
				return;
			}
			case LuaSyntaxKind.CallExpression: {
				const call = expression as LuaCallExpression;
				visitExpression(call.callee);
				for (let index = 0; index < call.arguments.length; index += 1) {
					visitExpression(call.arguments[index]);
				}
				return;
			}
			case LuaSyntaxKind.MemberExpression: {
				const member = expression as LuaMemberExpression;
				visitExpression(member.base);
				return;
			}
			case LuaSyntaxKind.IndexExpression: {
				const indexExpr = expression as LuaIndexExpression;
				visitExpression(indexExpr.base);
				visitExpression(indexExpr.index);
				return;
			}
			default:
				return;
		}
	};
	const visitStatement = (statement: LuaStatement): void => {
		switch (statement.kind) {
			case LuaSyntaxKind.LocalFunctionStatement: {
				const localFunction = statement as LuaLocalFunctionStatement;
				registerScope(localFunction.name.name, localFunction.functionExpression.range, localFunction.name.range);
				visitBlock(localFunction.functionExpression.body);
				return;
			}
			case LuaSyntaxKind.FunctionDeclarationStatement: {
				const declaration = statement as LuaFunctionDeclarationStatement;
				registerScope(buildFunctionDeclarationLabel(declaration), declaration.functionExpression.range, declaration.range);
				visitBlock(declaration.functionExpression.body);
				return;
			}
			case LuaSyntaxKind.AssignmentStatement: {
				const assignment = statement as LuaAssignmentStatement;
				for (let index = 0; index < assignment.left.length; index += 1) {
					const target = assignment.left[index];
					switch (target.kind) {
						case LuaSyntaxKind.MemberExpression:
							visitExpression((target as LuaMemberExpression).base);
							break;
						case LuaSyntaxKind.IndexExpression: {
							const indexExpr = target as LuaIndexExpression;
							visitExpression(indexExpr.base);
							visitExpression(indexExpr.index);
							break;
						}
						default:
							break;
					}
				}
				for (let index = 0; index < assignment.right.length; index += 1) {
					visitExpression(assignment.right[index]);
				}
				return;
			}
			case LuaSyntaxKind.LocalAssignmentStatement: {
				const assignment = statement as LuaLocalAssignmentStatement;
				for (let index = 0; index < assignment.values.length; index += 1) {
					visitExpression(assignment.values[index]);
				}
				return;
			}
			case LuaSyntaxKind.ReturnStatement: {
				const returnStatement = statement as LuaReturnStatement;
				for (let index = 0; index < returnStatement.expressions.length; index += 1) {
					visitExpression(returnStatement.expressions[index]);
				}
				return;
			}
			case LuaSyntaxKind.IfStatement: {
				const ifStatement = statement as LuaIfStatement;
				for (let index = 0; index < ifStatement.clauses.length; index += 1) {
					const clause = ifStatement.clauses[index];
					visitExpression(clause.condition);
					visitBlock(clause.block);
				}
				return;
			}
			case LuaSyntaxKind.WhileStatement: {
				const whileStatement = statement as LuaWhileStatement;
				visitExpression(whileStatement.condition);
				visitBlock(whileStatement.block);
				return;
			}
			case LuaSyntaxKind.RepeatStatement: {
				const repeatStatement = statement as LuaRepeatStatement;
				visitBlock(repeatStatement.block);
				visitExpression(repeatStatement.condition);
				return;
			}
			case LuaSyntaxKind.ForNumericStatement: {
				const forNumeric = statement as LuaForNumericStatement;
				visitExpression(forNumeric.start);
				visitExpression(forNumeric.limit);
				visitExpression(forNumeric.step);
				visitBlock(forNumeric.block);
				return;
			}
			case LuaSyntaxKind.ForGenericStatement: {
				const forGeneric = statement as LuaForGenericStatement;
				for (let index = 0; index < forGeneric.iterators.length; index += 1) {
					visitExpression(forGeneric.iterators[index]);
				}
				visitBlock(forGeneric.block);
				return;
			}
			case LuaSyntaxKind.DoStatement: {
				const doStatement = statement as LuaDoStatement;
				visitBlock(doStatement.block);
				return;
			}
			case LuaSyntaxKind.CallStatement:
				visitExpression((statement as { expression: LuaCallExpression }).expression);
				return;
			default:
				return;
		}
	};
	for (let index = 0; index < chunk.body.length; index += 1) {
		visitStatement(chunk.body[index]);
	}
	return scopes;
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

function resolveCallerScope(scopes: readonly CallerScope[], line: number, column: number): CallerScope {
	let best: CallerScope = null;
	for (let index = 0; index < scopes.length; index += 1) {
		const scope = scopes[index];
		if (!rangeContainsPosition(scope.range, line, column)) {
			continue;
		}
		if (!best || isRangeInside(scope.range, best.range)) {
			best = scope;
		}
	}
	return best;
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
		positions: new Set<string>(),
		callerByPosition: new Map<string, CallerScope>(),
	};
	const data = workspace.getFileData(path);
	if (!data) {
		cache.set(path, index);
		return index;
	}
	const scopes = collectCallerScopes(path, data.source);
	const refs = data.refs;
	const calls = data.callExpressions;
	for (let indexRef = 0; indexRef < refs.length; indexRef += 1) {
		const ref = refs[indexRef];
		const call = resolveCallExpressionForReference(ref, calls);
		if (!call) {
			continue;
		}
		const key = positionKey(ref.range.start.line, ref.range.start.column);
		index.positions.add(key);
		if (index.callerByPosition.has(key)) {
			continue;
		}
		const caller = resolveCallerScope(scopes, call.range.start.line, call.range.start.column) ?? buildChunkCallerScope(path);
		index.callerByPosition.set(key, caller);
	}
	cache.set(path, index);
	return index;
}

function createCallHierarchyParentEntry(caller: CallerScope, child: ReferenceCatalogEntry): ReferenceCatalogEntry {
	const childSymbol = child.symbol;
	const parentSymbol: ReferenceSymbolEntry = {
		...childSymbol,
		name: caller.label,
		location: caller.location,
	};
	const sourceLabel = computeSourceLabel(caller.location.path, child.sourceLabel);
	return {
		symbol: parentSymbol,
		displayName: caller.label,
		searchKey: `${caller.label.toLowerCase()} ${sourceLabel.toLowerCase()}`.trim(),
		line: caller.location.range.startLine,
		kindLabel: 'CALLER',
		sourceLabel,
	};
}

export function filterReferenceCatalogToCallHierarchy(
	catalog: readonly ReferenceCatalogEntry[],
	workspace: LuaSemanticWorkspace
): ReferenceCatalogEntry[] {
	const cache = new Map<string, CallHierarchyPathIndex>();
	const grouped = new Map<string, { caller: CallerScope; entries: ReferenceCatalogEntry[] }>();
	const orderedKeys: string[] = [];
	for (let index = 0; index < catalog.length; index += 1) {
		const entry = catalog[index];
		const location = entry.symbol.location;
		const path = location.path;
		if (!path) {
			continue;
		}
		const hierarchyIndex = callHierarchyIndexForPath(path, workspace, cache);
		const callKey = positionKey(location.range.startLine, location.range.startColumn);
		if (!hierarchyIndex.positions.has(callKey)) {
			continue;
		}
		const caller = hierarchyIndex.callerByPosition.get(callKey) ?? buildChunkCallerScope(path);
		const bucketKey = `${path}|${caller.key}`;
		let bucket = grouped.get(bucketKey);
		if (!bucket) {
			bucket = { caller, entries: [] };
			grouped.set(bucketKey, bucket);
			orderedKeys.push(bucketKey);
		}
		bucket.entries.push(entry);
	}
	const hierarchy: ReferenceCatalogEntry[] = [];
	for (let index = 0; index < orderedKeys.length; index += 1) {
		const bucket = grouped.get(orderedKeys[index])!;
		bucket.entries.sort((a, b) => {
			if (a.line !== b.line) {
				return a.line - b.line;
			}
			const colA = (a.symbol as ReferenceSymbolEntry).__referenceColumn;
			const colB = (b.symbol as ReferenceSymbolEntry).__referenceColumn;
			return colA - colB;
		});
		const parent = createCallHierarchyParentEntry(bucket.caller, bucket.entries[0]);
		hierarchy.push(parent);
		for (let entryIndex = 0; entryIndex < bucket.entries.length; entryIndex += 1) {
			const child = bucket.entries[entryIndex];
			hierarchy.push({
				...child,
				displayName: `  ${child.displayName}`,
				kindLabel: 'CALL',
			});
		}
	}
	return hierarchy;
}

function describeContextTokenKind(kind: EditorContextToken['kind']): string {
	switch (kind) {
		case 'keyword':
			return 'Keyword';
		case 'number':
			return 'Number';
		case 'string':
			return 'String';
		case 'operator':
			return 'Token';
		case 'identifier':
		default:
			return 'Symbol';
	}
}

function formatContextTokenPreview(text: string): string {
	const limit = 28;
	const clipped = text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
	return `'${clipped}'`;
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

	public clear(): void {
		this.matches = [];
		this.activeIndex = -1;
		this.expression = null;
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

	public apply(info: ReferenceMatchInfo, activeIndex: number): void {
		this.matches = info.matches.slice();
		if (this.matches.length === 0) {
			this.activeIndex = -1;
		} else {
			const clampedIndex = clamp(activeIndex, 0, this.matches.length - 1);
			this.activeIndex = clampedIndex;
		}
		this.expression = info.expression;
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
