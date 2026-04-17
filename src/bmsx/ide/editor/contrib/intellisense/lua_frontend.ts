import { LuaSyntaxKind, type LuaCallExpression, type LuaChunk, type LuaIdentifierExpression, type LuaSourceRange, type LuaStringLiteralExpression } from '../../../../lua/syntax/ast';
import { LuaTokenType } from '../../../../lua/syntax/token';
import type { LuaBuiltinDescriptor, LuaSymbolEntry } from '../../../../machine/runtime/contracts';
import type { ParsedLuaChunk } from '../../../language/lua/parse';
import {
	buildLuaSemanticWorkspaceSnapshot,
	type Decl,
	type FileSemanticData,
	type LuaSemanticWorkspaceSnapshot,
	type Ref,
	type SymbolID,
} from './semantic_model';
import { buildModuleAliasesFromPaths } from '../../../../machine/program/asset';
import {
	computeLuaDiagnosticsFromAnalysis,
	getDefaultLuaBuiltinDescriptors,
	getStaticLuaApiSignatureMap,
	type LuaApiSignatureMetadata,
	type LuaStaticDiagnostic,
} from './static_diagnostics';

const RESERVED_MEMORY_MAP_NAMES = ['mem', 'mem8', 'mem16le', 'mem32le', 'memf32le', 'memf64le'] as const;
const RESERVED_INTRINSIC_NAMES = ['memwrite'] as const;

export type LuaSemanticFrontendSource = {
	path: string;
	source: string;
	version?: number;
	lines?: readonly string[];
	parsed?: ParsedLuaChunk;
	chunk?: LuaChunk;
	analysis?: FileSemanticData;
};

export type LuaSemanticFrontendOptions = {
	builtinDescriptors?: readonly LuaBuiltinDescriptor[];
	apiSignatures?: ReadonlyMap<string, LuaApiSignatureMetadata>;
	extraGlobalNames?: readonly string[];
	externalGlobalSymbols?: readonly LuaSymbolEntry[];
};

export type LuaBoundReferenceKind = 'lexical' | 'global' | 'map' | 'reserved_intrinsic' | 'unresolved';

export type LuaBoundReference = {
	kind: LuaBoundReferenceKind;
	ref: Ref;
	decl: Decl;
	isImplicitGlobal: boolean;
};

export type LuaSemanticNavigationTarget = {
	kind: 'declaration' | 'require_module';
	range: LuaSourceRange;
	moduleName?: string;
};

export type LuaSemanticResolution = {
	id: SymbolID;
	decl: Decl;
	references: readonly Ref[];
};

export type LuaCallHierarchyCaller = {
	key: string;
	label: string;
	symbolId: SymbolID;
	range: LuaSourceRange;
};

export type LuaIncomingCallHierarchyNode = {
	caller: LuaCallHierarchyCaller;
	calls: readonly Ref[];
	children: readonly LuaIncomingCallHierarchyNode[];
};

export type LuaSemanticFrontendFile = {
	diagnostics: readonly LuaStaticDiagnostic[];
	getDeclaration(range: LuaSourceRange): Decl;
	getReference(range: LuaSourceRange): LuaBoundReference;
	getNavigationTargetAt(line: number, column: number): LuaSemanticNavigationTarget;
	findFirstReferenceByStartRange(
		start: LuaSourceRange['start'],
		endExclusive: LuaSourceRange['start'],
	): LuaBoundReference | null;
	findLastReferenceByStartRange(
		start: LuaSourceRange['start'],
		endExclusive: LuaSourceRange['start'],
	): LuaBoundReference | null;
};

