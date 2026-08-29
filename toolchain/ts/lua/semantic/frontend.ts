import { LuaSyntaxKind, type LuaCallExpression, type LuaChunk, type LuaIdentifierExpression, type LuaSourceRange, type LuaStringLiteralExpression } from '../syntax/ast';
import { LuaTokenType } from '../syntax/token';
import type { LuaBuiltinDescriptor, LuaSymbolEntry } from '../semantic_contracts';
import type { ParsedLuaChunk } from '../analysis/parse';
import {
	buildLuaSemanticWorkspaceSnapshot,
	type Decl,
	type FileSemanticData,
	type LuaSemanticWorkspaceSourceSnapshot,
	type LuaSemanticWorkspaceSnapshot,
	type Ref,
	type SymbolID,
} from './model';
import { toLuaModulePath } from '../module_path';
import {
	computeLuaDiagnosticsFromAnalysis,
	getDefaultLuaBuiltinDescriptors,
	type LuaStaticDiagnostic,
} from './diagnostics';
import { compareSourcePosition, sourcePositionInRange } from './source_range';
import { buildLuaKnownNameSet, isReservedIntrinsicName, isReservedMemoryMapName, semanticSymbolKindToLuaSymbolKind } from './common';

export type LuaSemanticFrontendSource = {
	path: string;
	source: string;
	parsed?: ParsedLuaChunk;
	chunk?: LuaChunk;
	analysis?: FileSemanticData;
};

export type LuaSemanticFrontendOptions = {
	builtinDescriptors?: readonly LuaBuiltinDescriptor[];
	extraGlobalNames?: readonly string[];
	externalGlobalSymbols?: readonly LuaSymbolEntry[];
};

export type LuaBoundReferenceKind = 'lexical' | 'implicit_self' | 'global' | 'map' | 'reserved_intrinsic' | 'unresolved';

export type LuaBoundReference = {
	kind: LuaBoundReferenceKind;
	ref: Ref;
	decl: Decl;
	isImplicitGlobal: boolean;
};

export type LuaSemanticNavigationTarget =
	| {
		kind: 'declaration';
		declaration: Decl;
		range: LuaSourceRange;
	}
	| {
		kind: 'require_module';
		range: LuaSourceRange;
		moduleName: string;
	};

export type LuaSemanticPositionTarget = {
	id: SymbolID;
	declaration: Decl;
};

export type LuaSemanticPositionSymbols = {
	origin: LuaSourceRange;
	targets: readonly LuaSemanticPositionTarget[];
};

export type LuaSemanticReferenceQuery = LuaSemanticPositionSymbols & {
	references: readonly Ref[];
};

export type LuaCallHierarchySymbolItem = {
	kind: 'symbol';
	key: string;
	label: string;
	symbolId: SymbolID;
	range: LuaSourceRange;
};

export type LuaCallHierarchyChunkItem = {
	kind: 'chunk';
	key: string;
	label: string;
	range: LuaSourceRange;
};

export type LuaCallHierarchyItem = LuaCallHierarchySymbolItem | LuaCallHierarchyChunkItem;

export type LuaCallHierarchyIncomingCall = {
	from: LuaCallHierarchyItem;
	fromRanges: readonly LuaSourceRange[];
};

export type LuaSemanticFrontendFile = {
	diagnostics: readonly LuaStaticDiagnostic[];
	getDeclaration(identifier: LuaIdentifierExpression): Decl | undefined;
	getReference(identifier: LuaIdentifierExpression): LuaBoundReference | undefined;
	getNavigationTargetsAt(line: number, column: number): readonly LuaSemanticNavigationTarget[];
};

export type LuaSemanticFrontend = {
	snapshot: LuaSemanticWorkspaceSnapshot;
	filePaths: readonly string[];
	getFile(path: string): LuaSemanticFrontendFile;
	findSymbolsByPosition(path: string, line: number, column: number): LuaSemanticPositionSymbols | null;
	findReferencesByPosition(path: string, line: number, column: number): LuaSemanticReferenceQuery | null;
	provideIncomingCalls(
		symbolId: SymbolID,
		allowedPaths?: ReadonlySet<string>,
	): readonly LuaCallHierarchyIncomingCall[];
};

