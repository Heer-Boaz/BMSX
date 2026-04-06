import { createIdentifierCanonicalizer } from '../lua/syntax/identifier_canonicalizer';
import { LuaSyntaxKind, type LuaCallExpression, type LuaChunk, type LuaIdentifierExpression, type LuaSourcePosition, type LuaSourceRange, type LuaStringLiteralExpression } from '../lua/syntax/lua_ast';
import { LuaTokenType } from '../lua/syntax/luatoken';
import type { CanonicalizationType } from '../rompack/rompack';
import type { LuaBuiltinDescriptor, LuaSymbolEntry } from './types';
import type { ParsedLuaChunk } from './ide/lua/lua_parse';
import { getCachedLuaParse } from './ide/lua/lua_analysis_cache';
import { type Decl, type FileSemanticData, type Ref, LuaSemanticWorkspace } from './ide/semantic_model';
import { buildModuleAliasesFromPaths } from './program_asset';
import {
	computeLuaDiagnosticsFromAnalysis,
	getDefaultLuaBuiltinDescriptors,
	getStaticLuaApiSignatureMap,
	type LuaApiSignatureMetadata,
	type LuaStaticDiagnostic,
} from './lua_static_diagnostics';

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
	workspace?: LuaSemanticWorkspace;
	canonicalization?: CanonicalizationType;
	builtinDescriptors?: readonly LuaBuiltinDescriptor[];
	apiSignatures?: ReadonlyMap<string, LuaApiSignatureMetadata>;
	extraGlobalNames?: readonly string[];
	externalGlobalSymbols?: readonly LuaSymbolEntry[];
};

export type LuaBoundReferenceKind = 'lexical' | 'global' | 'memory_map' | 'reserved_intrinsic' | 'unresolved';

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

export type LuaSemanticFrontendFile = {
	diagnostics: readonly LuaStaticDiagnostic[];
	getDeclaration(range: LuaSourceRange): Decl;
	getReference(range: LuaSourceRange): LuaBoundReference;
	getNavigationTargetAt(position: LuaSourcePosition): LuaSemanticNavigationTarget;
	findFirstReferenceByStartRange(
		start: LuaSourceRange['start'],
		endExclusive: LuaSourceRange['start'],
	): LuaBoundReference;
	findLastReferenceByStartRange(
		start: LuaSourceRange['start'],
		endExclusive: LuaSourceRange['start'],
	): LuaBoundReference;
};

export type LuaSemanticFrontend = {
	files: ReadonlyMap<string, LuaSemanticFrontendFile>;
	getFile(path: string): LuaSemanticFrontendFile;
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
	const workspace = options.workspace ?? new LuaSemanticWorkspace();
	const canonicalization = options.canonicalization ?? 'none';
	const builtinDescriptors = options.builtinDescriptors ?? getDefaultLuaBuiltinDescriptors();
	const apiSignatures = options.apiSignatures ?? getStaticLuaApiSignatureMap();
	const canonicalize = createIdentifierCanonicalizer(canonicalization);
	const preparedSources: PreparedSource[] = [];
	const sourceByPath = new Map<string, PreparedSource>();
	for (let index = 0; index < sources.length; index += 1) {
		const source = sources[index];
		if (source.analysis && source.chunk) {
			const prepared = {
				path: source.path,
				chunk: source.chunk,
				analysis: source.analysis,
				parsed: source.parsed ?? getCachedLuaParse({
					path: source.path,
					source: source.source,
					lines: source.lines,
					version: source.version,
					withSyntaxError: true,
					canonicalization,
				}).parsed,
			};
			preparedSources.push(prepared);
			sourceByPath.set(prepared.path, prepared);
			continue;
		}
		const parseEntry = getCachedLuaParse({
			path: source.path,
			source: source.source,
			lines: source.lines,
			version: source.version,
			parsed: source.parsed,
			withSyntaxError: true,
			canonicalization,
		});
		if (parseEntry.syntaxError) {
			throw new Error(`[LuaSemanticFrontend] Syntax error in ${source.path}: ${parseEntry.syntaxError.message}`);
		}
		workspace.updateFile(source.path, parseEntry.source, parseEntry.lines, parseEntry.parsed, source.version, canonicalization);
		const prepared = {
			path: source.path,
			chunk: parseEntry.parsed.chunk,
			analysis: workspace.getFileData(source.path),
			parsed: parseEntry.parsed,
		};
		preparedSources.push(prepared);
		sourceByPath.set(prepared.path, prepared);
	}
	const globalSymbols = buildCombinedGlobalSymbols(workspace.listGlobalDecls(), options.externalGlobalSymbols);
	const knownGlobalNames = buildKnownGlobalNameSet(globalSymbols, builtinDescriptors, apiSignatures, canonicalize, options.extraGlobalNames);
	const moduleTargetsByAlias = buildModuleTargetAliasMap(preparedSources, canonicalize);
	const files = new Map<string, LuaSemanticFrontendFile>();
	for (let index = 0; index < preparedSources.length; index += 1) {
		const source = preparedSources[index];
		const diagnostics = computeLuaDiagnosticsFromAnalysis({
			analysis: source.analysis,
			chunk: source.chunk,
			globalSymbols,
			builtinDescriptors,
			apiSignatures,
			canonicalize,
			extraGlobalNames: options.extraGlobalNames,
		});
		files.set(source.path, createBoundFile(source, workspace, diagnostics, knownGlobalNames, moduleTargetsByAlias, sourceByPath, canonicalize));
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
	};
}