export type LuaSemanticFrontend = {
	files: ReadonlyMap<string, LuaSemanticFrontendFile>;
	getFile(path: string): LuaSemanticFrontendFile;
	listFiles(): string[];
	getDecl(symbolId: SymbolID): Decl;
	getReferences(symbolId: SymbolID): readonly Ref[];
	listGlobalDecls(): readonly Decl[];
	findDeclarationsByNamePath(namePath: readonly string[]): readonly Decl[];
	getNavigationTargetAt(path: string, line: number, column: number): LuaSemanticNavigationTarget;
	findReferencesByPosition(path: string, line: number, column: number): LuaSemanticResolution;
	buildIncomingCallHierarchy(
		rootSymbolId: SymbolID,
		options?: {
			maxDepth?: number;
			allowedPaths?: ReadonlySet<string>;
		},
	): readonly LuaIncomingCallHierarchyNode[];
};

type PreparedSource = {
	path: string;
	chunk: LuaChunk;
	analysis: FileSemanticData;
	parsed: ParsedLuaChunk;
};

export function buildLuaSemanticFrontend(
	sources: ReadonlyArray<LuaSemanticFrontendSource>,
	options: LuaSemanticFrontendOptions = {},
): LuaSemanticFrontend {
	const builtinDescriptors = options.builtinDescriptors ?? getDefaultLuaBuiltinDescriptors();
	const apiSignatures = options.apiSignatures ?? getStaticLuaApiSignatureMap();
	const snapshot = buildLuaSemanticWorkspaceSnapshot(sources);
	const preparedSources = snapshot.sources.map(source => ({
		path: source.path,
		chunk: source.chunk,
		analysis: source.analysis,
		parsed: source.parsed,
	}));
	const files = new Map<string, LuaSemanticFrontendFile>();
	const sourcesByPath = new Map<string, PreparedSource>();
	for (let index = 0; index < preparedSources.length; index += 1) {
		const source = preparedSources[index];
		sourcesByPath.set(source.path, source);
	}
	// Frontend queries must resolve against the prepared snapshot, not whatever the workspace becomes later.
	const globalSymbols = buildCombinedGlobalSymbols(snapshot.listGlobalDecls(), options.externalGlobalSymbols);
	const knownGlobalNames = buildKnownGlobalNameSet(globalSymbols, builtinDescriptors, apiSignatures, options.extraGlobalNames);
	const moduleTargetsByAlias = buildModuleTargetAliasMap(preparedSources);
	for (let index = 0; index < preparedSources.length; index += 1) {
		const source = preparedSources[index];
		const diagnostics = computeLuaDiagnosticsFromAnalysis({
			analysis: source.analysis,
			chunk: source.chunk,
			globalSymbols,
			builtinDescriptors,
			apiSignatures,
			extraGlobalNames: options.extraGlobalNames,
		});
		files.set(source.path, createBoundFile(source, diagnostics, knownGlobalNames, moduleTargetsByAlias, sourcesByPath, snapshot));
	}
	return {
		files,
		getFile(path: string): LuaSemanticFrontendFile {
			const file = files.get(path);
			if (!file) {
				throw new Error(`[LuaSemanticFrontend] Missing semantic file '${path}'.`);
			}
			return file;
		},
		listFiles(): string[] {
			return preparedSources.map(source => source.path);
		},
		getDecl(symbolId: SymbolID): Decl {
			return snapshot.getDecl(symbolId);
		},
		getReferences(symbolId: SymbolID): readonly Ref[] {
			return snapshot.getReferences(symbolId);
		},
		listGlobalDecls(): readonly Decl[] {
			return snapshot.listGlobalDecls();
		},
		findDeclarationsByNamePath(namePath: readonly string[]): readonly Decl[] {
			const matches: Decl[] = [];
			for (let index = 0; index < preparedSources.length; index += 1) {
				const fileDecls = preparedSources[index].analysis.decls;
				for (let declIndex = 0; declIndex < fileDecls.length; declIndex += 1) {
					const decl = fileDecls[declIndex];
					if (namePathMatches(decl.namePath, namePath)) {
						matches.push(decl);
					}
				}
			}
			return matches;
		},
		getNavigationTargetAt(path: string, line: number, column: number): LuaSemanticNavigationTarget {
			const file = files.get(path);
			return file ? file.getNavigationTargetAt(line, column) : null;
		},
		findReferencesByPosition(path: string, line: number, column: number): LuaSemanticResolution {
			const source = sourcesByPath.get(path);
			if (!source) {
				return null;
			}
			for (let index = 0; index < source.analysis.decls.length; index += 1) {
				const decl = source.analysis.decls[index];
				if (positionInRange(line, column, decl.range)) {
					return {
						id: decl.id,
						decl,
						references: snapshot.getReferences(decl.id),
					};
				}
			}
			for (let index = 0; index < source.analysis.refs.length; index += 1) {
				const ref = source.analysis.refs[index];
				if (!ref.target || !positionInRange(line, column, ref.range)) {
					continue;
				}
				const decl = snapshot.getDecl(ref.target);
				if (!decl) {
					continue;
				}
				return {
					id: ref.target,
					decl,
					references: snapshot.getReferences(ref.target),
				};
			}
			return null;
		},
		buildIncomingCallHierarchy(
			rootSymbolId: SymbolID,
			options?: {
				maxDepth?: number;
				allowedPaths?: ReadonlySet<string>;
			},
		): readonly LuaIncomingCallHierarchyNode[] {
			const rootDecl = snapshot.getDecl(rootSymbolId);
			if (!rootDecl) {
				return [];
			}
			const maxDepth = options?.maxDepth ?? 8;
			const pathCache = new Map<string, CallHierarchyPathIndex>();
			const visited = new Set<SymbolID>([rootSymbolId]);
			return buildIncomingCallHierarchyNodes({
				symbolId: rootSymbolId,
				sourcesByPath,
				getReferences: (symbolId) => snapshot.getReferences(symbolId),
				getDecl: (symbolId) => snapshot.getDecl(symbolId),
				pathCache,
				visited,
				depth: 0,
				maxDepth,
				allowedPaths: options?.allowedPaths ?? null,
			});
		},
	};
}