export function buildLuaSemanticFrontend(
	sources: ReadonlyArray<LuaSemanticFrontendSource>,
	options: LuaSemanticFrontendOptions = {},
): LuaSemanticFrontend {
	const snapshot = buildLuaSemanticWorkspaceSnapshot(sources);
	return buildLuaSemanticFrontendFromSnapshot(snapshot, options);
}

export function buildLuaSemanticFrontendFromSnapshot(
	snapshot: LuaSemanticWorkspaceSnapshot,
	options: LuaSemanticFrontendOptions = {},
): LuaSemanticFrontend {
	return new SnapshotSemanticFrontend(snapshot, options);
}

class SnapshotSemanticFrontend implements LuaSemanticFrontend {
	public readonly snapshot: LuaSemanticWorkspaceSnapshot;
	public readonly filePaths: readonly string[];
	private readonly builtinDescriptors: readonly LuaBuiltinDescriptor[];
	private readonly extraGlobalNames: readonly string[] | undefined;
	private readonly globalSymbols: readonly LuaSymbolEntry[];
	private readonly knownGlobalNames: ReadonlySet<string>;
	private readonly moduleTargetsByAlias: ReadonlyMap<string, string>;
	private readonly sourcesByPath: Map<string, LuaSemanticWorkspaceSourceSnapshot> = new Map();
	private readonly files: Map<string, LuaSemanticFrontendFile> = new Map();

	constructor(snapshot: LuaSemanticWorkspaceSnapshot, options: LuaSemanticFrontendOptions) {
		this.snapshot = snapshot;
		this.filePaths = snapshot.files;
		this.builtinDescriptors = options.builtinDescriptors ?? getDefaultLuaBuiltinDescriptors();
		this.extraGlobalNames = options.extraGlobalNames;
		for (let index = 0; index < snapshot.sources.length; index += 1) {
			const source = snapshot.sources[index];
			this.sourcesByPath.set(source.path, source);
		}
		// Queries remain bound to this immutable source and global-symbol generation.
		this.globalSymbols = buildCombinedGlobalSymbols(snapshot.listGlobalDecls(), options.externalGlobalSymbols);
		this.knownGlobalNames = buildLuaKnownNameSet(
			this.globalSymbols,
			this.builtinDescriptors,
			this.extraGlobalNames,
		);
		this.moduleTargetsByAlias = buildModuleTargetAliasMap(snapshot.sources);
	}

	public getFile(path: string): LuaSemanticFrontendFile {
		let file = this.files.get(path);
		if (file) {
			return file;
		}
		const source = this.sourcesByPath.get(path);
		if (!source) {
			throw new Error(`[LuaSemanticFrontend] Missing semantic file '${path}'.`);
		}
		const diagnostics = computeLuaDiagnosticsFromAnalysis({
			analysis: source.analysis,
			chunk: source.chunk,
			globalSymbols: this.globalSymbols,
			builtinDescriptors: this.builtinDescriptors,
			extraGlobalNames: this.extraGlobalNames,
		});
		file = createBoundFile(
			source,
			diagnostics,
			this.knownGlobalNames,
			this.moduleTargetsByAlias,
			this.sourcesByPath,
			this.snapshot,
		);
		this.files.set(path, file);
		return file;
	}

	public findSymbolsByPosition(path: string, line: number, column: number): LuaSemanticPositionSymbols | null {
		const source = this.sourcesByPath.get(path);
		if (!source) {
			return null;
		}
		return findPositionSymbols(source, this.snapshot, line, column);
	}

	public findReferencesByPosition(path: string, line: number, column: number): LuaSemanticReferenceQuery | null {
		const symbols = this.findSymbolsByPosition(path, line, column);
		if (!symbols) {
			return null;
		}
		const symbolIds = new Array<SymbolID>(symbols.targets.length);
		for (let targetIndex = 0; targetIndex < symbols.targets.length; targetIndex += 1) {
			symbolIds[targetIndex] = symbols.targets[targetIndex].id;
		}
		return {
			origin: symbols.origin,
			targets: symbols.targets,
			references: this.snapshot.symbolResolver.getReferencesForSymbols(symbolIds),
		};
	}

