import { createScopeId, type ScopeID, type ScopeKind, type SemanticScope } from './scope_facts';
import type { LuaSyntaxPoint, LuaSyntaxSpan } from '../syntax/source_locations';
import { hashText } from '../../../../machine/ts/common/byte_hex_string';
import { HashMapBuilder } from '../../collections/hash_map';
import { SourceChangeMap } from '../../text/source_changes';
import {
	LuaAssignmentOperator,
	LuaBinaryOperator,
	LuaMemberOperator,
	LuaSyntaxKind,
	LuaTableFieldKind,
	LuaUnaryOperator,
	isRecursiveConstClosureDeclaration,
	isMultiReturnExpression,
	type LuaChunk,
	type LuaBlock,
	type LuaStatement,
	type LuaExpression,
	type LuaAssignableExpression,
	type LuaIdentifierExpression,
	type LuaMemberExpression,
	type LuaIndexExpression,
	type LuaCallExpression,
	type LuaFunctionExpression,
	type LuaForGenericStatement,
	type LuaTableConstructorExpression,
	type LuaTableIdentifierField,
	type LuaStructDeclarationStatement,
	type LuaBssDeclarationStatement,
	type LuaDataDeclarationStatement,
	type LuaRodataDeclarationStatement,
	type LuaFunctionDeclarationStatement,
	type LuaFunctionName,
	type LuaStringLiteralExpression,
	type LuaReturnStatement,
} from '../syntax/ast';
import type { LuaSymbolEntry } from '../semantic_contracts';
import { parseLuaChunkWithRecovery, updateLuaChunk, type ParsedLuaChunk } from '../analysis/parse';
import { LuaCompletionAnalysis, type LuaCompletion } from '../analysis/completion';
import type { LuaSyntaxError } from '../errors';
import { createSymbolId, type SemanticSymbolKind, type SymbolID } from './symbols';
import type { SemanticTokenFact, SemanticRole } from './tokens';
import { toLuaModulePath } from '../module_path';
import { LUA_BUILTIN_TABLE_ITERATOR_ARGUMENTS } from '../builtin_descriptors';
import {
	findLuaModuleExport,
	resolveBuiltinRequireArgument,
} from './module_bindings';
import {
	appendValueElement,
	appendValueIndex,
	appendValueInstance,
	appendValueMember,
	appendValueMetatable,
	declarationValueSource,
	globalValueSource,
	literalExpressionValueSource,
	NIL_VALUE_SOURCE,
	moduleValueSource,
	ownedValueSource,
	unknownValueSource,
	type CallValueEntry,
	type DeclarationSemanticValueSource,
	type DeclarationValueEntry,
	type FunctionReturnValueEntry,
	type FunctionSemanticValueSource,
	type FunctionValueFlowEntry,
	type MemberValueEntry,
	type ModuleValueEntry,
	type OwnedSemanticValueSource,
	type SemanticValueSource,
	type ValueAssignmentEntry,
} from './value_graph';
import { WorkspaceSymbolResolver } from './workspace_symbol_resolver';
import {
	resolveStaticLuaExpressionPath,
	resolveStaticLuaNamePath,
} from './expression_path';

export type { SymbolID } from './symbols';
export type { SemanticScope } from './scope_facts';

const EMPTY_FILE_PATHS: readonly string[] = [];

export type Decl = {
	id: SymbolID;
	file: string;
	name: string;
	namePath: readonly string[];
	symbolKey: string;
	kind: SemanticSymbolKind;
	span: LuaSyntaxSpan;
	scope: ScopeID;
	visibleFrom: LuaSyntaxPoint;
	isGlobal: boolean;
};

export type Ref = {
	file: string;
	name: string;
	namePath: readonly string[];
	symbolKey: string;
	span: LuaSyntaxSpan;
	target?: SymbolID;
	isWrite: boolean;
	isCall: boolean;
	caller?: SymbolID;
	referenceKind: 'identifier' | 'self' | 'member' | 'method';
	/** Identifier storage, independent of a written declaration/navigation target. */
	binding?: FunctionSemanticValueSource;
	staticExpressionPath: string | null;
	receiverSymbolKey?: string;
	receiverValue?: SemanticValueSource;
	call?: CallValueEntry;
};

export type LuaCallSite = {
	readonly expression: LuaCallExpression;
	readonly call: CallValueEntry;
	readonly calleeValue: SemanticValueSource | undefined;
	readonly reference: Ref | undefined;
	readonly directTarget: SymbolID | undefined;
};

export type MemberAccessEntry = {
	readonly span: LuaSyntaxSpan;
	readonly receiver: SemanticValueSource;
	readonly operator: LuaMemberOperator;
	readonly namePath?: readonly string[];
};

/** Identity of immutable binder facts, without retaining their syntax or lookup tables. */
export type LuaFileSemanticRevision = {
	readonly file: string;
	readonly revision: symbol;
};

export type FileSemanticData = LuaFileSemanticRevision & {
	readonly source: string;
	readonly syntaxError: LuaSyntaxError | null;
	readonly chunk: LuaChunk;
	readonly annotationFacts: readonly SemanticTokenFact[];
	readonly decls: readonly Decl[];
	/** Binder order and multiplicity, for snapshot global enumeration. */
	readonly globalDecls: readonly Decl[];
	/** Root-global storage witnesses, last value per symbol in first-key order. */
	readonly globalStorageDecls: readonly Decl[];
	readonly scopes: readonly SemanticScope[];
	readonly scopesById: ReadonlyMap<ScopeID, SemanticScope>;
	readonly scopeParents: ReadonlyMap<ScopeID, ScopeID>;
	readonly refs: readonly Ref[];
	readonly memberAccesses: readonly MemberAccessEntry[];
	readonly declarationIdsBySyntax: ReadonlyMap<LuaIdentifierExpression, SymbolID>;
	readonly referencesBySyntax: ReadonlyMap<LuaIdentifierExpression, Ref>;
	readonly referencesByName: ReadonlyMap<string, readonly Ref[]>;
	readonly moduleReferences: readonly { value: string; span: LuaSyntaxSpan }[];
	readonly callSites: readonly LuaCallSite[];
	readonly declarationValues: readonly DeclarationValueEntry[];
	readonly declarationValuesByDeclaration: ReadonlyMap<SymbolID, readonly DeclarationValueEntry[]>;
	/** Calls/indexers without a reference record; other expressions reuse their existing facts. */
	readonly readValuesBySyntax: ReadonlyMap<LuaExpression, SemanticValueSource>;
	readonly ownedValuesBySyntax: ReadonlyMap<LuaExpression, OwnedSemanticValueSource>;
	readonly moduleValues: readonly ModuleValueEntry[];
	readonly memberValues: readonly MemberValueEntry[];
	readonly functionValueFlows: readonly FunctionValueFlowEntry[];
	readonly callValues: readonly CallValueEntry[];
	readonly valueAssignments: readonly ValueAssignmentEntry[];
};

export type LuaSemanticWorkspaceSnapshotInput = {
	path: string;
	source: string;
	parsed?: ParsedLuaChunk;
	chunk?: LuaChunk;
	analysis?: FileSemanticData;
};

export class LuaSemanticWorkspaceSnapshot {
	/** Unique across workspace lifetimes; a dependent cache need not retain this snapshot. */
	public readonly revision = Symbol();
	public readonly version: number;
	public readonly files: readonly FileSemanticData[];
	public readonly symbolResolver: WorkspaceSymbolResolver;
	private globalDecls: readonly Decl[] | undefined;

	constructor(
		version: number,
		files: readonly FileSemanticData[],
		symbolResolver: WorkspaceSymbolResolver,
	) {
		this.version = version;
		this.files = files;
		this.symbolResolver = symbolResolver;
	}

	public getFileData(path: string): FileSemanticData | undefined {
		return this.symbolResolver.getFileData(path);
	}

	public listGlobalDecls(): readonly Decl[] {
		if (this.globalDecls === undefined) {
			const globals: Decl[] = [];
			for (const file of this.files) {
				for (const decl of file.globalDecls) globals.push(decl);
			}
			this.globalDecls = globals;
		}
		return this.globalDecls;
	}

}

function createWorkspaceSnapshotFromIndex(index: LuaProjectIndex): LuaSemanticWorkspaceSnapshot {
	return new LuaSemanticWorkspaceSnapshot(
		index.getVersion(),
		index.orderedFiles,
		index.symbolResolver,
	);
}

export function buildLuaSemanticWorkspaceSnapshot(
	sources: ReadonlyArray<LuaSemanticWorkspaceSnapshotInput>,
): LuaSemanticWorkspaceSnapshot {
	const workspace = new LuaSemanticWorkspace();
	const analyses = new Array<FileSemanticData>(sources.length);
	for (let index = 0; index < sources.length; index += 1) {
		const source = sources[index];
		if (source.analysis) {
			analyses[index] = source.analysis;
			continue;
		}
		const chunk = source.chunk ?? source.parsed?.chunk ?? parseLuaChunkWithRecovery(source.source, source.path).chunk;
		if (chunk.syntaxError) {
			throw new Error(`[LuaSemanticWorkspace] Syntax error in ${source.path}: ${chunk.syntaxError.message}`);
		}
		analyses[index] = buildLuaFileSemanticData(
			source.source,
			source.path,
			undefined,
			chunk,
		);
	}
	workspace.updateFiles(analyses);
	return workspace.getSnapshot();
}

type Scope = {
	id: ScopeID;
	kind: ScopeKind;
	startInclusive: LuaSyntaxPoint;
	endExclusive: LuaSyntaxPoint;
	parent: Scope;
	bindings: Map<string, InternalBinding>;
	declarations: InternalDecl[];
	implicitSelfValue?: OwnedSemanticValueSource;
};

type InternalDecl = Decl & {
	/** Build-local publication slot; never retained by a published fact. */
	publicationSlot: number;
	scopeRef: Scope;
	active: boolean;
	valueSource: DeclarationSemanticValueSource;
};

type ImplicitReceiverBinding = {
	readonly kind: 'receiver';
	readonly name: 'self';
	readonly valueSource: OwnedSemanticValueSource;
};

type InternalBinding = InternalDecl | ImplicitReceiverBinding;

type ResolvedNamePath = {
	readonly namePath: string[] | null;
	readonly decl: InternalDecl | null;
	readonly valueSource: SemanticValueSource;
};