type CallHierarchyPathIndex = {
	callByPosition: Map<string, LuaCallExpression>;
	callerByPosition: Map<string, LuaCallHierarchyCaller>;
};

type IncomingCallerGroup = {
	caller: LuaCallHierarchyCaller;
	calls: Ref[];
};

function buildIncomingCallHierarchyNodes(options: {
	symbolId: SymbolID;
	sourcesByPath: ReadonlyMap<string, PreparedSource>;
	getReferences: (symbolId: SymbolID) => readonly Ref[];
	getDecl: (symbolId: SymbolID) => Decl;
	pathCache: Map<string, CallHierarchyPathIndex>;
	visited: Set<SymbolID>;
	depth: number;
	maxDepth: number;
	allowedPaths: ReadonlySet<string> | null;
}): readonly LuaIncomingCallHierarchyNode[] {
	if (options.depth >= options.maxDepth) {
		return [];
	}
	const groups = collectIncomingCallerGroups(options);
	const nodes: LuaIncomingCallHierarchyNode[] = [];
	for (let index = 0; index < groups.length; index += 1) {
		const group = groups[index];
		let children: readonly LuaIncomingCallHierarchyNode[] = [];
		if (group.caller.symbolId && !options.visited.has(group.caller.symbolId)) {
			options.visited.add(group.caller.symbolId);
			children = buildIncomingCallHierarchyNodes({
				...options,
				symbolId: group.caller.symbolId,
				depth: options.depth + 1,
			});
			options.visited.delete(group.caller.symbolId);
		}
		nodes.push({
			caller: group.caller,
			calls: group.calls,
			children,
		});
	}
	return nodes;
}