	public provideIncomingCalls(
		symbolId: SymbolID,
		allowedPaths?: ReadonlySet<string>,
	): readonly LuaCallHierarchyIncomingCall[] {
		const grouped = new Map<string, IncomingCallerGroup>();
		const references = this.snapshot.symbolResolver.getReferences(symbolId);
		for (let index = 0; index < references.length; index += 1) {
			const reference = references[index];
			if (!reference.isCall) {
				continue;
			}
			if (allowedPaths && !allowedPaths.has(reference.file)) {
				continue;
			}
			const callerKey = reference.caller ? `decl:${reference.caller}` : `chunk:${reference.file}`;
			let bucket = grouped.get(callerKey);
			if (!bucket) {
				const caller = reference.caller
					? buildDeclCallerScope(this.snapshot.symbolResolver.getDeclaration(reference.caller))
					: buildChunkCallerScope(reference.file);
				bucket = {
					from: caller,
					fromRanges: [],
				};
				grouped.set(callerKey, bucket);
			}
			bucket.fromRanges.push(reference.range);
		}
		const groups = Array.from(grouped.values());
		for (let index = 0; index < groups.length; index += 1) {
			groups[index].fromRanges.sort((left, right) => compareSourcePosition(left.start.line, left.start.column, right.start.line, right.start.column));
		}
		groups.sort((left, right) => compareCallHierarchyItems(left.from, right.from));
		return groups;
	}
}

type IncomingCallerGroup = {
	from: LuaCallHierarchyItem;
	fromRanges: LuaSourceRange[];
};

function buildDeclCallerScope(decl: Decl): LuaCallHierarchySymbolItem {
	const label = decl.namePath.length > 0 ? decl.namePath.join('.') : decl.name;
	return {
		kind: 'symbol',
		key: `decl:${decl.id}`,
		label,
		symbolId: decl.id,
		range: decl.range,
	};
}

function buildChunkCallerScope(path: string): LuaCallHierarchyChunkItem {
	return {
		kind: 'chunk',
		key: `chunk:${path}`,
		label: '<chunk>',
		range: {
			path,
			start: { line: 1, column: 1 },
			end: { line: 1, column: 1 },
		},
	};
}