const UNKNOWN_EXPRESSION_VALUE: ResolvedNamePath = {
	namePath: null,
	decl: null,
	valueSource: unknownValueSource(),
};

type ExpressionContext = {
	tableBaseDecl: InternalDecl;
	tableBasePath: readonly string[];
	tableOwner?: SemanticValueSource;
};

type FunctionValueFlowState = {
	id: ScopeID;
	expression: LuaFunctionExpression;
	declaration: SymbolID | undefined;
	functionValue: OwnedSemanticValueSource;
	parameters: FunctionSemanticValueSource[];
	receiverProjection?: SemanticValueSource;
	implicitReceiver: boolean;
	completion: LuaCompletion;
	declarationIds: SymbolID[];
	ownedValues: OwnedSemanticValueSource[];
	members: MemberValueEntry[];
	calls: CallValueEntry[];
	assignments: ValueAssignmentEntry[];
	returns: FunctionReturnValueEntry[];
};

type AssignmentTargetInfo = {
	decl: InternalDecl;
	namePath: readonly string[];
	path: string | null;
	valueTarget?: SemanticValueSource;
	memberBaseDecl?: InternalDecl;
	memberOwner?: SemanticValueSource;
};

type SemanticBuildResult = {
	decls: InternalDecl[];
	scopes: Scope[];
	refs: Ref[];
	memberAccesses: MemberAccessEntry[];
	declarationIdsBySyntax: Map<LuaIdentifierExpression, SymbolID>;
	referencesBySyntax: Map<LuaIdentifierExpression, Ref>;
	referencesByName: Map<string, Ref[]>;
	annotationFacts: SemanticTokenFact[];
	callSites: LuaCallSite[];
	declarationValues: DeclarationValueEntry[];
	declarationValuesByDeclaration: Map<SymbolID, DeclarationValueEntry[]>;
	readValuesBySyntax: Map<LuaExpression, SemanticValueSource>;
	ownedValuesBySyntax: Map<LuaExpression, OwnedSemanticValueSource>;
	moduleValues: ModuleValueEntry[];
	memberValues: MemberValueEntry[];
	functionValueFlows: FunctionValueFlowEntry[];
	callValues: CallValueEntry[];
	valueAssignments: ValueAssignmentEntry[];
	moduleReferences: { value: string; span: LuaSyntaxSpan }[];
};

export function buildLuaFileSemanticData(
	source: string,
	path: string,
	parsed?: ParsedLuaChunk,
	chunk?: LuaChunk,
): FileSemanticData {
	const retainedChunk = chunk ?? parsed?.chunk ?? parseLuaChunkWithRecovery(source, path).chunk;
	const tokens = retainedChunk.tokens;
	const eof = tokens.get(tokens.length - 1);
	const builder = new SemanticBuilder({
		path,
		chunk: retainedChunk,
		documentEndExclusive: {
			unit: eof.unit,
			offset: eof.end + 1,
		},
	});
	const result = builder.build();
	const decls = new Array<Decl>(result.decls.length);
	const globalDecls: Decl[] = [];
	const globalStorageDecls = new Map<SymbolID, Decl>();
	for (let index = 0; index < result.decls.length; index++) {
		const decl = toDecl(result.decls[index]);
		decls[index] = decl;
		if (decl.isGlobal) {
			globalDecls.push(decl);
			if (decl.namePath.length === 1) globalStorageDecls.set(decl.id, decl);
		}
	}
	const scopes = new Array<SemanticScope>(result.scopes.length);
	const scopesById = new Map<ScopeID, SemanticScope>();
	const scopeParents = new Map<ScopeID, ScopeID>();
	for (let index = 0; index < result.scopes.length; index++) {
		const internal = result.scopes[index];
		const scope: SemanticScope = {
			id: internal.id,
			kind: internal.kind,
			startInclusive: internal.startInclusive,
			endExclusive: internal.endExclusive,
			declarations: internal.declarations.map(decl => decls[decl.publicationSlot]),
			implicitSelfValue: internal.implicitSelfValue,
		};
		scopes[index] = scope;
		scopesById.set(scope.id, scope);
		if (internal.parent) scopeParents.set(scope.id, internal.parent.id);
	}
	const refs = result.refs.slice();
	return {
		file: path,
		revision: Symbol(),
		source,
		syntaxError: retainedChunk.syntaxError,
		chunk: retainedChunk,
		annotationFacts: result.annotationFacts,
		decls,
		globalDecls,
		globalStorageDecls: Array.from(globalStorageDecls.values()),
		scopes,
		scopesById,
		scopeParents,
		refs,
		memberAccesses: result.memberAccesses,
		declarationIdsBySyntax: result.declarationIdsBySyntax,
		referencesBySyntax: result.referencesBySyntax,
		referencesByName: result.referencesByName,
		moduleReferences: result.moduleReferences,
		callSites: result.callSites,
		declarationValues: result.declarationValues,
		declarationValuesByDeclaration: result.declarationValuesByDeclaration,
		readValuesBySyntax: result.readValuesBySyntax,
		ownedValuesBySyntax: result.ownedValuesBySyntax,
		moduleValues: result.moduleValues,
		memberValues: result.memberValues,
		functionValueFlows: result.functionValueFlows,
		callValues: result.callValues,
		valueAssignments: result.valueAssignments,
	};
}

class LuaProjectIndex {
	private readonly files: Map<string, FileSemanticData> = new Map();
	private readonly symbols = new HashMapBuilder<SymbolID, Decl>(hashText);
	/** Symbol insertion order differs from navigation file precedence after edits. */
	private readonly storageContributions = new Map<string, readonly Decl[]>();
	private readonly globalsByKey: Map<string, SymbolID> = new Map();
	private readonly globalsSources: Map<string, Map<SymbolID, Decl>> = new Map();
	private readonly fileOrder: Map<string, number> = new Map();
	public orderedFiles: readonly FileSemanticData[] = [];
	public symbolResolver: WorkspaceSymbolResolver;
	private version = 0;
	private nextFileOrder = 1;

	constructor() {
		this.symbolResolver = this.buildWorkspaceSymbolResolver();
	}

	public updateFile(file: string, source: string, input?: ParsedLuaChunk | SourceChangeMap): FileSemanticData {
		const current = this.files.get(file);
		if (current && current.source === source && (input === undefined || input instanceof SourceChangeMap || current.chunk === input.chunk)) {
			return current;
		}
		const parsed = input instanceof SourceChangeMap ? updateLuaChunk(current!.chunk, source, input) : input;
		const data = buildLuaFileSemanticData(source, file, parsed);
		this.replaceIndexedFile(file, data);
		this.commitFileChanges();
		return data;
	}

	public updateFiles(
		files: readonly FileSemanticData[],
		removedFiles: readonly string[] = EMPTY_FILE_PATHS,
	): boolean {
		let changed = false;
		for (let index = 0; index < removedFiles.length; index += 1) {
			const file = removedFiles[index];
			const current = this.files.get(file);
			if (!current) {
				continue;
			}
			this.removeFileData(current);
			this.files.delete(file);
			this.fileOrder.delete(file);
			changed = true;
		}
		for (let index = 0; index < files.length; index += 1) {
			const data = files[index];
			const file = data.file;
			changed = this.replaceIndexedFile(file, data) || changed;
		}
		if (changed) {
			this.commitFileChanges();
		}
		return changed;
	}

	public getVersion(): number {
		return this.version;
	}

	public getFileData(file: string): FileSemanticData | undefined {
		return this.files.get(file);
	}

	private applyFileData(data: FileSemanticData): void {
		for (let i = 0; i < data.decls.length; i += 1) {
			const decl = data.decls[i];
			this.symbols.set(decl.id, decl);
		}
		for (const decl of data.globalDecls) this.addGlobalDecl(decl);
		this.storageContributions.set(data.file, data.globalStorageDecls);
	}

	private removeFileData(data: FileSemanticData): void {
		for (let i = 0; i < data.decls.length; i += 1) {
			const decl = data.decls[i];
			this.symbols.delete(decl.id);
		}
		for (const decl of data.globalDecls) this.removeGlobalDecl(decl);
		this.storageContributions.delete(data.file);
	}

	private addGlobalDecl(decl: Decl): void {
		const key = decl.symbolKey;
		let bucket = this.globalsSources.get(key);
		if (!bucket) {
			bucket = new Map();
			this.globalsSources.set(key, bucket);
		}
		bucket.set(decl.id, decl);
		const current = this.globalsByKey.get(key) ;
		const selected = this.selectGlobalForKey(bucket);
		if (selected !== current) this.globalsByKey.set(key, selected);
	}

	private removeGlobalDecl(decl: Decl): void {
		const key = decl.symbolKey;
		const bucket = this.globalsSources.get(key);
		if (!bucket) {
			if (this.globalsByKey.get(key) === decl.id) {
				this.globalsByKey.delete(key);
			}
			return;
		}
		bucket.delete(decl.id);
		if (bucket.size === 0) {
			this.globalsSources.delete(key);
			if (this.globalsByKey.get(key) === decl.id) {
				this.globalsByKey.delete(key);
			}
			return;
		}
		const current = this.globalsByKey.get(key) ;
		const selected = this.selectGlobalForKey(bucket);
		if (selected !== current) this.globalsByKey.set(key, selected);
	}

	private selectGlobalForKey(bucket: Map<SymbolID, Decl>): SymbolID {
		let selected: Decl | undefined;
		let best = Number.POSITIVE_INFINITY;
		for (const declaration of bucket.values()) {
			const order = this.fileOrder.get(declaration.file)!;
			// Navigation precedence is source-defined, never allocated-ID order.
			if (order < best) {
				best = order;
				selected = declaration;
			} else if (order === best) {
				const locations = this.files.get(declaration.file)!.chunk.locations;
				if (locations.offset(declaration.span.unit, declaration.span.start)
					< locations.offset(selected!.span.unit, selected!.span.start)) selected = declaration;
			}
		}
		return selected!.id;
	}

	private ensureFileOrder(file: string): number {
		const existing = this.fileOrder.get(file);
		if (existing !== undefined) {
			return existing;
		}
		const order = this.nextFileOrder;
		this.fileOrder.set(file, order);
		this.nextFileOrder += 1;
		return order;
	}

	private buildOrderedFiles(): FileSemanticData[] {
		const orderedFiles = Array.from(this.files.values());
		orderedFiles.sort((left, right) => this.fileOrder.get(left.file)! - this.fileOrder.get(right.file)!);
		return orderedFiles;
	}

