import type { LuaChunk, LuaIdentifierExpression, LuaSourceRange } from '../syntax/ast';
import type { LuaBuiltinDescriptor, LuaSymbolEntry } from '../semantic_contracts';
import type { ParsedLuaChunk } from '../analysis/parse';
import {
	buildLuaSemanticWorkspaceSnapshot,
	type Decl,
	type FileSemanticData,
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
import {
	compareSourcePosition,
	findOrderedSourceRangeEntryAtPosition,
} from './source_range';
import { collectVisibleDeclarationsAt } from './scope_query';
import {
	findLuaMemberCompletionContext,
	type LuaMemberCompletionContext,
} from './completion';
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
	label: string;
	targets: readonly LuaSemanticPositionTarget[];
};

export type LuaSemanticReferenceQuery = LuaSemanticPositionSymbols & {
	references: readonly Ref[];
};

export type LuaSemanticNavigationQuery = {
	origin: LuaSourceRange;
	label: string;
	targets: readonly LuaSemanticNavigationTarget[];
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

export type LuaCallHierarchyOutgoingCall = {
	to: LuaCallHierarchySymbolItem;
	fromRanges: readonly LuaSourceRange[];
};

export type LuaSemanticFrontendFile = {
	diagnostics: readonly LuaStaticDiagnostic[];
	getDeclaration(identifier: LuaIdentifierExpression): Decl | undefined;
	getReference(identifier: LuaIdentifierExpression): LuaBoundReference | undefined;
	getVisibleDeclarationsAt(line: number, column: number): readonly Decl[];
	findMemberCompletionContextAt(line: number, memberStartColumn: number): LuaMemberCompletionContext | null;
	getMemberCompletionDeclarations(context: LuaMemberCompletionContext): readonly Decl[];
	findNavigationAt(line: number, column: number): LuaSemanticNavigationQuery | null;
};

export type LuaSemanticFrontend = {
	snapshot: LuaSemanticWorkspaceSnapshot;
	getFile(path: string): LuaSemanticFrontendFile;
	findSymbolsByPosition(path: string, line: number, column: number): LuaSemanticPositionSymbols | null;
	findReferencesByPosition(path: string, line: number, column: number): LuaSemanticReferenceQuery | null;
	provideIncomingCalls(
		symbolId: SymbolID,
		allowedPaths?: ReadonlySet<string>,
	): readonly LuaCallHierarchyIncomingCall[];
	provideOutgoingCalls(
		symbolId: SymbolID,
		allowedPaths?: ReadonlySet<string>,
	): readonly LuaCallHierarchyOutgoingCall[];
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
	private readonly builtinDescriptors: readonly LuaBuiltinDescriptor[];
	private readonly extraGlobalNames: readonly string[] | undefined;
	private readonly globalSymbols: readonly LuaSymbolEntry[];
	private readonly knownGlobalNames: ReadonlySet<string>;
	private readonly moduleTargetsByAlias: ReadonlyMap<string, string>;
	private readonly files: Map<string, LuaSemanticFrontendFile> = new Map();

	constructor(snapshot: LuaSemanticWorkspaceSnapshot, options: LuaSemanticFrontendOptions) {
		this.snapshot = snapshot;
		this.builtinDescriptors = options.builtinDescriptors ?? getDefaultLuaBuiltinDescriptors();
		this.extraGlobalNames = options.extraGlobalNames;
		// Queries remain bound to this immutable source and global-symbol generation.
		this.globalSymbols = buildCombinedGlobalSymbols(snapshot.listGlobalDecls(), options.externalGlobalSymbols);
		this.knownGlobalNames = buildLuaKnownNameSet(
			this.globalSymbols,
			this.builtinDescriptors,
			this.extraGlobalNames,
		);
		this.moduleTargetsByAlias = buildModuleTargetAliasMap(snapshot.files);
	}

	public getFile(path: string): LuaSemanticFrontendFile {
		let file = this.files.get(path);
		if (file) {
			return file;
		}
		const source = this.snapshot.getFileData(path);
		if (!source) {
			throw new Error(`[LuaSemanticFrontend] Missing semantic file '${path}'.`);
		}
		const diagnostics = computeLuaDiagnosticsFromAnalysis({
			analysis: source,
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
			this.snapshot,
		);
		this.files.set(path, file);
		return file;
	}

	public findSymbolsByPosition(path: string, line: number, column: number): LuaSemanticPositionSymbols | null {
		const source = this.snapshot.getFileData(path);
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
			label: symbols.label,
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
					? buildSymbolCallHierarchyItem(this.snapshot.symbolResolver.getDeclaration(reference.caller))
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
			groups[index].fromRanges.sort(compareSourceRangesByStart);
		}
		groups.sort((left, right) => compareCallHierarchyItems(left.from, right.from));
		return groups;
	}

	public provideOutgoingCalls(
		symbolId: SymbolID,
		allowedPaths?: ReadonlySet<string>,
	): readonly LuaCallHierarchyOutgoingCall[] {
		const declaration = this.snapshot.symbolResolver.getDeclaration(symbolId);
		const source: FileSemanticData = this.snapshot.getFileData(declaration.file);
		const callReferences: Ref[] = [];
		for (let index = 0; index < source.refs.length; index += 1) {
			const reference = source.refs[index];
			if (reference.isCall && reference.caller === symbolId) {
				callReferences.push(reference);
			}
		}
		const targetsByReference = this.snapshot.symbolResolver.resolveCallTargets(callReferences);
		const grouped = new Map<SymbolID, OutgoingCalleeGroup>();
		for (let index = 0; index < callReferences.length; index += 1) {
			const reference = callReferences[index];
			const targets = targetsByReference[index];
			for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
				const targetId = targets[targetIndex];
				let bucket = grouped.get(targetId);
				if (!bucket) {
					const target = this.snapshot.symbolResolver.getDeclaration(targetId);
					if (allowedPaths && !allowedPaths.has(target.file)) {
						continue;
					}
					bucket = {
						to: buildSymbolCallHierarchyItem(target),
						fromRanges: [],
					};
					grouped.set(targetId, bucket);
				}
				bucket.fromRanges.push(reference.range);
			}
		}
		const groups = Array.from(grouped.values());
		for (let index = 0; index < groups.length; index += 1) {
			groups[index].fromRanges.sort(compareSourceRangesByStart);
		}
		groups.sort((left, right) => compareCallHierarchyItems(left.to, right.to));
		return groups;
	}
}