function createBoundFile(
	source: PreparedSource,
	workspace: LuaSemanticWorkspace,
	diagnostics: readonly LuaStaticDiagnostic[],
	knownGlobalNames: ReadonlySet<string>,
	moduleTargetsByAlias: ReadonlyMap<string, string>,
	sourceByPath: ReadonlyMap<string, PreparedSource>,
	canonicalize: (value: string) => string,
): LuaSemanticFrontendFile {
	const decls = source.analysis.decls;
	const refsByStart = source.analysis.refs.map(ref => classifyReference(ref, workspace, knownGlobalNames, canonicalize));
	refsByStart.sort((left, right) => comparePosition(left.ref.range.start, right.ref.range.start));
	const requireTargetsByStart = collectRequireNavigationTargets(source, moduleTargetsByAlias, sourceByPath, canonicalize);
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
		getNavigationTargetAt(position: LuaSourcePosition): LuaSemanticNavigationTarget {
			for (let index = 0; index < decls.length; index += 1) {
				const decl = decls[index];
				if (positionInRange(position, decl.range)) {
					return {
						kind: 'declaration',
						range: decl.range,
					};
				}
			}
			for (let index = 0; index < refsByStart.length; index += 1) {
				const reference = refsByStart[index];
				if (!positionInRange(position, reference.ref.range)) {
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
				if (!positionInRange(position, target.range)) {
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
			const startIndex = lowerBoundReferenceStart(refsByStart, start);
			const endIndex = lowerBoundReferenceStart(refsByStart, endExclusive);
			return startIndex < endIndex ? refsByStart[startIndex] : null;
		},
		findLastReferenceByStartRange(
			start: LuaSourceRange['start'],
			endExclusive: LuaSourceRange['start'],
		): LuaBoundReference {
			const startIndex = lowerBoundReferenceStart(refsByStart, start);
			const endIndex = lowerBoundReferenceStart(refsByStart, endExclusive);
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
	canonicalize: (value: string) => string,
): LuaRequireNavigationTarget[] {
	const targets: LuaRequireNavigationTarget[] = [];
	for (let index = 0; index < source.analysis.callExpressions.length; index += 1) {
		const callExpression = source.analysis.callExpressions[index];
		const requireArgument = tryExtractRequireStringArgument(callExpression, canonicalize);
		if (!requireArgument) {
			continue;
		}
		const moduleName = requireArgument.value;
		const targetPath = moduleTargetsByAlias.get(moduleName) ?? moduleTargetsByAlias.get(canonicalize(moduleName));
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
	targets.sort((left, right) => comparePosition(left.range.start, right.range.start));
	return targets;
}

function tryExtractRequireStringArgument(
	callExpression: LuaCallExpression,
	canonicalize: (value: string) => string,
): LuaStringLiteralExpression {
	if (callExpression.callee.kind !== LuaSyntaxKind.IdentifierExpression) {
		return null;
	}
	if (canonicalize((callExpression.callee as LuaIdentifierExpression).name) !== canonicalize('require')) {
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
	canonicalize: (value: string) => string,
): Map<string, string> {
	const aliases = new Map<string, string>();
	const entries = buildModuleAliasesFromPaths(sources.map(source => source.path));
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		if (!aliases.has(entry.alias)) {
			aliases.set(entry.alias, entry.path);
		}
		const canonicalAlias = canonicalize(entry.alias);
		if (!aliases.has(canonicalAlias)) {
			aliases.set(canonicalAlias, entry.path);
		}
	}
	return aliases;
}

function classifyReference(
	ref: Ref,
	workspace: LuaSemanticWorkspace,
	knownGlobalNames: ReadonlySet<string>,
	canonicalize: (value: string) => string,
): LuaBoundReference {
	const decl = ref.target ? workspace.getDecl(ref.target) : null;
	if (decl && isReferenceInsideDeclScope(ref, decl)) {
		return {
			kind: decl.isGlobal ? 'global' : 'lexical',
			ref,
			decl,
			isImplicitGlobal: false,
		};
	}
	if (ref.namePath.length === 1) {
		const canonicalName = canonicalize(ref.name);
		if (isReservedMemoryMapName(canonicalName, canonicalize)) {
			return {
				kind: 'memory_map',
				ref,
				decl: null,
				isImplicitGlobal: false,
			};
		}
		if (isReservedIntrinsicName(canonicalName, canonicalize)) {
			return {
				kind: 'reserved_intrinsic',
				ref,
				decl: null,
				isImplicitGlobal: false,
			};
		}
		if (ref.isWrite || knownGlobalNames.has(canonicalName)) {
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
	return comparePosition(ref.range.start, decl.scope.start) >= 0
		&& comparePosition(ref.range.start, decl.scope.end) <= 0;
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
	canonicalize: (value: string) => string,
	extraGlobalNames?: readonly string[],
): Set<string> {
	const names = new Set<string>();
	const addName = (value: string): void => {
		const canonical = canonicalize(value);
		names.add(canonical);
		const dotIndex = canonical.indexOf('.');
		if (dotIndex !== -1) {
			names.add(canonical.slice(0, dotIndex));
		}
		const colonIndex = canonical.indexOf(':');
		if (colonIndex !== -1) {
			names.add(canonical.slice(0, colonIndex));
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
	left: { line: number; column: number },
	right: { line: number; column: number },
): number {
	if (left.line !== right.line) {
		return left.line - right.line;
	}
	return left.column - right.column;
}

function positionInRange(
	position: LuaSourcePosition,
	range: LuaSourceRange,
): boolean {
	return comparePosition(position, range.start) >= 0
		&& comparePosition(position, range.end) <= 0;
}

function lowerBoundReferenceStart(
	refs: readonly LuaBoundReference[],
	position: { line: number; column: number },
): number {
	let low = 0;
	let high = refs.length;
	while (low < high) {
		const mid = (low + high) >> 1;
		if (comparePosition(refs[mid].ref.range.start, position) < 0) {
			low = mid + 1;
		} else {
			high = mid;
		}
	}
	return low;
}

function isReservedMemoryMapName(name: string, canonicalize: (value: string) => string): boolean {
	for (let index = 0; index < RESERVED_MEMORY_MAP_NAMES.length; index += 1) {
		if (canonicalize(RESERVED_MEMORY_MAP_NAMES[index]) === name) {
			return true;
		}
	}
	return false;
}

function isReservedIntrinsicName(name: string, canonicalize: (value: string) => string): boolean {
	for (let index = 0; index < RESERVED_INTRINSIC_NAMES.length; index += 1) {
		if (canonicalize(RESERVED_INTRINSIC_NAMES[index]) === name) {
			return true;
		}
	}
	return false;
}