	private buildWorkspaceSymbolResolver(): WorkspaceSymbolResolver {
		const globals = new Map(this.globalsByKey);
		return new WorkspaceSymbolResolver({
			files: this.orderedFiles,
			declarations: this.symbols.snapshot(),
			globalStorage: Array.from(this.storageContributions.values()),
			globals,
		});
	}

	private replaceIndexedFile(file: string, data: FileSemanticData): boolean {
		const current = this.files.get(file);
		if (current === data) {
			return false;
		}
		if (current) {
			this.removeFileData(current);
		}
		this.files.set(file, data);
		this.ensureFileOrder(file);
		this.applyFileData(data);
		return true;
	}

	private commitFileChanges(): void {
		this.orderedFiles = this.buildOrderedFiles();
		this.symbolResolver = this.buildWorkspaceSymbolResolver();
		this.version += 1;
	}
}

class SemanticBuilder {
	private readonly chunk: LuaChunk;
	private readonly path: string;
	private readonly documentEndExclusive: LuaSyntaxPoint;
	private readonly annotationFacts: SemanticTokenFact[] = [];
	private readonly scopeStack: Scope[] = [];
	private readonly scopes: Scope[] = [];
	private readonly globalsByKey: Map<string, InternalDecl> = new Map();
	private readonly decls: InternalDecl[] = [];
	private readonly declById: Map<SymbolID, InternalDecl> = new Map();
	private readonly refs: Ref[] = [];
	private readonly memberAccesses: MemberAccessEntry[] = [];
	private readonly declarationIdsBySyntax: Map<LuaIdentifierExpression, SymbolID> = new Map();
	private readonly referencesBySyntax: Map<LuaIdentifierExpression, Ref> = new Map();
	private readonly referencesByName: Map<string, Ref[]> = new Map();
	private readonly moduleReferences: { value: string; span: LuaSyntaxSpan }[] = [];
	private readonly callSites: LuaCallSite[] = [];
	private readonly declarationValues: DeclarationValueEntry[] = [];
	private readonly readValuesBySyntax = new Map<LuaExpression, SemanticValueSource>();
	private readonly ownedValuesBySyntax = new Map<LuaExpression, OwnedSemanticValueSource>();
	// Shared immutable write index after binding; no query rebuilds or value deduplication.
	private readonly declarationValuesByDeclaration: Map<SymbolID, DeclarationValueEntry[]> = new Map();
	private readonly unknownValueDeclarations: Set<SymbolID> = new Set();
	private readonly memberValues: MemberValueEntry[] = [];
	private readonly functionValueFlows: FunctionValueFlowEntry[] = [];
	private readonly completionAnalysis = new LuaCompletionAnalysis();
	private readonly callValues: CallValueEntry[] = [];
	private readonly valueAssignments: ValueAssignmentEntry[] = [];
	private readonly moduleExport: LuaReturnStatement | undefined;
	private readonly bypassingModuleReturns: LuaReturnStatement[] = [];
	private moduleValue: ModuleValueEntry | undefined;
	private readonly functionValueFlowStack: FunctionValueFlowState[] = [];

	constructor(options: {
		chunk: LuaChunk;
		path: string;
		documentEndExclusive: LuaSyntaxPoint;
	}) {
		this.chunk = options.chunk;
		this.moduleExport = findLuaModuleExport(this.chunk);
		this.path = options.path;
		this.documentEndExclusive = options.documentEndExclusive;
	}

	public build(): SemanticBuildResult {
		this.enterScope(
			{ unit: this.chunk.span.unit, offset: 0 },
			this.documentEndExclusive,
			'path',
		);
		for (const cursor = this.chunk.body.cursor(); cursor.statement !== undefined; cursor.advance()) {
			this.visitStatement(cursor.statement);
		}
		this.leaveScope();
		return {
			decls: this.decls,
			scopes: this.scopes,
			refs: this.refs,
			memberAccesses: this.memberAccesses,
			declarationIdsBySyntax: this.declarationIdsBySyntax,
			referencesBySyntax: this.referencesBySyntax,
			referencesByName: this.referencesByName,
			annotationFacts: this.annotationFacts,
			callSites: this.callSites,
			declarationValues: this.declarationValues,
			declarationValuesByDeclaration: this.declarationValuesByDeclaration,
			readValuesBySyntax: this.readValuesBySyntax,
			ownedValuesBySyntax: this.ownedValuesBySyntax,
			moduleValues: this.moduleValue === undefined ? [] : [this.moduleValue],
			memberValues: this.memberValues,
			functionValueFlows: this.functionValueFlows,
			callValues: this.callValues,
			valueAssignments: this.valueAssignments,
			moduleReferences: this.moduleReferences,
		};
	}