type IncomingCallerGroup = {
	from: LuaCallHierarchyItem;
	fromRanges: LuaSourceRange[];
};

type OutgoingCalleeGroup = {
	to: LuaCallHierarchySymbolItem;
	fromRanges: LuaSourceRange[];
};

function buildSymbolCallHierarchyItem(decl: Decl): LuaCallHierarchySymbolItem {
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

function compareSourceRangesByStart(left: LuaSourceRange, right: LuaSourceRange): number {
	if (left.path !== right.path) {
		return left.path.localeCompare(right.path);
	}
	return compareSourcePosition(
		left.start.line,
		left.start.column,
		right.start.line,
		right.start.column,
	);
}

function createBoundFile(
	source: FileSemanticData,
	diagnostics: readonly LuaStaticDiagnostic[],
	knownGlobalNames: ReadonlySet<string>,
	moduleTargetsByAlias: ReadonlyMap<string, string>,
	snapshot: LuaSemanticWorkspaceSnapshot,
): LuaSemanticFrontendFile {
	const requireTargetsByStart = collectRequireNavigationTargets(source, moduleTargetsByAlias, snapshot);
	const boundReferences = new Map<Ref, LuaBoundReference>();
	const bindReference = (ref: Ref): LuaBoundReference => {
		let reference = boundReferences.get(ref);
		if (!reference) {
			reference = classifyReference(ref, source, snapshot, knownGlobalNames);
			boundReferences.set(ref, reference);
		}
		return reference;
	};
	return {
		diagnostics,
		getDeclaration(identifier: LuaIdentifierExpression): Decl | undefined {
			const id = source.declarationIdsBySyntax.get(identifier);
			return id === undefined
				? undefined
				: snapshot.symbolResolver.getDeclaration(id);
		},
		getReference(identifier: LuaIdentifierExpression): LuaBoundReference | undefined {
			const ref = source.referencesBySyntax.get(identifier);
			return ref === undefined ? undefined : bindReference(ref);
		},
		// disable-next-line single_line_method_pattern -- the bound file owns its source while lexical scope traversal remains a shared semantic query.
		getVisibleDeclarationsAt(line: number, column: number): readonly Decl[] {
			return collectVisibleDeclarationsAt(source, line, column);
		},
		// disable-next-line single_line_method_pattern -- the bound file owns its source while member-access lookup remains a shared semantic query.
		findMemberCompletionContextAt(line: number, memberStartColumn: number): LuaMemberCompletionContext | null {
			return findLuaMemberCompletionContext(source, line, memberStartColumn);
		},
		// disable-next-line single_line_method_pattern -- the bound frontend resolves retained semantic receivers against its immutable workspace snapshot.
		getMemberCompletionDeclarations(context: LuaMemberCompletionContext): readonly Decl[] {
			return snapshot.symbolResolver.getMembers(context.receiver);
		},
		findNavigationAt(line: number, column: number): LuaSemanticNavigationQuery | null {
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
				return {
					origin: symbols.origin,
					label: symbols.label,
					targets,
				};
			}
			const target = findOrderedSourceRangeEntryAtPosition(requireTargetsByStart, line, column);
			if (target) {
				return {
					origin: target.range,
					label: target.moduleName,
					targets: [{
						kind: 'require_module',
						range: target.target,
						moduleName: target.moduleName,
					}],
				};
			}
			return null;
		},
	};
}