function collectIncomingCallerGroups(options: {
	symbolId: SymbolID;
	sourcesByPath: ReadonlyMap<string, PreparedSource>;
	getReferences: (symbolId: SymbolID) => readonly Ref[];
	getDecl: (symbolId: SymbolID) => Decl;
	pathCache: Map<string, CallHierarchyPathIndex>;
	allowedPaths: ReadonlySet<string> | null;
}): IncomingCallerGroup[] {
	const grouped = new Map<string, IncomingCallerGroup>();
	const references = options.getReferences(options.symbolId);
	for (let index = 0; index < references.length; index += 1) {
		const reference = references[index];
		if (reference.isWrite || !reference.file) {
			continue;
		}
		if (options.allowedPaths && !options.allowedPaths.has(reference.file)) {
			continue;
		}
		const hierarchyIndex = getCallHierarchyIndex(reference.file, options.sourcesByPath, options.pathCache, options.getDecl);
		const key = buildPositionKey(reference.range.start.line, reference.range.start.column);
		if (!hierarchyIndex.callByPosition.has(key)) {
			continue;
		}
		const caller = hierarchyIndex.callerByPosition.get(key) ?? buildChunkCallerScope(reference.file);
		if (caller.symbolId === options.symbolId) {
			continue;
		}
		const bucketKey = `${reference.file}|${caller.key}`;
		let bucket = grouped.get(bucketKey);
		if (!bucket) {
			bucket = {
				caller,
				calls: [],
			};
			grouped.set(bucketKey, bucket);
		}
		bucket.calls.push(reference);
	}
	const groups = Array.from(grouped.values());
	for (let index = 0; index < groups.length; index += 1) {
		groups[index].calls.sort((left, right) => comparePosition(left.range.start.line, left.range.start.column, right.range.start.line, right.range.start.column));
	}
	groups.sort((left, right) => compareCallHierarchyCaller(left.caller, right.caller));
	return groups;
}

function getCallHierarchyIndex(
	path: string,
	sourcesByPath: ReadonlyMap<string, PreparedSource>,
	cache: Map<string, CallHierarchyPathIndex>,
	getDecl: (symbolId: SymbolID) => Decl,
): CallHierarchyPathIndex {
	const cached = cache.get(path);
	if (cached) {
		return cached;
	}
	const source = sourcesByPath.get(path);
	const index: CallHierarchyPathIndex = {
		callByPosition: new Map(),
		callerByPosition: new Map(),
	};
	if (!source) {
		cache.set(path, index);
		return index;
	}
	const functionDecls = source.analysis.decls.filter(decl => decl.kind === 'function');
	for (let refIndex = 0; refIndex < source.analysis.refs.length; refIndex += 1) {
		const ref = source.analysis.refs[refIndex];
		const call = resolveCallExpressionForReference(ref, source.analysis.callExpressions);
		if (!call) {
			continue;
		}
		const positionKey = buildPositionKey(ref.range.start.line, ref.range.start.column);
		index.callByPosition.set(positionKey, call);
		if (index.callerByPosition.has(positionKey)) {
			continue;
		}
		const callerDecl = resolveCallerDeclaration(functionDecls, call.range.start.line, call.range.start.column);
		const caller = callerDecl ? buildDeclCallerScope(callerDecl) : buildChunkCallerScope(path);
		if (caller.symbolId) {
			const current = getDecl(caller.symbolId);
			if (current) {
				index.callerByPosition.set(positionKey, buildDeclCallerScope(current));
				continue;
			}
		}
		index.callerByPosition.set(positionKey, caller);
	}
	cache.set(path, index);
	return index;
}

function resolveCallExpressionForReference(ref: Ref, calls: readonly LuaCallExpression[]): LuaCallExpression {
	if (ref.isWrite) {
		return null;
	}
	let best: LuaCallExpression = null;
	for (let index = 0; index < calls.length; index += 1) {
		const call = calls[index];
		if (!callExpressionMatchesReference(call, ref)) {
			continue;
		}
		if (!best || isRangeInside(call.range, best.range)) {
			best = call;
		}
	}
	return best;
}

function callExpressionMatchesReference(call: LuaCallExpression, ref: Ref): boolean {
	if (call.methodName) {
		return ref.name === call.methodName && positionInRange(ref.range.start.line, ref.range.start.column, call.range);
	}
	if (call.callee.kind === LuaSyntaxKind.MemberExpression) {
		return ref.name === call.callee.identifier
			&& ref.range.start.line === call.callee.range.end.line
			&& ref.range.start.column === call.callee.range.end.column;
	}
	if (call.callee.kind === LuaSyntaxKind.IdentifierExpression) {
		return ref.name === call.callee.name
			&& ref.range.start.line === call.callee.range.start.line
			&& ref.range.start.column === call.callee.range.start.column;
	}
	return positionInRange(ref.range.start.line, ref.range.start.column, call.callee.range);
}