	private visitStatement(statement: LuaStatement): void {
		switch (statement.kind) {
			case LuaSyntaxKind.LocalAssignmentStatement: {
				const localAssignment = statement;
				const pending: InternalDecl[] = [];
				for (let index = 0; index < localAssignment.names.length; index += 1) {
					const name = localAssignment.names[index];
					const kind = localAssignment.attributes[index] !== null ? 'constant' : 'local';
					const decl = this.declareLocal(name, kind, false);
					pending.push(decl);
					const pointerTypeRef = localAssignment.pointerTypeRefs[index];
					if (pointerTypeRef !== null) {
						for (const lengthExpression of pointerTypeRef.arrayLengths) {
							if (lengthExpression) {
								this.visitExpression(lengthExpression, { tableBaseDecl: null, tableBasePath: null });
							}
						}
					}
				}
				if (isRecursiveConstClosureDeclaration(localAssignment)) {
					this.activateDecl(pending[0], pending[0].visibleFrom);
				}
				const valueLimit = localAssignment.values.length;
				for (let index = 0; index < valueLimit; index += 1) {
					const valueExpression = localAssignment.values[index];
					const targetDecl = pending[index];
					const context: ExpressionContext = {
						tableBaseDecl: targetDecl,
						tableBasePath: targetDecl?.namePath,
					};
					if (targetDecl) {
						context.tableOwner = targetDecl.valueSource;
					}
					const valueInfo = this.visitExpression(valueExpression, context);
					if (targetDecl) {
						this.setDeclarationValue(targetDecl, valueInfo.valueSource, statement, index);
					}
				}
				for (let index = 0; index < pending.length; index += 1) {
					if (index >= localAssignment.values.length) {
						const source = valueLimit > 0 && isMultiReturnExpression(localAssignment.values[valueLimit - 1])
							? unknownValueSource() : NIL_VALUE_SOURCE;
						this.setDeclarationValue(pending[index], source, statement, index);
					}
					this.activateDecl(pending[index], { unit: localAssignment.span.unit, offset: localAssignment.span.end });
				}
				break;
			}
			case LuaSyntaxKind.LocalFunctionStatement: {
				const localFunction = statement;
				const decl = this.declareLocal(localFunction.name, 'function', true);
				const functionValue = this.createExpressionValueSource(localFunction.functionExpression);
				this.setDeclarationValue(decl, functionValue, statement, 0);
				this.visitFunctionExpression(
					localFunction.functionExpression,
					undefined,
					functionValue,
					decl.id,
					'function',
				);
				break;
			}
			case LuaSyntaxKind.FunctionDeclarationStatement: {
				const functionDeclaration = statement;
				const namePath = buildFunctionNamePath(functionDeclaration.name);
				const functionOwner = this.resolveMemberOwnerSource(namePath);
				const identifierTarget = namePath.length === 1
					? this.handleIdentifierExpression(functionDeclaration.name.path[0], true, false, 'function')
					: undefined;
				const declarationName = functionDeclaration.name.method
					?? functionDeclaration.name.path[functionDeclaration.name.path.length - 1];
				const decl = identifierTarget
					? identifierTarget.decl
					: this.declareMember(namePath, declarationName, undefined, functionOwner!, 'function');
				if (!identifierTarget) {
					this.recordFunctionNameReferences(functionDeclaration);
					this.recordFunctionDeclarationWriteReference(functionDeclaration, decl, functionOwner!);
				}
				const functionPath = functionDeclaration.name.path;
				const baseNames = new Array<string>(functionPath.length);
				for (let pathIndex = 0; pathIndex < functionPath.length; pathIndex += 1) {
					baseNames[pathIndex] = functionPath[pathIndex].name;
				}
				const methodName = functionDeclaration.name.method?.name;
				const methodReceiverClass = methodName ? functionOwner : undefined;
				let methodSelfPath = methodName ? baseNames : undefined;
				if (!methodSelfPath
					&& baseNames.length > 1
					&& functionDeclaration.functionExpression.parameters[0]?.name === 'self') {
					methodSelfPath = baseNames.slice(0, -1);
				}
				const functionValue = this.createExpressionValueSource(functionDeclaration.functionExpression);
				if (decl) this.setDeclarationValue(decl, functionValue, statement, 0);
				else this.recordValueFlow(identifierTarget.valueSource, functionValue, 'value', statement, 0);
				this.visitFunctionExpression(
					functionDeclaration.functionExpression,
					methodSelfPath,
					functionValue,
					decl?.id,
					methodName === undefined ? 'function' : 'method',
					methodReceiverClass,
				);
				break;
			}
			case LuaSyntaxKind.AssignmentStatement: {
				const assignment = statement;
				const isAssignment = assignment.operator === LuaAssignmentOperator.Assign;
				const targets: AssignmentTargetInfo[] = [];
				for (let index = 0; index < assignment.left.length; index += 1) {
					targets.push(this.handleAssignmentTarget(assignment.left[index]));
				}
				for (let index = 0; index < assignment.right.length; index += 1) {
					const targetInfo = targets[index];
					const context: ExpressionContext = targetInfo && isAssignment
						? {
							tableBaseDecl: targetInfo.decl,
							tableBasePath: targetInfo.decl ? targetInfo.decl.namePath : targetInfo.namePath,
						}
						: { tableBaseDecl: null, tableBasePath: null };
					if (targetInfo?.decl && isAssignment) {
						context.tableOwner = targetInfo.decl.valueSource;
					}
					const valueExpression = assignment.right[index];
					if (valueExpression.kind === LuaSyntaxKind.FunctionExpression && isAssignment) {
						const targetPath = targetInfo?.namePath;
						let selfPath: readonly string[] | undefined;
						if (targetPath
							&& targetPath.length > 1
							&& valueExpression.parameters[0]?.name === 'self') {
							selfPath = targetPath.slice(0, -1);
						}
						const functionValue = this.createExpressionValueSource(valueExpression);
						this.visitFunctionExpression(valueExpression, selfPath, functionValue, targetInfo?.decl?.id, 'function');
						if (targetInfo?.decl) {
							this.setDeclarationValue(targetInfo.decl, functionValue, statement, index);
						}
						if (targetInfo?.valueTarget) {
							this.recordValueFlow(targetInfo.valueTarget, functionValue, 'value', statement, index);
						}
						continue;
					}
					const valueInfo = this.visitExpression(valueExpression, context);
					const source = isAssignment ? valueInfo.valueSource : unknownValueSource();
					if (targetInfo?.decl) {
						this.setDeclarationValue(targetInfo.decl, source, statement, index);
					}
					if (targetInfo?.valueTarget) {
						this.recordValueFlow(targetInfo.valueTarget, source, 'value', statement, index);
					}
				}
				for (let index = 0; index < assignment.left.length; index += 1) {
					if (index >= assignment.right.length) {
						const source = assignment.right.length > 0
							&& isMultiReturnExpression(assignment.right[assignment.right.length - 1])
							? unknownValueSource() : NIL_VALUE_SOURCE;
						const targetInfo = targets[index];
						if (targetInfo.decl) this.setDeclarationValue(targetInfo.decl, source, statement, index);
						if (targetInfo.valueTarget) this.recordValueFlow(targetInfo.valueTarget, source, 'value', statement, index);
					}
				}
				break;
			}
			case LuaSyntaxKind.ReturnStatement: {
				const returnStatement = statement;
				let returnValue: SemanticValueSource = NIL_VALUE_SOURCE;
				for (let index = 0; index < returnStatement.expressions.length; index += 1) {
					const valueInfo = this.visitExpression(
						returnStatement.expressions[index],
						{
							tableBaseDecl: null,
							tableBasePath: null,
						},
					);
					if (index === 0) {
						returnValue = valueInfo.valueSource;
					}
				}
				const flow = this.functionValueFlowStack[this.functionValueFlowStack.length - 1];
				if (flow) {
					flow.returns.push({
						statement: returnStatement,
						firstValue: returnValue,
					});
				} else if (statement === this.moduleExport) {
					this.moduleValue = {
						module: toLuaModulePath(this.path), source: returnValue,
						statement, bypassingReturns: this.bypassingModuleReturns,
					};
				} else this.bypassingModuleReturns.push(statement);
				break;
			}
			case LuaSyntaxKind.IfStatement: {
				const ifStatement = statement;
				for (let index = 0; index < ifStatement.clauses.length; index += 1) {
					const clause = ifStatement.clauses[index];
					if (clause.condition) {
						this.visitExpression(clause.condition, { tableBaseDecl: null, tableBasePath: null });
					}
					this.enterScope(
						{ unit: clause.block.span.unit, offset: clause.block.startInclusive },
						{ unit: clause.block.span.unit, offset: clause.block.endExclusive },
						'block',
					);
					this.visitBlock(clause.block);
					this.leaveScope();
				}
				break;
			}
			case LuaSyntaxKind.WhileStatement: {
				const whileStatement = statement;
				this.visitExpression(whileStatement.condition, { tableBaseDecl: null, tableBasePath: null });
				this.enterScope(
					{ unit: whileStatement.block.span.unit, offset: whileStatement.block.startInclusive },
					{ unit: whileStatement.block.span.unit, offset: whileStatement.block.endExclusive },
					'loop',
				);
				this.visitBlock(whileStatement.block);
				this.leaveScope();
				break;
			}
			case LuaSyntaxKind.RepeatStatement: {
				const repeatStatement = statement;
				this.enterScope(
					{ unit: repeatStatement.block.span.unit, offset: repeatStatement.block.startInclusive },
					{ unit: repeatStatement.span.unit, offset: repeatStatement.span.end + 1 },
					'loop',
				);
				this.visitBlock(repeatStatement.block);
				this.visitExpression(repeatStatement.condition, { tableBaseDecl: null, tableBasePath: null });
				this.leaveScope();
				break;
			}
			case LuaSyntaxKind.ForNumericStatement: {
				const forNumeric = statement;
				this.visitExpression(forNumeric.start, { tableBaseDecl: null, tableBasePath: null });
				this.visitExpression(forNumeric.limit, { tableBaseDecl: null, tableBasePath: null });
				if (forNumeric.step) {
					this.visitExpression(forNumeric.step, { tableBaseDecl: null, tableBasePath: null });
				}
				this.enterScope(
					{ unit: forNumeric.block.span.unit, offset: forNumeric.block.startInclusive },
					{ unit: forNumeric.block.span.unit, offset: forNumeric.block.endExclusive },
					'loop',
				);
				const variable = this.declareLocal(forNumeric.variable, 'local', true);
				this.unknownValueDeclarations.add(variable.id);
				this.setDeclarationValue(variable, unknownValueSource(), statement, 0);
				this.visitBlock(forNumeric.block);
				this.leaveScope();
				break;
			}
			case LuaSyntaxKind.ForGenericStatement: {
				const forGeneric = statement;
				for (let index = 0; index < forGeneric.iterators.length; index += 1) {
					this.visitExpression(forGeneric.iterators[index], { tableBaseDecl: null, tableBasePath: null });
				}
				const tableSource = this.resolveGenericForTableSource(forGeneric);
				this.enterScope(
					{ unit: forGeneric.block.span.unit, offset: forGeneric.block.startInclusive },
					{ unit: forGeneric.block.span.unit, offset: forGeneric.block.endExclusive },
					'loop',
				);
				for (let index = 0; index < forGeneric.variables.length; index += 1) {
					const variable = this.declareLocal(forGeneric.variables[index], 'local', true);
					if (index === 0) {
						this.unknownValueDeclarations.add(variable.id);
					}
					if (tableSource && index === 1) {
						this.setDeclarationValue(variable, appendValueElement(tableSource), statement, index, 'projection');
					} else {
						this.setDeclarationValue(variable, unknownValueSource(), statement, index);
					}
				}
				this.visitBlock(forGeneric.block);
				this.leaveScope();
				break;
			}
			case LuaSyntaxKind.DoStatement: {
				const doStatement = statement;
				this.enterScope(
					{ unit: doStatement.block.span.unit, offset: doStatement.block.startInclusive },
					{ unit: doStatement.block.span.unit, offset: doStatement.block.endExclusive },
					'block',
				);
				this.visitBlock(doStatement.block);
				this.leaveScope();
				break;
			}
			case LuaSyntaxKind.CallStatement: {
				const callStatement = statement;
				this.visitExpression(callStatement.expression, { tableBaseDecl: null, tableBasePath: null });
				break;
			}
			case LuaSyntaxKind.StructDeclarationStatement: {
				const structDeclaration = statement as LuaStructDeclarationStatement;
				this.declareType(structDeclaration.name);
				for (const field of structDeclaration.fields) {
					for (const lengthExpression of field.typeRef.arrayLengths) {
						if (lengthExpression) {
							this.visitExpression(lengthExpression, { tableBaseDecl: null, tableBasePath: null });
						}
					}
				}
				break;
			}
			case LuaSyntaxKind.BssDeclarationStatement: {
				const bssDeclaration = statement as LuaBssDeclarationStatement;
				this.declareBss(bssDeclaration.name);
				for (const lengthExpression of bssDeclaration.typeRef.arrayLengths) {
					if (lengthExpression) {
						this.visitExpression(lengthExpression, { tableBaseDecl: null, tableBasePath: null });
					}
				}
				break;
			}
			case LuaSyntaxKind.DataDeclarationStatement: {
				const dataDeclaration = statement as LuaDataDeclarationStatement;
				this.declareData(dataDeclaration.name);
				for (const lengthExpression of dataDeclaration.typeRef.arrayLengths) {
					if (lengthExpression) {
						this.visitExpression(lengthExpression, { tableBaseDecl: null, tableBasePath: null });
					}
				}
				this.visitExpression(dataDeclaration.initializer, { tableBaseDecl: null, tableBasePath: null });
				break;
			}
			case LuaSyntaxKind.RodataDeclarationStatement: {
				const rodataDeclaration = statement as LuaRodataDeclarationStatement;
				this.declareRodata(rodataDeclaration.name);
				for (const lengthExpression of rodataDeclaration.typeRef.arrayLengths) {
					if (lengthExpression) {
						this.visitExpression(lengthExpression, { tableBaseDecl: null, tableBasePath: null });
					}
				}
				this.visitExpression(rodataDeclaration.initializer, { tableBaseDecl: null, tableBasePath: null });
				break;
			}
			case LuaSyntaxKind.ErrorStatement:
				this.visitExpression(statement.expression, { tableBaseDecl: null, tableBasePath: null });
				break;
			default: {
				this.visitGenericStatement(statement);
				break;
			}
		}
	}

	private visitGenericStatement(statement: LuaStatement): void {
		switch (statement.kind) {
			case LuaSyntaxKind.GotoStatement:
			case LuaSyntaxKind.LabelStatement:
			case LuaSyntaxKind.BreakStatement:
				return;
			default:
				return;
		}
	}

	private visitBlock(block: LuaBlock): void {
		for (const cursor = block.body.cursor(); cursor.statement !== undefined; cursor.advance()) {
			this.visitStatement(cursor.statement);
		}
	}