function findPositionSymbols(
	source: FileSemanticData,
	snapshot: LuaSemanticWorkspaceSnapshot,
	line: number,
	column: number,
): LuaSemanticPositionSymbols | null {
	const decl = findOrderedSourceRangeEntryAtPosition(source.decls, line, column);
	if (decl) {
		return {
			origin: decl.range,
			label: semanticOccurrenceLabel(decl.symbolKey, decl.name, false),
			targets: [{ id: decl.id, declaration: decl }],
		};
	}
	const ref = findOrderedSourceRangeEntryAtPosition(source.refs, line, column);
	if (ref) {
		const targetIds = snapshot.symbolResolver.resolveReferenceTargets(ref);
		if (targetIds.length > 0) {
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
				label: semanticOccurrenceLabel(ref.symbolKey, ref.name, ref.referenceKind === 'method'),
				targets,
			};
		}
	}
	return null;
}

function semanticOccurrenceLabel(
	symbolKey: string,
	name: string,
	method: boolean,
): string {
	if (symbolKey.length === 0) {
		return name;
	}
	if (!method) {
		return symbolKey;
	}
	const separator = symbolKey.lastIndexOf('.');
	return separator === -1 ? name : `${symbolKey.slice(0, separator)}:${name}`;
}

type LuaRequireNavigationTarget = {
	range: LuaSourceRange;
	moduleName: string;
	target: LuaSourceRange;
};

function collectRequireNavigationTargets(
	source: FileSemanticData,
	moduleTargetsByAlias: ReadonlyMap<string, string>,
	snapshot: LuaSemanticWorkspaceSnapshot,
): LuaRequireNavigationTarget[] {
	const targets: LuaRequireNavigationTarget[] = [];
	for (let index = 0; index < source.moduleReferences.length; index += 1) {
		const reference = source.moduleReferences[index];
		const moduleName = reference.value;
		const targetPath = moduleTargetsByAlias.get(moduleName);
		if (!targetPath) {
			continue;
		}
		const targetSource = snapshot.getFileData(targetPath);
		if (!targetSource) {
			continue;
		}
		targets.push({
			range: reference.range,
			moduleName,
			target: targetSource.chunk.range,
		});
	}
	return targets;
}

function buildModuleTargetAliasMap(
	files: readonly FileSemanticData[],
): Map<string, string> {
	const aliases = new Map<string, string>();
	for (let index = 0; index < files.length; index += 1) {
		const file = files[index];
		const modulePath = toLuaModulePath(file.file);
		if (!aliases.has(modulePath)) {
			aliases.set(modulePath, file.file);
		}
	}
	return aliases;
}

function classifyReference(
	ref: Ref,
	source: FileSemanticData,
	snapshot: LuaSemanticWorkspaceSnapshot,
	knownGlobalNames: ReadonlySet<string>,
): LuaBoundReference {
	const target = snapshot.symbolResolver.resolveReference(ref);
	const decl = target ? snapshot.symbolResolver.getDeclaration(target) : null;
	if (decl && isReferenceInsideDeclScope(ref, decl, source)) {
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

function isReferenceInsideDeclScope(ref: Ref, decl: Decl, source: FileSemanticData): boolean {
	if (decl.isGlobal) {
		return true;
	}
	if (decl.file !== ref.file) {
		return false;
	}
	const scope = source.scopes[decl.scopeIndex];
	return compareSourcePosition(
		ref.range.start.line,
		ref.range.start.column,
		scope.startInclusive.line,
		scope.startInclusive.column,
	) >= 0
		&& compareSourcePosition(
			ref.range.start.line,
			ref.range.start.column,
			scope.endExclusive.line,
			scope.endExclusive.column,
		) < 0;
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