function resolveCallerDeclaration(functionDecls: readonly Decl[], line: number, column: number): Decl {
	let best: Decl = null;
	for (let index = 0; index < functionDecls.length; index += 1) {
		const decl = functionDecls[index];
		if (comparePosition(decl.range.start.line, decl.range.start.column, line, column) > 0) {
			continue;
		}
		if (!positionInRange(line, column, decl.scope)) {
			continue;
		}
		if (!best) {
			best = decl;
			continue;
		}
		const startDiff = comparePosition(decl.range.start.line, decl.range.start.column, best.range.start.line, best.range.start.column);
		if (startDiff > 0 || (startDiff === 0 && isRangeInside(decl.scope, best.scope))) {
			best = decl;
		}
	}
	return best;
}

function buildDeclCallerScope(decl: Decl): LuaCallHierarchyCaller {
	const label = decl.namePath.length > 0 ? decl.namePath.join('.') : decl.name;
	return {
		key: `decl:${decl.id}`,
		label,
		symbolId: decl.id,
		range: decl.range,
	};
}

function buildChunkCallerScope(path: string): LuaCallHierarchyCaller {
	return {
		key: `chunk:${path}`,
		label: '<chunk>',
		symbolId: null,
		range: {
			path,
			start: { line: 1, column: 1 },
			end: { line: 1, column: 1 },
		},
	};
}

function buildPositionKey(line: number, column: number): string {
	return `${line}:${column}`;
}

function compareCallHierarchyCaller(left: LuaCallHierarchyCaller, right: LuaCallHierarchyCaller): number {
	if (left.range.path !== right.range.path) {
		return left.range.path.localeCompare(right.range.path);
	}
	const lineDiff = left.range.start.line - right.range.start.line;
	if (lineDiff !== 0) {
		return lineDiff;
	}
	const columnDiff = left.range.start.column - right.range.start.column;
	if (columnDiff !== 0) {
		return columnDiff;
	}
	return left.label.localeCompare(right.label);
}

function isRangeInside(inner: LuaSourceRange, outer: LuaSourceRange): boolean {
	return comparePosition(inner.start.line, inner.start.column, outer.start.line, outer.start.column) >= 0
		&& comparePosition(inner.end.line, inner.end.column, outer.end.line, outer.end.column) <= 0;
}