	private visitExpression(expression: LuaExpression, context: ExpressionContext): ResolvedNamePath {
		switch (expression.kind) {
			case LuaSyntaxKind.IdentifierExpression:
				return this.handleIdentifierExpression(expression, false);
			case LuaSyntaxKind.MemberExpression:
				return this.handleMemberExpression(expression, context, false);
			case LuaSyntaxKind.IndexExpression: {
				const value = this.handleIndexExpression(expression, context);
				this.readValuesBySyntax.set(expression, value.valueSource);
				return value;
			}
			case LuaSyntaxKind.CallExpression: {
				const callExpression = expression;
				const methodName = callExpression.method?.name;
				const callResult = this.createExpressionValueSource(callExpression);
				const calleeInfo = methodName
					? this.visitExpression(callExpression.callee, context)
					: this.visitCallTarget(callExpression.callee, context);
				const requireArgument = resolveBuiltinRequireArgument(
					callExpression,
					calleeInfo.valueSource.root.kind === 'global',
				);
				if (requireArgument) {
					this.moduleReferences.push({ value: requireArgument.value, span: requireArgument.span });
				}
				let callReference: Ref | undefined;
				if (methodName) {
					callReference = this.recordMethodReference(callExpression, calleeInfo);
				} else if (callExpression.callee.kind === LuaSyntaxKind.IdentifierExpression) {
					callReference = this.referencesBySyntax.get(callExpression.callee);
				} else if (callExpression.callee.kind === LuaSyntaxKind.MemberExpression
					&& callExpression.callee.member.kind === LuaSyntaxKind.IdentifierExpression) {
					callReference = this.referencesBySyntax.get(callExpression.callee.member);
				}
				const calledValue = methodName
					? appendValueMember(calleeInfo.valueSource, methodName)
					: calleeInfo.valueSource;
				let firstArgumentInfo: ResolvedNamePath = null;
				let secondArgumentInfo: ResolvedNamePath = null;
				const argumentOffset = methodName ? 1 : 0;
				const argumentValues = new Array<SemanticValueSource>(
					callExpression.arguments.length + argumentOffset,
				);
				if (methodName) {
					argumentValues[0] = calleeInfo.valueSource;
				}
				for (let index = 0; index < callExpression.arguments.length; index += 1) {
					const argumentInfo = this.visitExpression(
						callExpression.arguments[index],
						{ tableBaseDecl: null, tableBasePath: null },
					);
					if (index === 0) {
						firstArgumentInfo = argumentInfo;
					}
					if (index === 1) {
						secondArgumentInfo = argumentInfo;
					}
					argumentValues[index + argumentOffset] = argumentInfo.valueSource;
				}
				const call: CallValueEntry = {
					file: this.path,
					expression: callExpression,
					callee: calledValue,
					arguments: argumentValues,
					result: callResult,
				};
				this.recordCallValue(call, callReference);
				this.callSites.push({
					expression: callExpression,
					call,
					calleeValue: calledValue,
					reference: callReference,
					directTarget: callReference === undefined
						&& calleeInfo.namePath !== null
						? calleeInfo.decl?.id
						: undefined,
				});
				const valueSource = this.resolveCallResultValue(
					callExpression,
					requireArgument,
					calleeInfo,
					firstArgumentInfo,
					secondArgumentInfo,
					callResult,
				);
				this.readValuesBySyntax.set(expression, valueSource);
				return { namePath: null, decl: null, valueSource };
			}
			case LuaSyntaxKind.FunctionExpression: {
				const functionValue = this.createExpressionValueSource(expression);
				this.visitFunctionExpression(expression, undefined, functionValue, context.tableBaseDecl?.id, 'function');
				return { namePath: null, decl: context.tableBaseDecl, valueSource: functionValue };
			}
			case LuaSyntaxKind.TableConstructorExpression: {
				const tableOwner = this.createExpressionValueSource(expression);
				this.visitTableConstructorExpression(expression, {
					...context,
					tableOwner,
				});
				return context.tableBasePath
					? {
						namePath: context.tableBasePath.slice(),
						decl: context.tableBaseDecl,
						valueSource: tableOwner,
					}
					: { namePath: null, decl: null, valueSource: tableOwner };
			}
			case LuaSyntaxKind.BinaryExpression: {
				const left = this.visitExpression(expression.left, context);
				const right = this.visitExpression(expression.right, context);
				if (expression.operator === LuaBinaryOperator.And
					|| expression.operator === LuaBinaryOperator.Or) {
					const valueSource = this.createExpressionValueSource(expression);
					this.recordValueFlow(valueSource, left.valueSource, 'value', expression, 0);
					this.recordValueFlow(valueSource, right.valueSource, 'value', expression, 1);
					return { namePath: null, decl: null, valueSource };
				}
				return UNKNOWN_EXPRESSION_VALUE;
			}
			case LuaSyntaxKind.UnaryExpression: {
				this.visitExpression(expression.operand, context);
				return UNKNOWN_EXPRESSION_VALUE;
			}
			case LuaSyntaxKind.SizeOfExpression: {
				for (const lengthExpression of expression.typeRef.arrayLengths) {
					if (lengthExpression) {
						this.visitExpression(lengthExpression, { tableBaseDecl: null, tableBasePath: null });
					}
				}
				return UNKNOWN_EXPRESSION_VALUE;
			}
			case LuaSyntaxKind.OffsetOfExpression:
				return UNKNOWN_EXPRESSION_VALUE;
			case LuaSyntaxKind.VarargExpression:
				return UNKNOWN_EXPRESSION_VALUE;
			case LuaSyntaxKind.NilLiteralExpression:
			case LuaSyntaxKind.StringLiteralExpression:
			case LuaSyntaxKind.NumericLiteralExpression:
			case LuaSyntaxKind.BooleanLiteralExpression:
				return { namePath: null, decl: null, valueSource: literalExpressionValueSource(expression) };
			default:
				return UNKNOWN_EXPRESSION_VALUE;
		}
	}

	private visitCallTarget(expression: LuaExpression, context: ExpressionContext): ResolvedNamePath {
		if (expression.kind === LuaSyntaxKind.IdentifierExpression) {
			return this.handleIdentifierExpression(expression, false, true);
		}
		if (expression.kind === LuaSyntaxKind.MemberExpression) {
			return this.handleMemberExpression(expression, context, false, true);
		}
		return this.visitExpression(expression, context);
	}

	private visitTableConstructorExpression(expression: LuaTableConstructorExpression, context: ExpressionContext): void {
		for (let index = 0; index < expression.fields.length; index += 1) {
			const field = expression.fields[index];
			switch (field.kind) {
				case LuaTableFieldKind.Array: {
					const valueInfo = this.visitExpression(field.value, { tableBaseDecl: null, tableBasePath: null });
					if (context.tableOwner) {
						this.recordValueFlow(
							appendValueElement(context.tableOwner),
							valueInfo.valueSource,
							'value',
							expression,
							index,
						);
					}
					break;
				}
				case LuaTableFieldKind.IdentifierKey: {
					const baseDecl = context.tableBaseDecl;
					const basePath = context.tableBasePath;
					const namePath = basePath ? appendToNamePath(basePath, field.name) : [field.name];
					const decl = this.declareMember(
						namePath,
						field,
						baseDecl,
						context.tableOwner,
					);
					const valueContext: ExpressionContext = {
						tableBaseDecl: decl,
						tableBasePath: decl.namePath,
						tableOwner: decl.valueSource,
					};
					const valueInfo = this.visitExpression(field.value, valueContext);
					this.setDeclarationValue(decl, valueInfo.valueSource, expression, index);
					break;
				}
				case LuaTableFieldKind.ExpressionKey: {
					const keyInfo = this.visitExpression(
						field.key,
						{ tableBaseDecl: null, tableBasePath: null },
					);
					if (field.key.kind === LuaSyntaxKind.StringLiteralExpression) {
						const basePath = context.tableBasePath;
						const namePath = basePath
							? appendToNamePath(basePath, field.key.value)
							: [field.key.value];
						const decl = this.declareMember(
							namePath,
							field.key,
							context.tableBaseDecl,
							context.tableOwner,
						);
						const valueInfo = this.visitExpression(field.value, {
							tableBaseDecl: decl,
							tableBasePath: decl.namePath,
							tableOwner: decl.valueSource,
						});
						this.setDeclarationValue(decl, valueInfo.valueSource, expression, index);
						break;
					}
					const valueInfo = this.visitExpression(field.value, { tableBaseDecl: null, tableBasePath: null });
					if (context.tableOwner) {
						this.recordValueFlow(
							appendValueIndex(context.tableOwner, keyInfo.valueSource),
							valueInfo.valueSource,
							'value',
							expression,
							index,
						);
					}
					break;
				}
				default:
					break;
			}
		}
	}

	private visitFunctionExpression(
		expression: LuaFunctionExpression,
		methodSelfPath: readonly string[] | undefined,
		functionValue: OwnedSemanticValueSource,
		declaration: SymbolID | undefined,
		scopeKind: 'function' | 'method',
		methodReceiverClass?: SemanticValueSource,
	): void {
		const explicitReceiverClass = !methodReceiverClass && methodSelfPath
			? this.resolveValueSourceFromNamePath(methodSelfPath)
			: undefined;
		const receiverProjection = methodReceiverClass
			? appendValueInstance(methodReceiverClass)
			: explicitReceiverClass
				? appendValueInstance(explicitReceiverClass)
				: undefined;
		const parameters = new Array<FunctionSemanticValueSource>(
			expression.parameters.length + (methodReceiverClass ? 1 : 0),
		);
		const receiver = methodReceiverClass
			? ownedValueSource(this.path, expression, 'receiver')
			: undefined;
		if (receiver) {
			parameters[0] = receiver;
		}
		const block = expression.body;
		const scope = this.enterScope(
			{ unit: block.span.unit, offset: block.startInclusive },
			{ unit: block.span.unit, offset: block.endExclusive },
			scopeKind,
		);
		const valueFlow: FunctionValueFlowState = {
			id: scope.id,
			expression,
			declaration,
			functionValue,
			parameters,
			receiverProjection,
			implicitReceiver: methodReceiverClass !== undefined,
			completion: this.completionAnalysis.analyze(expression.body.body),
			declarationIds: [],
			ownedValues: [],
			members: [],
			calls: [],
			assignments: [],
			returns: [],
		};
		this.functionValueFlowStack.push(valueFlow);
		if (receiver) {
			this.retainOwnedValueSource(receiver);
			this.currentScope().bindings.set('self', { kind: 'receiver', name: 'self', valueSource: receiver });
			this.currentScope().implicitSelfValue = receiver;
		}
		for (let index = 0; index < expression.parameters.length; index += 1) {
			const parameter = this.declareParameter(expression.parameters[index]);
			parameters[index + (receiver ? 1 : 0)] = parameter.valueSource;
		}
		this.visitBlock(block);
		this.leaveScope();
		this.functionValueFlowStack.pop();
		this.functionValueFlows.push(valueFlow);
	}

