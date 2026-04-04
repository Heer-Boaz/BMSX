import { createIdentifierCanonicalizer } from '../lua/syntax/identifier_canonicalizer';
import type { LuaChunk, LuaSourceRange } from '../lua/syntax/lua_ast';
import type { CanonicalizationType } from '../rompack/rompack';
import type { LuaBuiltinDescriptor, LuaSymbolEntry } from './types';
import type { ParsedLuaChunk } from './ide/lua/lua_parse';
import { getCachedLuaParse } from './ide/lua/lua_analysis_cache';
import { type Decl, type FileSemanticData, type Ref, LuaSemanticWorkspace } from './ide/semantic_model';
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

export type LuaSemanticFrontendFile = {
	diagnostics: readonly LuaStaticDiagnostic[];
	getDeclaration(range: LuaSourceRange): Decl;
	getReference(range: LuaSourceRange): LuaBoundReference;
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
	for (let index = 0; index < sources.length; index += 1) {
		const source = sources[index];
		if (source.analysis && source.chunk) {
			preparedSources.push({
				path: source.path,
				chunk: source.chunk,
				analysis: source.analysis,
			});
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
		preparedSources.push({
			path: source.path,
			chunk: parseEntry.parsed.chunk,
			analysis: workspace.getFileData(source.path),
		});
	}
	const globalSymbols = buildCombinedGlobalSymbols(workspace.listGlobalDecls(), options.externalGlobalSymbols);
	const knownGlobalNames = buildKnownGlobalNameSet(globalSymbols, builtinDescriptors, apiSignatures, canonicalize, options.extraGlobalNames);
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
		files.set(source.path, createBoundFile(source, workspace, diagnostics, knownGlobalNames, canonicalize));
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
	canonicalize: (value: string) => string,
): LuaSemanticFrontendFile {
	const decls = source.analysis.decls;
	const refsByStart = source.analysis.refs.map(ref => classifyReference(ref, workspace, knownGlobalNames, canonicalize));
	refsByStart.sort((left, right) => comparePosition(left.ref.range.start, right.ref.range.start));
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