function createBoundFile(
	source: PreparedSource,
	diagnostics: readonly LuaStaticDiagnostic[],
	knownGlobalNames: ReadonlySet<string>,
	moduleTargetsByAlias: ReadonlyMap<string, string>,
	sourceByPath: ReadonlyMap<string, PreparedSource>,
	snapshot: LuaSemanticWorkspaceSnapshot,
): LuaSemanticFrontendFile {
	const decls = source.analysis.decls;
	const refsByStart = source.analysis.refs.map(ref => classifyReference(ref, snapshot, knownGlobalNames));
	refsByStart.sort((left, right) => comparePosition(left.ref.range.start.line, left.ref.range.start.column, right.ref.range.start.line, right.ref.range.start.column));
	const requireTargetsByStart = collectRequireNavigationTargets(source, moduleTargetsByAlias, sourceByPath);
	const declarationsByRange = new Map<string, Decl>();
	const declarationsByStart = new Map<string, Decl>();
	const referencesByRange = new Map<string, LuaBoundReference>();
	const referencesByStart = new Map<string, LuaBoundReference>();
	for (let index = 0; index < decls.length; index += 1) {
		const decl = decls[index];
		declarationsByRange.set(buildRangeKey(decl.range), decl);
		const startKey = buildStartKey(decl.range);
		if (!declarationsByStart.has(startKey)) {
			declarationsByStart.set(startKey, decl);
		}
	}
	for (let index = 0; index < refsByStart.length; index += 1) {
		const reference = refsByStart[index];
		referencesByRange.set(buildRangeKey(reference.ref.range), reference);
		const startKey = buildStartKey(reference.ref.range);
		if (!referencesByStart.has(startKey)) {
			referencesByStart.set(startKey, reference);
		}
	}
	return {
		diagnostics,
		getDeclaration(range: LuaSourceRange): Decl {
			return declarationsByRange.get(buildRangeKey(range))
				?? declarationsByStart.get(buildStartKey(range))
				?? null;
		},
		getReference(range: LuaSourceRange): LuaBoundReference {
			return referencesByRange.get(buildRangeKey(range))
				?? referencesByStart.get(buildStartKey(range))
				?? null;
		},
		getNavigationTargetAt(line: number, column: number): LuaSemanticNavigationTarget {
			for (let index = 0; index < decls.length; index += 1) {
				const decl = decls[index];
				if (positionInRange(line, column, decl.range)) {
					return {
						kind: 'declaration',
						range: decl.range,
					};
				}
			}
			for (let index = 0; index < refsByStart.length; index += 1) {
				const reference = refsByStart[index];
				if (!positionInRange(line, column, reference.ref.range)) {
					continue;
				}
				if (!reference.decl) {
					return null;
				}
				return {
					kind: 'declaration',
					range: reference.decl.range,
				};
			}
			for (let index = 0; index < requireTargetsByStart.length; index += 1) {
				const target = requireTargetsByStart[index];
				if (!positionInRange(line, column, target.range)) {
					continue;
				}
				return {
					kind: 'require_module',
					range: target.target,
					moduleName: target.moduleName,
				};
			}
			return null;
		},
		findFirstReferenceByStartRange(
			start: LuaSourceRange['start'],
			endExclusive: LuaSourceRange['start'],
		): LuaBoundReference {
			const startIndex = lowerBoundReferenceStart(refsByStart, start.line, start.column);
			const endIndex = lowerBoundReferenceStart(refsByStart, endExclusive.line, endExclusive.column);
			return startIndex < endIndex ? refsByStart[startIndex] : null;
		},
		findLastReferenceByStartRange(
			start: LuaSourceRange['start'],
			endExclusive: LuaSourceRange['start'],
		): LuaBoundReference {
			const startIndex = lowerBoundReferenceStart(refsByStart, start.line, start.column);
			const endIndex = lowerBoundReferenceStart(refsByStart, endExclusive.line, endExclusive.column);
			return startIndex < endIndex ? refsByStart[endIndex - 1] : null;
		},
	};
}

type LuaRequireNavigationTarget = {
	range: LuaSourceRange;
	moduleName: string;
	target: LuaSourceRange;
};

function collectRequireNavigationTargets(
	source: PreparedSource,
	moduleTargetsByAlias: ReadonlyMap<string, string>,
	sourceByPath: ReadonlyMap<string, PreparedSource>,
): LuaRequireNavigationTarget[] {
	const targets: LuaRequireNavigationTarget[] = [];
	for (let index = 0; index < source.analysis.callExpressions.length; index += 1) {
		const callExpression = source.analysis.callExpressions[index];
		const requireArgument = tryExtractRequireStringArgument(callExpression);
		if (!requireArgument) {
			continue;
		}
		const moduleName = requireArgument.value;
		const targetPath = moduleTargetsByAlias.get(moduleName);
		if (!targetPath) {
			continue;
		}
		const targetSource = sourceByPath.get(targetPath);
		if (!targetSource) {
			continue;
		}
		targets.push({
			range: resolveStringLiteralNavigationRange(source, requireArgument),
			moduleName,
			target: targetSource.chunk.range,
		});
	}
	targets.sort((left, right) => comparePosition(left.range.start.line, left.range.start.column, right.range.start.line, right.range.start.column));
	return targets;
}