	private handleAssignmentTarget(target: LuaAssignableExpression): AssignmentTargetInfo {
		switch (target.kind) {
			case LuaSyntaxKind.IdentifierExpression: {
				const binding = this.handleIdentifierExpression(target, true);
				return {
					decl: binding.decl,
					namePath: binding.namePath,
					path: target.name,
					valueTarget: binding.decl ? undefined : binding.valueSource,
				};
			}
			case LuaSyntaxKind.MemberExpression:
				return this.assignMember(target);
			case LuaSyntaxKind.IndexExpression:
				return this.assignIndex(target);
			case LuaSyntaxKind.UnaryExpression:
				if (target.operator === LuaUnaryOperator.Dereference) {
					this.visitExpression(target.operand, { tableBaseDecl: null, tableBasePath: null });
					return { decl: null, namePath: null, path: null };
				}
				throw new Error('[LuaSemanticBuilder] Unsupported unary assignment target.');
			default:
				return { decl: null, namePath: null, path: null };
		}
	}

	private assignMember(member: LuaMemberExpression): AssignmentTargetInfo {
		const baseInfo = this.visitExpression(member.base, { tableBaseDecl: null, tableBasePath: null });
		this.recordMemberAccess(
			member.member.span,
			baseInfo.valueSource,
			member.operator,
			baseInfo.namePath,
		);
		if (member.member.kind === LuaSyntaxKind.MissingIdentifier) {
			return { decl: null, namePath: null, path: null };
		}
		const basePath = resolveReferencedBasePath(baseInfo, member.base);
		const baseDecl = baseInfo.decl;
		const memberName = member.member.name;
		const namePath = basePath ? appendToNamePath(basePath, memberName) : [memberName];
		const decl = this.declareMember(
			namePath,
			member.member,
			baseDecl,
			baseInfo.valueSource,
		);
		this.recordReference({
			syntax: member.member,
			namePath,
			name: memberName,
			target: decl.id,
			isWrite: true,
			referenceKind: 'member',
			staticExpressionPath: resolveStaticLuaExpressionPath(member),
			receiverSymbolKey: baseDecl?.symbolKey || (baseInfo.namePath && joinNamePath(baseInfo.namePath)),
			receiverValue: baseInfo.valueSource,
		});
		return {
			decl,
			namePath,
			path: joinNamePath(namePath),
			memberBaseDecl: baseDecl,
			memberOwner: baseInfo.valueSource,
		};
	}

	private assignIndex(indexExpression: LuaIndexExpression): AssignmentTargetInfo {
		const baseInfo = this.visitExpression(indexExpression.base, { tableBaseDecl: null, tableBasePath: null });
		const indexInfo = this.visitExpression(indexExpression.index, { tableBaseDecl: null, tableBasePath: null });
		const namePath = resolveReferencedBasePath(baseInfo, indexExpression.base);
		if (indexExpression.index.kind === LuaSyntaxKind.StringLiteralExpression) {
			const fieldName = indexExpression.index.value;
			const fieldPath = namePath ? appendToNamePath(namePath, fieldName) : [fieldName];
			const decl = this.declareMember(
				fieldPath,
				indexExpression.index,
				baseInfo.decl,
				baseInfo.valueSource,
			);
			this.recordReference({
				syntax: indexExpression.index,
				namePath: fieldPath,
				name: fieldName,
				target: decl.id,
				isWrite: true,
				referenceKind: 'member',
				staticExpressionPath: resolveStaticLuaExpressionPath(indexExpression),
				receiverSymbolKey: baseInfo.decl?.symbolKey || (baseInfo.namePath && joinNamePath(baseInfo.namePath)),
				receiverValue: baseInfo.valueSource,
			});
			return {
				decl,
				namePath: fieldPath,
				path: joinNamePath(fieldPath),
				memberBaseDecl: baseInfo.decl,
				memberOwner: baseInfo.valueSource,
			};
		}
		return {
			decl: null,
			namePath,
			path: namePath && joinNamePath(namePath),
			valueTarget: appendValueIndex(baseInfo.valueSource, indexInfo.valueSource),
		};
	}

	private recordMethodReference(callExpression: LuaCallExpression, calleeInfo: ResolvedNamePath): Ref {
		const basePath = resolveReferencedBasePath(calleeInfo, callExpression.callee);
		const receiverSymbolKey = calleeInfo.decl?.symbolKey || (calleeInfo.namePath && joinNamePath(calleeInfo.namePath));
		const method = callExpression.method;
		this.recordMemberAccess(
			method.span,
			calleeInfo.valueSource,
			LuaMemberOperator.Colon,
			calleeInfo.namePath,
		);
		const methodName = method.name;
		const namePath = basePath ? appendToNamePath(basePath, methodName) : [methodName];
		const receiverExpressionPath = resolveStaticLuaExpressionPath(callExpression.callee);
		const reference = this.recordReference({
			syntax: method,
			namePath,
			name: methodName,
			isWrite: false,
			referenceKind: 'method',
			staticExpressionPath: receiverExpressionPath === null
				? null
				: `${receiverExpressionPath}.${methodName}`,
			receiverSymbolKey,
			receiverValue: calleeInfo.valueSource,
			isCall: true,
		});
		return reference;
	}

	private handleIdentifierExpression(
		identifier: LuaIdentifierExpression,
		isWrite: boolean,
		isCall = false,
		declarationKind: 'global' | 'function' = 'global',
	): ResolvedNamePath {
		let binding = this.resolveName(identifier.name) ?? this.globalsByKey.get(identifier.name);
		if (!binding && isWrite) binding = this.declareGlobal(identifier, declarationKind);
		const decl = binding?.kind === 'receiver' ? undefined : binding;
		const namePath = [identifier.name];
		this.recordReference({
			syntax: identifier,
			namePath,
			name: identifier.name,
			target: decl?.id,
			isWrite,
			referenceKind: binding?.kind === 'receiver' ? 'self' : 'identifier',
			binding: binding?.valueSource,
			staticExpressionPath: identifier.name,
			isCall,
		});
		return {
			namePath,
			decl,
			valueSource: !isWrite && decl && this.unknownValueDeclarations.has(decl.id)
				? unknownValueSource()
				: binding ? binding.valueSource : globalValueSource(identifier.name),
		};
	}

	private handleMemberExpression(member: LuaMemberExpression, context: ExpressionContext, isWrite: boolean, isCall = false): ResolvedNamePath {
		const baseInfo = this.visitExpression(member.base, context);
		this.recordMemberAccess(
			member.member.span,
			baseInfo.valueSource,
			member.operator,
			baseInfo.namePath,
		);
		if (member.member.kind === LuaSyntaxKind.MissingIdentifier) {
			return UNKNOWN_EXPRESSION_VALUE;
		}
		const basePath = resolveReferencedBasePath(baseInfo, member.base);
		const memberName = member.member.name;
		const namePath = basePath ? appendToNamePath(basePath, memberName) : [memberName];
		this.recordReference({
			syntax: member.member,
			namePath,
			name: memberName,
			isWrite,
			referenceKind: 'member',
			staticExpressionPath: resolveStaticLuaExpressionPath(member),
			receiverSymbolKey: baseInfo.decl?.symbolKey || (baseInfo.namePath && joinNamePath(baseInfo.namePath)),
			receiverValue: baseInfo.valueSource,
			isCall,
		});
		return {
			namePath,
			decl: undefined,
			valueSource: appendValueMember(baseInfo.valueSource, memberName),
		};
	}

	private recordMemberAccess(
		span: LuaSyntaxSpan,
		receiver: SemanticValueSource,
		operator: LuaMemberOperator,
		namePath: readonly string[] | null | undefined,
	): void {
		if (namePath != null) {
			this.memberAccesses.push({ span, receiver, operator, namePath });
			return;
		}
		this.memberAccesses.push({ span, receiver, operator });
	}

	private handleIndexExpression(indexExpression: LuaIndexExpression, context: ExpressionContext): ResolvedNamePath {
		const baseInfo = this.visitExpression(indexExpression.base, context);
		const indexInfo = this.visitExpression(indexExpression.index, { tableBaseDecl: null, tableBasePath: null });
		if (indexExpression.index.kind === LuaSyntaxKind.StringLiteralExpression) {
			const name = indexExpression.index.value;
			const basePath = resolveReferencedBasePath(baseInfo, indexExpression.base);
			const namePath = basePath ? appendToNamePath(basePath, name) : [name];
			return {
				namePath,
				decl: undefined,
				valueSource: appendValueMember(baseInfo.valueSource, name),
			};
		}
		return {
			namePath: null,
			decl: null,
			valueSource: appendValueIndex(baseInfo.valueSource, indexInfo.valueSource),
		};
	}

	private declareLocal(name: LuaIdentifierExpression, kind: SemanticSymbolKind, activate: boolean): InternalDecl {
		const scope = this.currentScope();
		const decl = this.createDecl({
			syntax: name,
			namePath: [name.name],
			name: name.name,
			kind,
			scopeRef: scope,
			isGlobal: false,
			active: activate,
			lexical: true,
		});
		if (activate) {
			scope.bindings.set(decl.name, decl);
		}
		this.recordDefinitionAnnotation(decl);
		return decl;
	}

	private declareParameter(name: LuaIdentifierExpression): InternalDecl {
		const scope = this.currentScope();
		const decl = this.createDecl({
			syntax: name,
			namePath: [name.name],
			name: name.name,
			kind: 'parameter',
			scopeRef: scope,
			isGlobal: false,
			active: true,
			lexical: true,
		});
		scope.bindings.set(decl.name, decl);
		this.recordDefinitionAnnotation(decl);
		return decl;
	}

	private declareType(name: LuaIdentifierExpression): InternalDecl {
		const scope = this.currentScope();
		const decl = this.createDecl({
			syntax: name,
			namePath: [name.name],
			name: name.name,
			kind: 'type',
			scopeRef: scope,
			isGlobal: scope.kind === 'path',
			active: true,
			lexical: true,
		});
		scope.bindings.set(decl.name, decl);
		if (decl.isGlobal) {
			this.globalsByKey.set(decl.symbolKey, decl);
		}
		this.recordDefinitionAnnotation(decl);
		return decl;
	}

	private declareBss(name: LuaIdentifierExpression): InternalDecl {
		const scope = this.currentScope();
		const decl = this.createDecl({
			syntax: name,
			namePath: [name.name],
			name: name.name,
			kind: 'bss',
			scopeRef: scope,
			isGlobal: scope.kind === 'path',
			active: true,
			lexical: true,
		});
		scope.bindings.set(decl.name, decl);
		if (decl.isGlobal) {
			this.globalsByKey.set(decl.symbolKey, decl);
		}
		this.recordDefinitionAnnotation(decl);
		return decl;
	}