function compareCallHierarchyItems(left: LuaCallHierarchyItem, right: LuaCallHierarchyItem): number {
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

function createBoundFile(
	source: LuaSemanticWorkspaceSourceSnapshot,
	diagnostics: readonly LuaStaticDiagnostic[],
	knownGlobalNames: ReadonlySet<string>,
	moduleTargetsByAlias: ReadonlyMap<string, string>,
	sourceByPath: ReadonlyMap<string, LuaSemanticWorkspaceSourceSnapshot>,
	snapshot: LuaSemanticWorkspaceSnapshot,
): LuaSemanticFrontendFile {
	const requireTargetsByStart = collectRequireNavigationTargets(source, moduleTargetsByAlias, sourceByPath);
	const boundReferences = new Map<Ref, LuaBoundReference>();
	const bindReference = (ref: Ref): LuaBoundReference => {
		let reference = boundReferences.get(ref);
		if (!reference) {
			reference = classifyReference(ref, snapshot, knownGlobalNames);
			boundReferences.set(ref, reference);
		}
		return reference;
	};
	return {
		diagnostics,
		getDeclaration(identifier: LuaIdentifierExpression): Decl | undefined {
			const id = source.analysis.declarationIdsBySyntax.get(identifier);
			return id === undefined
				? undefined
				: snapshot.symbolResolver.getDeclaration(id);
		},
		getReference(identifier: LuaIdentifierExpression): LuaBoundReference | undefined {
			const ref = source.analysis.referencesBySyntax.get(identifier);
			return ref === undefined ? undefined : bindReference(ref);
		},
		getNavigationTargetsAt(line: number, column: number): readonly LuaSemanticNavigationTarget[] {
			const symbols = findPositionSymbols(source, snapshot, line, column);
			if (symbols) {
				const targets = new Array<LuaSemanticNavigationTarget>(symbols.targets.length);
				for (let index = 0; index < symbols.targets.length; index += 1) {
					const declaration = symbols.targets[index].declaration;
					targets[index] = {
						kind: 'declaration',
						declaration,
						range: declaration.range,
					};
				}
				return targets;
			}
			for (let index = 0; index < requireTargetsByStart.length; index += 1) {
				const target = requireTargetsByStart[index];
				if (!sourcePositionInRange(line, column, target.range)) {
					continue;
				}
				return [{
					kind: 'require_module',
					range: target.target,
					moduleName: target.moduleName,
				}];
			}
			return [];
		},
	};
}

function findPositionSymbols(
	source: LuaSemanticWorkspaceSourceSnapshot,
	snapshot: LuaSemanticWorkspaceSnapshot,
	line: number,
	column: number,
): LuaSemanticPositionSymbols | null {
	const decls = source.analysis.decls;
	for (let index = 0; index < decls.length; index += 1) {
		const decl = decls[index];
		if (sourcePositionInRange(line, column, decl.range)) {
			return {
				origin: decl.range,
				targets: [{ id: decl.id, declaration: decl }],
			};
		}
	}
	const refs = source.analysis.refs;
	for (let index = 0; index < refs.length; index += 1) {
		const ref = refs[index];
		if (!sourcePositionInRange(line, column, ref.range)) {
			continue;
		}
		const targetIds = snapshot.symbolResolver.resolveReferenceTargets(ref);
		if (targetIds.length === 0) {
			continue;
		}
		const targets = new Array<LuaSemanticPositionTarget>(targetIds.length);
		for (let targetIndex = 0; targetIndex < targetIds.length; targetIndex += 1) {
			const targetId = targetIds[targetIndex];
			targets[targetIndex] = {
				id: targetId,
				declaration: snapshot.symbolResolver.getDeclaration(targetId),
			};
		}
		return {
			origin: ref.range,
			targets,
		};
	}
	return null;
}

type LuaRequireNavigationTarget = {
	range: LuaSourceRange;
	moduleName: string;
	target: LuaSourceRange;
};

function collectRequireNavigationTargets(
	source: LuaSemanticWorkspaceSourceSnapshot,
	moduleTargetsByAlias: ReadonlyMap<string, string>,
	sourceByPath: ReadonlyMap<string, LuaSemanticWorkspaceSourceSnapshot>,
): LuaRequireNavigationTarget[] {
	const targets: LuaRequireNavigationTarget[] = [];
	for (let index = 0; index < source.analysis.callExpressions.length; index += 1) {
		const callExpression = source.analysis.callExpressions[index];
		const requireArgument = extractRequireStringArgument(callExpression);
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
	targets.sort((left, right) => compareSourcePosition(left.range.start.line, left.range.start.column, right.range.start.line, right.range.start.column));
	return targets;
}

function extractRequireStringArgument(
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
	source: LuaSemanticWorkspaceSourceSnapshot,
	literal: LuaStringLiteralExpression,
): LuaSourceRange {
	for (let index = 0; index < source.tokens.length; index += 1) {
		const token = source.tokens[index];
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
	sources: readonly LuaSemanticWorkspaceSourceSnapshot[],
): Map<string, string> {
	const aliases = new Map<string, string>();
	for (let index = 0; index < sources.length; index += 1) {
		const source = sources[index];
		const modulePath = toLuaModulePath(source.path);
		if (!aliases.has(modulePath)) {
			aliases.set(modulePath, source.path);
		}
	}
	return aliases;
}

function classifyReference(
	ref: Ref,
	snapshot: LuaSemanticWorkspaceSnapshot,
	knownGlobalNames: ReadonlySet<string>,
): LuaBoundReference {
	const target = snapshot.symbolResolver.resolveReference(ref);
	const decl = target ? snapshot.symbolResolver.getDeclaration(target) : null;
	if (decl && isReferenceInsideDeclScope(ref, decl)) {
		return {
			kind: decl.isGlobal ? 'global' : 'lexical',
			ref,
			decl,
			isImplicitGlobal: false,
		};
	}
	if (ref.referenceKind === 'self') {
		return {
			kind: 'implicit_self',
			ref,
			decl: null,
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
	return compareSourcePosition(ref.range.start.line, ref.range.start.column, decl.scope.start.line, decl.scope.start.column) >= 0
		&& compareSourcePosition(ref.range.start.line, ref.range.start.column, decl.scope.end.line, decl.scope.end.column) <= 0;
}

function buildCombinedGlobalSymbols(decls: readonly Decl[], externalGlobalSymbols?: readonly LuaSymbolEntry[]): LuaSymbolEntry[] {
	const symbols: LuaSymbolEntry[] = [];
	for (let index = 0; index < decls.length; index += 1) {
		const decl = decls[index];
		symbols.push({
			name: decl.name,
			path: decl.namePath.length > 0 ? decl.namePath.join('.') : decl.name,
			kind: semanticSymbolKindToLuaSymbolKind(decl.kind),
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