function tryExtractRequireStringArgument(
	callExpression: LuaCallExpression,
): LuaStringLiteralExpression {
	if (callExpression.callee.kind !== LuaSyntaxKind.IdentifierExpression) {
		return null;
	}
	if ((callExpression.callee as LuaIdentifierExpression).name !== 'require') {
		return null;
	}
	if (callExpression.arguments.length === 0) {
		return null;
	}
	const firstArgument = callExpression.arguments[0];
	if (firstArgument.kind !== LuaSyntaxKind.StringLiteralExpression) {
		return null;
	}
	return firstArgument as LuaStringLiteralExpression;
}

function resolveStringLiteralNavigationRange(
	source: PreparedSource,
	literal: LuaStringLiteralExpression,
): LuaSourceRange {
	for (let index = 0; index < source.parsed.tokens.length; index += 1) {
		const token = source.parsed.tokens[index];
		if (token.type !== LuaTokenType.String) {
			continue;
		}
		if (token.line !== literal.range.start.line || token.column !== literal.range.start.column) {
			continue;
		}
		return {
			path: literal.range.path,
			start: literal.range.start,
			end: {
				line: token.line,
				column: token.column + token.lexeme.length - 1,
			},
		};
	}
	return literal.range;
}

function buildModuleTargetAliasMap(
	sources: readonly PreparedSource[],
): Map<string, string> {
	const aliases = new Map<string, string>();
	const entries = buildModuleAliasesFromPaths(sources.map(source => source.path));
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		if (!aliases.has(entry.alias)) {
			aliases.set(entry.alias, entry.path);
		}
	}
	return aliases;
}

function classifyReference(
	ref: Ref,
	snapshot: LuaSemanticWorkspaceSnapshot,
	knownGlobalNames: ReadonlySet<string>,
): LuaBoundReference {
	const decl = ref.target ? snapshot.getDecl(ref.target) : null;
	if (decl && isReferenceInsideDeclScope(ref, decl)) {
		return {
			kind: decl.isGlobal ? 'global' : 'lexical',
			ref,
			decl,
			isImplicitGlobal: false,
		};
	}
	if (ref.namePath.length === 1) {
		if (isReservedMemoryMapName(ref.name)) {
			return {
				kind: 'map',
				ref,
				decl: null,
				isImplicitGlobal: false,
			};
		}
		if (isReservedIntrinsicName(ref.name)) {
			return {
				kind: 'reserved_intrinsic',
				ref,
				decl: null,
				isImplicitGlobal: false,
			};
		}
		if (ref.isWrite || knownGlobalNames.has(ref.name)) {
			return {
				kind: 'global',
				ref,
				decl: null,
				isImplicitGlobal: true,
			};
		}
	}
	return {
		kind: 'unresolved',
		ref,
		decl: null,
		isImplicitGlobal: false,
	};
}

function isReferenceInsideDeclScope(ref: Ref, decl: Decl): boolean {
	if (decl.isGlobal) {
		return true;
	}
	if (decl.file !== ref.file) {
		return false;
	}
	return comparePosition(ref.range.start.line, ref.range.start.column, decl.scope.start.line, decl.scope.start.column) >= 0
		&& comparePosition(ref.range.start.line, ref.range.start.column, decl.scope.end.line, decl.scope.end.column) <= 0;
}

function buildCombinedGlobalSymbols(decls: readonly Decl[], externalGlobalSymbols?: readonly LuaSymbolEntry[]): LuaSymbolEntry[] {
	const symbols: LuaSymbolEntry[] = [];
	for (let index = 0; index < decls.length; index += 1) {
		const decl = decls[index];
		symbols.push({
			name: decl.name,
			path: decl.namePath.length > 0 ? decl.namePath.join('.') : decl.name,
			kind: symbolKindToLuaKind(decl.kind),
			location: {
				path: decl.file,
				range: {
					startLine: decl.range.start.line,
					startColumn: decl.range.start.column,
					endLine: decl.range.end.line,
					endColumn: decl.range.end.column,
				},
			},
		});
	}
	if (externalGlobalSymbols) {
		for (let index = 0; index < externalGlobalSymbols.length; index += 1) {
			symbols.push(externalGlobalSymbols[index]);
		}
	}
	return symbols;
}