	private declareData(name: LuaIdentifierExpression): InternalDecl {
		const scope = this.currentScope();
		const decl = this.createDecl({
			syntax: name,
			namePath: [name.name],
			name: name.name,
			kind: 'data',
			scopeRef: scope,
			isGlobal: scope.kind === 'path',
			active: true,
			lexical: true,
		});
		scope.bindings.set(decl.name, decl);
		if (decl.isGlobal) {
			this.globalsByKey.set(decl.symbolKey, decl);
		}
		this.recordDefinitionAnnotation(decl);
		return decl;
	}

	private declareRodata(name: LuaIdentifierExpression): InternalDecl {
		const scope = this.currentScope();
		const decl = this.createDecl({
			syntax: name,
			namePath: [name.name],
			name: name.name,
			kind: 'rodata',
			scopeRef: scope,
			isGlobal: scope.kind === 'path',
			active: true,
			lexical: true,
		});
		scope.bindings.set(decl.name, decl);
		if (decl.isGlobal) {
			this.globalsByKey.set(decl.symbolKey, decl);
		}
		this.recordDefinitionAnnotation(decl);
		return decl;
	}

	private declareGlobal(identifier: LuaIdentifierExpression, kind: 'global' | 'function' = 'global'): InternalDecl {
		const scope = this.scopeStack[0];
		const namePath = [identifier.name];
		const decl = this.createDecl({
			syntax: identifier,
			namePath,
			name: identifier.name,
			kind,
			scopeRef: scope,
			isGlobal: true,
			active: true,
			lexical: false,
		});
		this.globalsByKey.set(decl.symbolKey, decl);
		this.recordDefinitionAnnotation(decl);
		return decl;
	}

	private declareMember(
		namePath: readonly string[],
		syntax: LuaIdentifierExpression | LuaStringLiteralExpression | LuaTableIdentifierField,
		baseDecl: InternalDecl | undefined,
		owner: SemanticValueSource,
		kind: 'property' | 'function' = 'property',
	): InternalDecl {
		// Written occurrences own declarations. A lexical root can supply scope
		// and visibility, but an earlier field definition is never storage.
		const binding = owner.root.kind === 'declaration' ? this.declById.get(owner.root.declId)! : undefined;
		const scope = baseDecl?.scopeRef ?? binding?.scopeRef ?? this.currentScope();
		const isGlobal = baseDecl ? baseDecl.isGlobal : binding ? binding.isGlobal : owner.root.kind === 'global';
		const decl = this.createDecl({
			syntax,
			namePath,
			name: namePath[namePath.length - 1],
			kind,
			scopeRef: scope,
			isGlobal,
			active: true,
			lexical: false,
		});
		// Constructor keys have no separate reference. Identifier writes are
		// annotated by recordReference; quoted keys remain string tokens.
		if (syntax.kind === LuaTableFieldKind.IdentifierKey) this.recordDefinitionAnnotation(decl);
		this.recordMemberValue({ declId: decl.id, name: decl.name, owner });
		return decl;
	}

	private recordMemberValue(entry: MemberValueEntry): void {
		const flow = this.functionValueFlowStack[this.functionValueFlowStack.length - 1];
		if (flow) flow.members.push(entry);
		else this.memberValues.push(entry);
	}

	private createDecl(options: {
		syntax: LuaIdentifierExpression | LuaStringLiteralExpression | LuaTableIdentifierField;
		namePath: readonly string[];
		name: string;
		kind: SemanticSymbolKind;
		scopeRef: Scope;
		isGlobal: boolean;
		active: boolean;
		lexical: boolean;
	}): InternalDecl {
		const { syntax, namePath, name, kind, scopeRef, isGlobal, active } = options;
		const id = createSymbolId(this.path, syntax.span, kind, namePath);
		const span = syntax.kind === LuaTableFieldKind.IdentifierKey
			? { unit: syntax.span.unit, start: syntax.span.start, end: syntax.span.start + name.length - 1 }
			: syntax.span;
		const decl: InternalDecl = {
			id,
			file: this.path,
			name,
			namePath: namePath.slice(),
			symbolKey: joinNamePath(namePath),
			kind,
			span,
			scope: scopeRef.id,
			publicationSlot: this.decls.length,
			visibleFrom: { unit: span.unit, offset: span.end },
			isGlobal,
			scopeRef,
			active,
			valueSource: declarationValueSource(id),
		};
		if (options.lexical) {
			scopeRef.declarations.push(decl);
		}
		this.decls.push(decl);
		this.declById.set(id, decl);
		if (syntax.kind === LuaSyntaxKind.IdentifierExpression) {
			this.declarationIdsBySyntax.set(syntax, id);
		}
		const flow = this.functionValueFlowStack[this.functionValueFlowStack.length - 1];
		if (flow) {
			flow.declarationIds.push(id);
		}
		return decl;
	}

	private recordDefinitionAnnotation(decl: InternalDecl): void {
		this.annotate(decl.span, decl.name.length, decl.kind, 'definition');
	}

	private recordReference(options: {
		syntax: LuaIdentifierExpression | LuaStringLiteralExpression;
		namePath: readonly string[];
		name: string;
		target?: SymbolID;
		isWrite: boolean;
		referenceKind: 'identifier' | 'self' | 'member' | 'method';
		binding?: FunctionSemanticValueSource;
		staticExpressionPath: string | null;
		receiverSymbolKey?: string;
		receiverValue?: SemanticValueSource;
		isCall?: boolean;
	}): Ref {
		const ref: Ref = {
			file: this.path,
			name: options.name,
			namePath: options.namePath.slice(),
			symbolKey: joinNamePath(options.namePath),
			span: options.syntax.span,
			isWrite: options.isWrite,
			isCall: !!options.isCall,
			referenceKind: options.referenceKind,
			binding: options.binding,
			staticExpressionPath: options.staticExpressionPath,
			receiverSymbolKey: options.receiverSymbolKey,
			receiverValue: options.receiverValue,
		};
		if (ref.isCall) {
			for (let index = this.functionValueFlowStack.length - 1; index >= 0; index -= 1) {
				const declaration = this.functionValueFlowStack[index].declaration;
				if (declaration !== undefined) {
					ref.caller = declaration;
					break;
				}
			}
		}
		if (options.target) {
			ref.target = options.target;
		}
		this.refs.push(ref);
		if (options.syntax.kind === LuaSyntaxKind.IdentifierExpression) {
			this.referencesBySyntax.set(options.syntax, ref);
			const targetDecl = options.target ? this.declById.get(options.target) : null;
			const kind = targetDecl ? targetDecl.kind : inferReferenceKind(ref);
			const role = ref.isWrite && (ref.referenceKind === 'member' || ref.referenceKind === 'method')
				? 'definition' : 'usage';
			this.annotate(ref.span, options.syntax.name.length, kind, role);
		}
		let references = this.referencesByName.get(ref.name);
		if (!references) {
			references = [];
			this.referencesByName.set(ref.name, references);
		}
		references.push(ref);
		return ref;
	}

	private recordFunctionNameReferences(statement: LuaFunctionDeclarationStatement): void {
		const path = statement.name.path;
		const referenceCount = statement.name.method ? path.length : path.length - 1;
		if (referenceCount === 0) {
			return;
		}
		const namePath: string[] = [];
		for (let index = 0; index < referenceCount; index += 1) {
			const identifier = path[index];
			const name = identifier.name;
			namePath.push(name);
			if (namePath.length === 1) {
				this.handleIdentifierExpression(identifier, false);
				continue;
			}
			const owner = this.resolveValueSourceFromNamePath(namePath.slice(0, -1))!;
			this.recordReference({
				syntax: identifier,
				namePath,
				name,
				receiverValue: owner,
				isWrite: false,
				referenceKind: 'member',
				staticExpressionPath: resolveStaticLuaNamePath(namePath),
			});
		}
	}

	private recordFunctionDeclarationWriteReference(statement: LuaFunctionDeclarationStatement, decl: InternalDecl, owner: SemanticValueSource): void {
		const path = statement.name.path;
		const method = statement.name.method;
		const declarationName = method ?? path[path.length - 1];
		this.recordReference({
			syntax: declarationName,
			namePath: decl.namePath,
			name: decl.name,
			target: decl.id,
			receiverValue: owner,
			isWrite: true,
			referenceKind: method ? 'method' : 'member',
			staticExpressionPath: resolveStaticLuaNamePath(decl.namePath),
		});
	}

	private setDeclarationValue(
		decl: InternalDecl,
		source: SemanticValueSource,
		syntax: DeclarationValueEntry['syntax'],
		index: number,
		relation: DeclarationValueEntry['relation'] = decl.kind === 'constant' && source.root.kind !== 'unknown'
			? 'identity' : 'value',
	): void {
		const flow = this.functionValueFlowStack[this.functionValueFlowStack.length - 1];
		const entry: DeclarationValueEntry = { file: this.path, declId: decl.id, source, relation, syntax, index, flow: flow?.id };
		let declarationSources = this.declarationValuesByDeclaration.get(decl.id);
		if (!declarationSources) {
			declarationSources = [];
			this.declarationValuesByDeclaration.set(decl.id, declarationSources);
		}
		declarationSources.push(entry);
		this.declarationValues.push(entry);
	}

	private recordValueFlow(
		target: SemanticValueSource,
		source: SemanticValueSource,
		relation: ValueAssignmentEntry['relation'],
		syntax: ValueAssignmentEntry['syntax'],
		index: number,
	): void {
		const assignment: ValueAssignmentEntry = { target, source, relation, syntax, index };
		const flow = this.functionValueFlowStack[this.functionValueFlowStack.length - 1];
		if (flow) {
			flow.assignments.push(assignment);
		} else {
			this.valueAssignments.push(assignment);
		}
	}

	private recordCallValue(call: CallValueEntry, reference: Ref | undefined): void {
		if (reference) {
			reference.call = call;
		}
		const flow = this.functionValueFlowStack[this.functionValueFlowStack.length - 1];
		if (flow) {
			flow.calls.push(call);
		} else {
			this.callValues.push(call);
		}
	}

	private resolveValueSourceFromNamePath(namePath: readonly string[]): SemanticValueSource | undefined {
		if (namePath.length === 0) {
			return undefined;
		}
		const binding = this.resolveName(namePath[0]) ?? this.globalsByKey.get(namePath[0]);
		let source = binding
			? binding.valueSource
			: globalValueSource(namePath[0]);
		for (let index = 1; index < namePath.length; index += 1) {
			source = appendValueMember(source, namePath[index]);
		}
		return source;
	}