function symbolKindToLuaKind(kind: Decl['kind']): LuaSymbolEntry['kind'] {
	switch (kind) {
		case 'tableField':
			return 'table_field';
		case 'function':
			return 'function';
		case 'parameter':
			return 'parameter';
		case 'constant':
			return 'constant';
		default:
			return 'variable';
	}
}

function buildKnownGlobalNameSet(
	globalSymbols: readonly LuaSymbolEntry[],
	builtinDescriptors: readonly LuaBuiltinDescriptor[],
	apiSignatures: ReadonlyMap<string, LuaApiSignatureMetadata>,
	extraGlobalNames?: readonly string[],
): Set<string> {
	const names = new Set<string>();
	const addName = (value: string): void => {
		names.add(value);
		const dotIndex = value.indexOf('.');
		if (dotIndex !== -1) {
			names.add(value.slice(0, dotIndex));
		}
		const colonIndex = value.indexOf(':');
		if (colonIndex !== -1) {
			names.add(value.slice(0, colonIndex));
		}
	};
	addName('api');
	if (extraGlobalNames) {
		for (let index = 0; index < extraGlobalNames.length; index += 1) {
			addName(extraGlobalNames[index]);
		}
	}
	for (let index = 0; index < globalSymbols.length; index += 1) {
		addName(globalSymbols[index].name);
		addName(globalSymbols[index].path);
	}
	for (let index = 0; index < builtinDescriptors.length; index += 1) {
		addName(builtinDescriptors[index].name);
	}
	for (const [name] of apiSignatures) {
		addName(name);
	}
	return names;
}

function buildRangeKey(range: LuaSourceRange): string {
	return `${range.start.line}:${range.start.column}:${range.end.line}:${range.end.column}`;
}

function buildStartKey(range: LuaSourceRange): string {
	return `${range.start.line}:${range.start.column}`;
}

function comparePosition(
	line: number,
	column: number,
	otherLine: number,
	otherColumn: number,
): number {
	if (line < otherLine) {
		return -1;
	}
	if (line > otherLine) {
		return 1;
	}
	if (column < otherColumn) {
		return -1;
	}
	if (column > otherColumn) {
		return 1;
	}
	return 0;
}

function positionInRange(
	line: number,
	column: number,
	range: LuaSourceRange,
): boolean {
	return comparePosition(line, column, range.start.line, range.start.column) >= 0
		&& comparePosition(line, column, range.end.line, range.end.column) <= 0;
}

function lowerBoundReferenceStart(
	refs: readonly LuaBoundReference[],
	line: number,
	column: number,
): number {
	let low = 0;
	let high = refs.length;
	while (low < high) {
		const mid = (low + high) >> 1;
		if (comparePosition(refs[mid].ref.range.start.line, refs[mid].ref.range.start.column, line, column) < 0) {
			low = mid + 1;
		} else {
			high = mid;
		}
	}
	return low;
}

function isReservedMemoryMapName(name: string): boolean {
	for (let index = 0; index < RESERVED_MEMORY_MAP_NAMES.length; index += 1) {
		if (RESERVED_MEMORY_MAP_NAMES[index] === name) {
			return true;
		}
	}
	return false;
}

function isReservedIntrinsicName(name: string): boolean {
	for (let index = 0; index < RESERVED_INTRINSIC_NAMES.length; index += 1) {
		if (RESERVED_INTRINSIC_NAMES[index] === name) {
			return true;
		}
	}
	return false;
}

function namePathMatches(candidate: readonly string[], desired: readonly string[]): boolean {
	if (candidate.length !== desired.length) {
		return false;
	}
	for (let index = 0; index < candidate.length; index += 1) {
		if (candidate[index] !== desired[index]) {
			return false;
		}
	}
	return true;
}