	private resolveMemberOwnerSource(namePath: readonly string[]): SemanticValueSource | undefined {
		return namePath.length > 1
			? this.resolveValueSourceFromNamePath(namePath.slice(0, -1))
			: undefined;
	}

	private resolveGenericForTableSource(
		statement: LuaForGenericStatement,
	): SemanticValueSource | undefined {
		const iterator = statement.iterators[0];
		if (iterator.kind === LuaSyntaxKind.CallExpression
			&& !iterator.method) {
			const name = resolveDirectCallName(iterator.callee);
			const tableArgument = LUA_BUILTIN_TABLE_ITERATOR_ARGUMENTS[name];
			if (tableArgument !== undefined
				&& !this.resolveName(name) && !this.globalsByKey.has(name)) {
				const tableExpression = iterator.arguments[tableArgument];
				return tableExpression
					? this.resolveExpressionValueSource(tableExpression)
					: undefined;
			}
		}
		return undefined;
	}

	private resolveCallResultValue(
		callExpression: LuaCallExpression,
		requireArgument: LuaStringLiteralExpression | null,
		callee: ResolvedNamePath,
		firstArgument: ResolvedNamePath,
		secondArgument: ResolvedNamePath,
		callResult: SemanticValueSource,
	): SemanticValueSource {
		if (requireArgument) {
			return moduleValueSource(requireArgument.value);
		}
		if (!callExpression.method) {
			const directCallName = resolveDirectCallName(callExpression.callee);
			const firstArgumentValue = firstArgument?.valueSource;
			if (directCallName === 'setmetatable'
				&& !callee?.decl
				&& callExpression.arguments.length === 2) {
				if (firstArgumentValue) {
					this.recordValueFlow(callResult, firstArgumentValue, 'value', callExpression, 0);
				}
				const metatableValue = secondArgument?.valueSource;
				if (firstArgumentValue && metatableValue) {
					this.recordValueFlow(firstArgumentValue, metatableValue, 'metatable', callExpression, 1);
					this.recordValueFlow(
						firstArgumentValue,
						appendValueMember(metatableValue, '__index'),
						'prototype',
						callExpression,
						1,
					);
				}
				return callResult;
			}
			if (directCallName === 'getmetatable'
				&& !callee?.decl
				&& callExpression.arguments.length === 1
				&& firstArgumentValue) {
				return appendValueMetatable(firstArgumentValue);
			}
		}
		return callResult;
	}

	private createExpressionValueSource(expression: LuaExpression): OwnedSemanticValueSource {
		const retained = this.ownedValuesBySyntax.get(expression);
		if (retained !== undefined) return retained;
		const source = ownedValueSource(this.path, expression, 'expression');
		this.ownedValuesBySyntax.set(expression, source);
		this.retainOwnedValueSource(source);
		return source;
	}

	private retainOwnedValueSource(source: OwnedSemanticValueSource): void {
		const flow = this.functionValueFlowStack[this.functionValueFlowStack.length - 1];
		if (flow) {
			flow.ownedValues.push(source);
		}
	}

	private resolveExpressionValueSource(expression: LuaExpression): SemanticValueSource | undefined {
		if (expression.kind === LuaSyntaxKind.CallExpression
			|| expression.kind === LuaSyntaxKind.TableConstructorExpression
			|| expression.kind === LuaSyntaxKind.FunctionExpression
			|| (expression.kind === LuaSyntaxKind.BinaryExpression
				&& (expression.operator === LuaBinaryOperator.And || expression.operator === LuaBinaryOperator.Or))) {
			return this.createExpressionValueSource(expression);
		}
		const path = extractStaticMemberPath(expression);
		return path ? this.resolveValueSourceFromNamePath(path) : undefined;
	}

	private annotate(span: LuaSyntaxSpan, length: number, kind: SemanticSymbolKind, role: SemanticRole): void {
		this.annotationFacts.push({ span, width: Math.max(length, 1), kind, role });
	}

	private activateDecl(decl: InternalDecl, visibleFrom: LuaSyntaxPoint): void {
		if (decl.active) {
			return;
		}
		decl.visibleFrom = visibleFrom;
		decl.scopeRef.bindings.set(decl.name, decl);
		decl.active = true;
	}

	private resolveName(name: string): InternalBinding {
		let scope: Scope = this.currentScope();
		while (scope) {
			const binding = scope.bindings.get(name);
			if (binding) {
				return binding;
			}
			scope = scope.parent;
		}
		return null;
	}

	private currentScope(): Scope {
		return this.scopeStack[this.scopeStack.length - 1];
	}

	private enterScope(
		startInclusive: LuaSyntaxPoint,
		endExclusive: LuaSyntaxPoint,
		kind: ScopeKind,
	): Scope {
		const scope: Scope = {
			id: createScopeId(this.path, startInclusive, kind),
			kind,
			startInclusive,
			endExclusive,
			parent: this.scopeStack.length > 0 ? this.scopeStack[this.scopeStack.length - 1] : null,
			bindings: new Map(),
			declarations: [],
		};
		this.scopes.push(scope);
		this.scopeStack.push(scope);
		return scope;
	}

	private leaveScope(): void {
		this.scopeStack.pop();
	}
}

function inferReferenceKind(ref: Ref): SemanticSymbolKind {
	if (ref.symbolKey.includes('.')) {
		return 'property';
	}
	return 'global';
}

function joinNamePath(namePath: readonly string[]): string {
	if (namePath.length === 0) {
		return '';
	}
	return namePath.join('.');
}

function extractStaticMemberPath(expression: LuaExpression): string[] | null {
	if (expression.kind === LuaSyntaxKind.IdentifierExpression) {
		return [expression.name];
	}
	if (expression.kind === LuaSyntaxKind.MemberExpression) {
		const base = extractStaticMemberPath(expression.base);
		if (!base) {
			return null;
		}
		base.push(expression.member.name);
		return base;
	}
	if (expression.kind === LuaSyntaxKind.IndexExpression) {
		const base = extractStaticMemberPath(expression.base);
		if (!base) {
			return null;
		}
		const key = extractStringLiteral(expression.index);
		if (!key) {
			return null;
		}
		base.push(key);
		return base;
	}
	return null;
}

function appendToNamePath(base: readonly string[], segment: string): string[] {
	const result = base.slice();
	result.push(segment);
	return result;
}

function toDecl(internal: InternalDecl): Decl {
	return {
		id: internal.id,
		file: internal.file,
		name: internal.name,
		namePath: internal.namePath.slice(),
		symbolKey: internal.symbolKey,
		kind: internal.kind,
		span: internal.span,
		scope: internal.scope,
		visibleFrom: internal.visibleFrom,
		isGlobal: internal.isGlobal,
	};
}


function extractNamePath(expression: LuaExpression): string[] {
	switch (expression.kind) {
		case LuaSyntaxKind.IdentifierExpression:
			return [expression.name];
		case LuaSyntaxKind.MemberExpression: {
			const base = extractNamePath(expression.base);
			if (!base) {
				return null;
			}
			return appendToNamePath(base, expression.member.name);
		}
		case LuaSyntaxKind.IndexExpression:
			return extractNamePath(expression.base);
		default:
			return null;
	}
}

function resolveReferencedBasePath(baseInfo: ResolvedNamePath, expression: LuaExpression): string[] {
	if (baseInfo) {
		return baseInfo.namePath;
	}
	return extractNamePath(expression);
}

function resolveDirectCallName(expression: LuaExpression): string {
	if (expression.kind !== LuaSyntaxKind.IdentifierExpression) {
		return null;
	}
	return expression.name;
}

function extractStringLiteral(expression: LuaExpression): string {
	if (!expression || expression.kind !== LuaSyntaxKind.StringLiteralExpression) {
		return null;
	}
	return expression.value;
}

function buildFunctionNamePath(name: LuaFunctionName): string[] {
	const identifiers = new Array<string>(name.path.length + (name.method ? 1 : 0));
	for (let index = 0; index < name.path.length; index += 1) {
		identifiers[index] = name.path[index].name;
	}
	if (name.method) {
		identifiers[identifiers.length - 1] = name.method.name;
	}
	return identifiers;
}

export class LuaSemanticWorkspace {
	private readonly index = new LuaProjectIndex();
	private snapshot: LuaSemanticWorkspaceSnapshot = null;

	public get version(): number {
		return this.index.getVersion();
	}

	/** Omitted input replaces source; edit maps describe the current file generation. */
	public updateFile(file: string, source: string, input?: ParsedLuaChunk | SourceChangeMap): FileSemanticData {
		const previousVersion = this.index.getVersion();
		const data = this.index.updateFile(file, source, input);
		if (this.index.getVersion() !== previousVersion) {
			this.snapshot = null;
		}
		return data;
	}

	public updateFiles(
		files: readonly FileSemanticData[],
		removedFiles: readonly string[] = EMPTY_FILE_PATHS,
	): void {
		if (files.length === 0 && removedFiles.length === 0) {
			return;
		}
		if (this.index.updateFiles(files, removedFiles)) {
			this.snapshot = null;
		}
	}

	public getFileData(file: string): FileSemanticData | undefined {
		return this.index.getFileData(file);
	}

	public getSnapshot(): LuaSemanticWorkspaceSnapshot {
		if (this.snapshot && this.snapshot.version === this.index.getVersion()) {
			return this.snapshot;
		}
		this.snapshot = createWorkspaceSnapshotFromIndex(this.index);
		return this.snapshot;
	}

}

export function symbolPriority(kind: LuaSymbolEntry['kind']): number {
	switch (kind) {
		case 'module':
			return 7;
		case 'table_field':
			return 6;
		case 'function':
			return 5;
		case 'constant':
			return 4;
		case 'parameter':
			return 3;
		case 'variable':
			return 2;
		case 'assignment':
		default:
			return 1;
	}
}

export function symbolKindLabel(kind: LuaSymbolEntry['kind']): string {
	switch (kind) {
		case 'module':
			return 'MODULE';
		case 'function':
			return 'FUNC';
		case 'table_field':
			return 'FIELD';
		case 'parameter':
			return 'PARAM';
		case 'constant':
			return 'CONST';
		case 'variable':
			return 'VAR';
		case 'assignment':
		default:
			return 'SET';
	}
}
