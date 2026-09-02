import {
	LuaBinaryOperator,
	LuaMemberOperator,
	LuaSyntaxKind,
	LuaTableFieldKind,
	LuaUnaryOperator,
	isRecursiveConstClosureDeclaration,
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
	type LuaStructDeclarationStatement,
	type LuaBssDeclarationStatement,
	type LuaDataDeclarationStatement,
	type LuaRodataDeclarationStatement,
	type LuaFunctionDeclarationStatement,
	type LuaFunctionName,
	type LuaSourceRange,
	type LuaStringLiteralExpression,
} from '../syntax/ast';
import type { LuaSymbolEntry } from '../semantic_contracts';
import type { ParsedLuaChunk } from '../analysis/parse';
import type { LuaSyntaxError } from '../errors';
import { getCachedLuaParse } from '../analysis/cache';
import type { SourcePosition } from '../source_range';
import type { SemanticSymbolKind } from './symbols';
import type { SemanticAnnotations, SemanticRole } from './tokens';
import { methodPathToPropertyPath } from './common';
import { toLuaModulePath } from '../module_path';
import { LUA_BUILTIN_TABLE_ITERATOR_ARGUMENTS } from '../builtin_descriptors';
import {
	resolveBuiltinRequireArgument,
	resolveModuleAliasValueSource,
	type ModuleAliasEntry,
	type ModuleAliasTarget,
} from './module_bindings';
import {
	appendValueElement,
	appendValueIndex,
	appendValueInstance,
	appendValueMember,
	appendValueMetatable,
	declarationValueSource,
	expressionValueSource,
	globalValueSource,
	literalValueSource,
	moduleTableValueSource,
	moduleValueSource,
	ownedValueSource,
	semanticValueSourceKey,
	semanticValueSourcesEqual,
	tableValueSource,
	unknownValueSource,
	type CallValueEntry,
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

export type SymbolID = string;

const EMPTY_FILE_PATHS: readonly string[] = [];

export type FunctionSignatureInfo = {
	readonly params: readonly string[];
	readonly hasVararg: boolean;
	readonly minimumArgumentCount: number;
	readonly declarationStyle: 'function' | 'method';
};

export type Decl = {
	id: SymbolID;
	file: string;
	name: string;
	namePath: readonly string[];
	symbolKey: string;
	kind: SemanticSymbolKind;
	range: LuaSourceRange;
	scopeIndex: number;
	visibleFrom: SourcePosition;
	isGlobal: boolean;
	signature?: FunctionSignatureInfo;
};

export type SemanticScope = {
	readonly startInclusive: SourcePosition;
	readonly endExclusive: SourcePosition;
	readonly parentIndex: number;
	readonly declarationIndices: readonly number[];
	readonly implicitSelfValue?: SemanticValueSource;
};

export type Ref = {
	file: string;
	name: string;
	namePath: readonly string[];
	symbolKey: string;
	range: LuaSourceRange;
	target?: SymbolID;
	isWrite: boolean;
	isCall: boolean;
	caller?: SymbolID;
	referenceKind: 'identifier' | 'self' | 'member' | 'method';
	staticExpressionPath: string | null;
	receiverSymbolKey?: string;
	receiverValue?: SemanticValueSource;
	call?: CallValueEntry;
};

export type LuaCallSite = {
	readonly expression: LuaCallExpression;
	readonly calleeValue: SemanticValueSource | undefined;
	readonly moduleTarget: ModuleAliasTarget | null;
	readonly moduleTargetBinding: 'immutable' | 'mutable' | null;
	readonly reference: Ref | undefined;
	readonly directTarget: SymbolID | undefined;
};

export type MemberAccessEntry = {
	readonly range: LuaSourceRange;
	readonly receiver: SemanticValueSource;
	readonly operator: LuaMemberOperator;
	readonly namePath?: readonly string[];
};

export type FileSemanticData = {
	readonly file: string;
	readonly source: string;
	readonly syntaxError: LuaSyntaxError | null;
	readonly chunk: LuaChunk;
	readonly annotations: SemanticAnnotations;
	readonly decls: readonly Decl[];
	readonly scopes: readonly SemanticScope[];
	readonly refs: readonly Ref[];
	readonly memberAccesses: readonly MemberAccessEntry[];
	readonly declarationIdsBySyntax: ReadonlyMap<LuaIdentifierExpression, SymbolID>;
	readonly referencesBySyntax: ReadonlyMap<LuaIdentifierExpression, Ref>;
	readonly referencesByName: ReadonlyMap<string, readonly Ref[]>;
	readonly moduleAliases: readonly ModuleAliasEntry[];
	readonly moduleReferences: readonly LuaStringLiteralExpression[];
	readonly callSites: readonly LuaCallSite[];
	readonly declarationValues: readonly DeclarationValueEntry[];
	readonly moduleValues: readonly ModuleValueEntry[];
	readonly memberValues: readonly MemberValueEntry[];
	readonly functionReturnValues: readonly FunctionReturnValueEntry[];
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
	public readonly version: number;
	public readonly files: readonly FileSemanticData[];
	public readonly symbolResolver: WorkspaceSymbolResolver;
	private readonly dataByPath: ReadonlyMap<string, FileSemanticData>;
	private readonly globalDecls: readonly Decl[];

	constructor(
		version: number,
		files: readonly FileSemanticData[],
		symbolResolver: WorkspaceSymbolResolver,
	) {
		this.version = version;
		this.files = files;
		this.symbolResolver = symbolResolver;
		const dataByPath = new Map<string, FileSemanticData>();
		const globalDecls: Decl[] = [];
		for (let index = 0; index < files.length; index += 1) {
			const file = files[index];
			dataByPath.set(file.file, file);
			for (let declIndex = 0; declIndex < file.decls.length; declIndex += 1) {
				const decl = file.decls[declIndex];
				if (decl.isGlobal) {
					globalDecls.push(decl);
				}
			}
		}
		this.dataByPath = dataByPath;
		this.globalDecls = globalDecls;
	}

	public getFileData(path: string): FileSemanticData | undefined {
		return this.dataByPath.get(path);
	}

	public listGlobalDecls(): readonly Decl[] {
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
		const parseEntry = getCachedLuaParse({
			path: source.path,
			source: source.source,
			parsed: source.parsed,
		});
		if (parseEntry.syntaxError) {
			throw new Error(`[LuaSemanticWorkspace] Syntax error in ${source.path}: ${parseEntry.syntaxError.message}`);
		}
		analyses[index] = buildLuaFileSemanticData(
			parseEntry.source,
			source.path,
			parseEntry.parsed,
			source.chunk,
		);
	}
	workspace.updateFiles(analyses);
	return workspace.getSnapshot();
}

type ScopeKind = 'path' | 'function' | 'block' | 'loop';

type Scope = {
	index: number;
	kind: ScopeKind;
	startInclusive: SourcePosition;
	endExclusive: SourcePosition;
	parent: Scope;
	bindings: Map<string, InternalDecl[]>;
	declarationIndices: number[];
	implicitSelfValue?: SemanticValueSource;
};

type InternalDecl = Decl & {
	scopeRef: Scope;
	active: boolean;
};

type ResolvedNamePath = {
	namePath: string[] | null;
	decl: InternalDecl | null;
	valueSource?: SemanticValueSource;
};

type ExpressionContext = {
	tableBaseDecl: InternalDecl;
	tableBasePath: readonly string[];
	tableOwner?: SemanticValueSource;
	moduleReturn?: boolean;
};

type FunctionReturnValueState = {
	sources: SemanticValueSource[];
};

type FunctionValueFlowState = {
	functionValue: FunctionSemanticValueSource;
	lexicalOwner?: FunctionValueFlowState;
	parameters: FunctionSemanticValueSource[];
	receiverProjection?: SemanticValueSource;
	implicitReceiver: boolean;
	declarationIds: SymbolID[];
	ownedValueKeys: string[];
	members: MemberValueEntry[];
	calls: CallValueEntry[];
	assignments: ValueAssignmentEntry[];
};

type AssignmentTargetInfo = {
	decl: InternalDecl;
	namePath: readonly string[];
	path: string | null;
	valueTarget?: SemanticValueSource;
	moduleAlias?: ModuleAliasTarget | null;
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
	annotations: SemanticAnnotations;
	callSites: LuaCallSite[];
	declarationValues: DeclarationValueEntry[];
	moduleValues: ModuleValueEntry[];
	memberValues: MemberValueEntry[];
	functionReturnValues: FunctionReturnValueEntry[];
	functionValueFlows: FunctionValueFlowEntry[];
	callValues: CallValueEntry[];
	valueAssignments: ValueAssignmentEntry[];
	moduleAliases: ModuleAliasEntry[];
	moduleReferences: LuaStringLiteralExpression[];
};

export function buildLuaFileSemanticData(
	source: string,
	path: string,
	parsed?: ParsedLuaChunk,
	chunk?: LuaChunk,
): FileSemanticData {
	const parseEntry = getCachedLuaParse({
		path,
		source,
		parsed,
	});
	const retainedChunk = chunk === undefined ? parseEntry.parsed.chunk : chunk;
	const tokens = parseEntry.parsed.tokens;
	const eof = tokens[tokens.length - 1];
	const builder = new SemanticBuilder({
		path,
		chunk: retainedChunk,
		lineCount: eof.endLine,
		documentEndExclusive: {
			line: eof.endLine,
			column: eof.endColumn + 1,
		},
	});
	const result = builder.build();
	const decls = result.decls.map(toDecl);
	const scopes = result.scopes.map(toSemanticScope);
	const refs = result.refs.slice();
	const annotations = finalizeAnnotations(result.annotations);
	return {
		file: path,
		source,
		syntaxError: parseEntry.syntaxError,
		chunk: retainedChunk,
		annotations,
		decls,
		scopes,
		refs,
		memberAccesses: result.memberAccesses,
		declarationIdsBySyntax: result.declarationIdsBySyntax,
		referencesBySyntax: result.referencesBySyntax,
		referencesByName: result.referencesByName,
		moduleAliases: result.moduleAliases,
		moduleReferences: result.moduleReferences,
		callSites: result.callSites,
		declarationValues: result.declarationValues,
		moduleValues: result.moduleValues,
		memberValues: result.memberValues,
		functionReturnValues: result.functionReturnValues,
		functionValueFlows: result.functionValueFlows,
		callValues: result.callValues,
		valueAssignments: result.valueAssignments,
	};
}

class LuaProjectIndex {
	private readonly files: Map<string, FileSemanticData> = new Map();
	private readonly symbols: Map<SymbolID, Decl> = new Map();
	private readonly globalsByKey: Map<string, SymbolID> = new Map();
	private readonly globalsSources: Map<string, Map<SymbolID, number>> = new Map();
	private readonly fileOrder: Map<string, number> = new Map();
	public orderedFiles: readonly FileSemanticData[] = [];
	public symbolResolver: WorkspaceSymbolResolver;
	private version = 0;
	private nextFileOrder = 1;

	constructor() {
		this.symbolResolver = this.buildWorkspaceSymbolResolver();
	}

	public updateFile(file: string, source: string, parsed?: ParsedLuaChunk): FileSemanticData {
		const current = this.files.get(file);
		if (current && current.source === source) {
			return current;
		}
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
		for (let i = 0; i < data.decls.length; i += 1) {
			const decl = data.decls[i];
			if (decl.isGlobal) {
				this.addGlobalDecl(decl);
			}
		}
	}

	private removeFileData(data: FileSemanticData): void {
		for (let i = 0; i < data.decls.length; i += 1) {
			const decl = data.decls[i];
			this.symbols.delete(decl.id);
			if (decl.isGlobal) {
				this.removeGlobalDecl(decl);
			}
		}
	}

	private addGlobalDecl(decl: Decl): void {
		const key = decl.symbolKey;
		let bucket = this.globalsSources.get(key);
		if (!bucket) {
			bucket = new Map();
			this.globalsSources.set(key, bucket);
		}
		const existingOrder = bucket.get(decl.id);
		if (existingOrder === undefined) {
			bucket.set(decl.id, this.ensureFileOrder(decl.file));
		}
		const current = this.globalsByKey.get(key) ;
		const selected = this.selectGlobalForKey(bucket);
		if (selected !== current) {
			if (selected !== null) {
				this.globalsByKey.set(key, selected);
			} else {
				this.globalsByKey.delete(key);
			}
		}
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
		if (selected !== current) {
			if (selected !== null) {
				this.globalsByKey.set(key, selected);
			} else {
				this.globalsByKey.delete(key);
			}
		}
	}

	private selectGlobalForKey(bucket: Map<SymbolID, number>): SymbolID {
		let selected: SymbolID = null;
		let best = Number.POSITIVE_INFINITY;
		for (const [id, order] of bucket) {
			if (order < best) {
				best = order;
				selected = id;
			} else if (order === best && selected !== null && id < selected) {
				selected = id;
			}
		}
		return selected;
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
			declarations: new Map(this.symbols),
			globals,
		});
	}

	private replaceIndexedFile(file: string, data: FileSemanticData): boolean {
		const current = this.files.get(file);
		if (current && current.source === data.source) {
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
	private readonly documentEndExclusive: SourcePosition;
	private readonly annotations: SemanticAnnotations;
	private readonly scopeStack: Scope[] = [];
	private readonly scopes: Scope[] = [];
	private readonly properties: Map<string, InternalDecl> = new Map();
	private readonly propertiesByOwner: Map<string, InternalDecl> = new Map();
	private readonly globalsByKey: Map<string, InternalDecl> = new Map();
	private readonly decls: InternalDecl[] = [];
	private readonly declById: Map<SymbolID, InternalDecl> = new Map();
	private readonly refs: Ref[] = [];
	private readonly deferredMethodTargets: Ref[] = [];
	private readonly memberAccesses: MemberAccessEntry[] = [];
	private readonly declarationIdsBySyntax: Map<LuaIdentifierExpression, SymbolID> = new Map();
	private readonly referencesBySyntax: Map<LuaIdentifierExpression, Ref> = new Map();
	private readonly referencesByName: Map<string, Ref[]> = new Map();
	private readonly moduleReferences: LuaStringLiteralExpression[] = [];
	private readonly callSites: LuaCallSite[] = [];
	private readonly functionSignaturesByPath: Map<string, FunctionSignatureInfo> = new Map();
	private readonly methodSelfPathStack: (readonly string[] | undefined)[] = [];
	private readonly methodSelfScopeStack: (Scope | undefined)[] = [];
	private readonly methodSelfValueStack: (OwnedSemanticValueSource | undefined)[] = [];
	private readonly declarationValues: Map<SymbolID, SemanticValueSource[]> = new Map();
	private readonly projectionValueDeclarations: Set<SymbolID> = new Set();
	private readonly unknownValueDeclarations: Set<SymbolID> = new Set();
	private readonly memberValues: Map<SymbolID, MemberValueEntry> = new Map();
	private readonly functionReturnValues: Map<string, FunctionReturnValueEntry[]> = new Map();
	private readonly functionValueFlows: FunctionValueFlowEntry[] = [];
	private readonly callValues: CallValueEntry[] = [];
	private readonly valueAssignments: ValueAssignmentEntry[] = [];
	private moduleValue?: SemanticValueSource;
	private readonly moduleAliasesByDeclId: Map<SymbolID, ModuleAliasTarget> = new Map();
	private readonly moduleAliasesByName: Map<string, ModuleAliasEntry> = new Map();
	private readonly functionReturnValueStack: FunctionReturnValueState[] = [];
	private readonly functionValueFlowStack: FunctionValueFlowState[] = [];

	constructor(options: {
		chunk: LuaChunk;
		path: string;
		lineCount: number;
		documentEndExclusive: SourcePosition;
	}) {
		this.chunk = options.chunk;
		this.path = options.path;
		this.documentEndExclusive = options.documentEndExclusive;
		this.annotations = new Array(options.lineCount);
	}

	public build(): SemanticBuildResult {
		this.enterScope(
			{ line: 1, column: 1 },
			this.documentEndExclusive,
			'path',
		);
		for (let index = 0; index < this.chunk.body.length; index += 1) {
			this.visitStatement(this.chunk.body[index]);
		}
		for (let index = 0; index < this.deferredMethodTargets.length; index += 1) {
			const reference = this.deferredMethodTargets[index];
			const declaration = this.properties.get(reference.symbolKey);
			if (declaration !== undefined) {
				reference.target = declaration.id;
			}
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
			annotations: this.annotations,
			callSites: this.callSites,
			declarationValues: Array.from(this.declarationValues.entries()).flatMap(
				([declId, sources]) => {
					const relation = this.declById.get(declId)?.kind === 'constant'
						? 'identity' as const
						: this.projectionValueDeclarations.has(declId)
							? 'projection' as const
							: 'value' as const;
					return sources.map(source => ({ declId, source, relation }));
				},
			),
			moduleValues: this.moduleValue
				? [{ module: toLuaModulePath(this.path), source: this.moduleValue }]
				: [],
			memberValues: Array.from(this.memberValues.values()),
			functionReturnValues: Array.from(this.functionReturnValues.values()).flat(),
			functionValueFlows: this.functionValueFlows,
			callValues: this.callValues,
			valueAssignments: this.valueAssignments,
			moduleAliases: Array.from(this.moduleAliasesByName.values()),
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
					this.activateDecl(pending[0], pending[0].range.end);
				}
				const valueLimit = localAssignment.values.length;
				for (let index = 0; index < valueLimit; index += 1) {
					const valueExpression = localAssignment.values[index];
					const targetDecl = index < pending.length ? pending[index] : pending[pending.length - 1];
					if (valueExpression.kind === LuaSyntaxKind.FunctionExpression && targetDecl) {
						this.recordFunctionSignature(targetDecl, targetDecl.name, valueExpression, 'function');
					}
					const context: ExpressionContext = {
						tableBaseDecl: targetDecl,
						tableBasePath: targetDecl?.namePath,
					};
					if (targetDecl) {
						context.tableOwner = declarationValueSource(targetDecl.id);
					}
					const valueInfo = this.visitExpression(valueExpression, context);
					if (targetDecl) {
						this.setDeclarationValue(targetDecl, valueInfo?.valueSource);
					}
					if (index < pending.length) {
						this.setModuleAlias(
							pending[index],
							resolveModuleAliasValueSource(valueInfo?.valueSource, this.moduleAliasesByDeclId),
						);
					}
				}
				for (let index = 0; index < pending.length; index += 1) {
					if (index >= localAssignment.values.length) {
						this.setModuleAlias(pending[index], null);
					}
					this.activateDecl(pending[index], localAssignment.range.end);
				}
				break;
			}
			case LuaSyntaxKind.LocalFunctionStatement: {
				const localFunction = statement;
				const decl = this.declareLocal(localFunction.name, 'function', true);
				this.recordFunctionSignature(decl, localFunction.name.name, localFunction.functionExpression, 'function');
				this.visitFunctionExpression(
					localFunction.functionExpression,
					undefined,
					declarationValueSource(decl.id),
				);
				break;
			}
			case LuaSyntaxKind.FunctionDeclarationStatement: {
				const functionDeclaration = statement;
				const namePath = buildFunctionNamePath(functionDeclaration.name);
				const symbolKey = joinNamePath(namePath);
				const functionOwner = this.resolveMemberOwnerSource(namePath);
				const scope = this.currentScope();
				let decl = functionOwner
					? this.propertiesByOwner.get(this.memberOwnerKey(functionOwner, namePath[namePath.length - 1]))
					: this.properties.get(symbolKey);
				if (!decl) {
					const isGlobal = scope.kind === 'path';
					const declarationName = functionDeclaration.name.method
						?? functionDeclaration.name.path[functionDeclaration.name.path.length - 1];
					const range = declarationName.range;
					decl = this.createDecl({
						syntax: declarationName,
						namePath,
						name: namePath[namePath.length - 1],
						kind: 'function',
						range,
						scopeRef: scope,
						isGlobal,
						active: true,
					});
					this.properties.set(symbolKey, decl);
					if (functionOwner) {
						this.propertiesByOwner.set(
							this.memberOwnerKey(functionOwner, decl.name),
							decl,
						);
					}
					if (isGlobal) {
						this.globalsByKey.set(symbolKey, decl);
					}
				}
				if (functionOwner) {
					this.recordMemberValue({
						declId: decl.id,
						name: decl.name,
						owner: functionOwner,
					});
				}
				this.recordFunctionNameReferences(functionDeclaration);
				this.recordFunctionDeclarationWriteReference(functionDeclaration, decl);
				const functionPath = functionDeclaration.name.path;
				const baseNames = new Array<string>(functionPath.length);
				for (let pathIndex = 0; pathIndex < functionPath.length; pathIndex += 1) {
					baseNames[pathIndex] = functionPath[pathIndex].name;
				}
				const basePath = joinNamePath(baseNames);
				const methodName = functionDeclaration.name.method?.name;
				const methodReceiverClass = methodName ? functionOwner : undefined;
				const declarationPath = methodName
					? `${basePath}:${methodName}`
					: basePath;
				this.recordFunctionSignature(decl, declarationPath, functionDeclaration.functionExpression, methodName ? 'method' : 'function');
				let methodSelfPath = methodName ? baseNames : undefined;
				if (!methodSelfPath
					&& baseNames.length > 1
					&& functionDeclaration.functionExpression.parameters[0]?.name === 'self') {
					methodSelfPath = baseNames.slice(0, -1);
				}
				this.visitFunctionExpression(
					functionDeclaration.functionExpression,
					methodSelfPath,
					declarationValueSource(decl.id),
					methodReceiverClass,
				);
				break;
			}
			case LuaSyntaxKind.AssignmentStatement: {
				const assignment = statement;
				const targets: AssignmentTargetInfo[] = [];
				for (let index = 0; index < assignment.left.length; index += 1) {
					targets.push(this.handleAssignmentTarget(assignment.left[index]));
				}
				for (let index = 0; index < assignment.right.length; index += 1) {
					const targetInfo = index < targets.length ? targets[index] : targets[targets.length - 1] ;
					const context: ExpressionContext = targetInfo
						? {
							tableBaseDecl: targetInfo.decl,
							tableBasePath: targetInfo.decl ? targetInfo.decl.namePath : targetInfo.namePath,
						}
						: { tableBaseDecl: null, tableBasePath: null };
					if (targetInfo?.decl) {
						context.tableOwner = declarationValueSource(targetInfo.decl.id);
					}
					const valueExpression = assignment.right[index];
					if (valueExpression.kind === LuaSyntaxKind.FunctionExpression) {
						if (targetInfo?.decl) {
							this.recordFunctionSignature(
								targetInfo.decl,
								joinNamePath(targetInfo.decl.namePath),
								valueExpression,
								'function',
							);
						}
						const targetPath = targetInfo?.namePath;
						let selfPath: readonly string[] | undefined;
						if (targetPath
							&& targetPath.length > 1
							&& valueExpression.parameters[0]?.name === 'self') {
							selfPath = targetPath.slice(0, -1);
						}
						const functionValue = targetInfo?.decl
							? declarationValueSource(targetInfo.decl.id)
							: this.createExpressionValueSource(valueExpression);
						this.visitFunctionExpression(valueExpression, selfPath, functionValue);
						if (targetInfo?.valueTarget) {
							this.recordValueFlow(targetInfo.valueTarget, functionValue, 'value');
						}
						continue;
					}
					const valueInfo = this.visitExpression(valueExpression, context);
					if (targetInfo?.decl) {
						this.setDeclarationValue(targetInfo.decl, valueInfo?.valueSource);
					}
					if (index < assignment.left.length
						&& assignment.left[index].kind === LuaSyntaxKind.IdentifierExpression) {
						targetInfo.moduleAlias = resolveModuleAliasValueSource(
							valueInfo?.valueSource,
							this.moduleAliasesByDeclId,
						);
					}
					if (targetInfo?.valueTarget && valueInfo?.valueSource) {
						this.recordValueFlow(targetInfo.valueTarget, valueInfo.valueSource, 'value');
					}
				}
				for (let index = 0; index < assignment.left.length; index += 1) {
					const target = assignment.left[index];
					if (target.kind !== LuaSyntaxKind.IdentifierExpression) {
						continue;
					}
					this.setModuleAlias(targets[index].decl, targets[index].moduleAlias);
				}
				break;
			}
			case LuaSyntaxKind.ReturnStatement: {
				const returnStatement = statement;
				let returnValue: SemanticValueSource | undefined;
				const moduleReturn = this.currentScope().kind === 'path'
					&& returnStatement.expressions.length === 1;
				const moduleOwnedValue = moduleReturn
					? moduleTableValueSource(toLuaModulePath(this.path))
					: undefined;
				for (let index = 0; index < returnStatement.expressions.length; index += 1) {
					const valueInfo = this.visitExpression(
						returnStatement.expressions[index],
						{
							tableBaseDecl: null,
							tableBasePath: null,
							tableOwner: moduleOwnedValue,
							moduleReturn,
						},
					);
					if (index === 0) {
						returnValue = valueInfo?.valueSource;
					}
				}
				this.recordFunctionReturnValue(returnValue);
				if (moduleReturn) {
					this.moduleValue = returnValue;
				}
				break;
			}
			case LuaSyntaxKind.IfStatement: {
				const ifStatement = statement;
				for (let index = 0; index < ifStatement.clauses.length; index += 1) {
					const clause = ifStatement.clauses[index];
					if (clause.condition) {
						this.visitExpression(clause.condition, { tableBaseDecl: null, tableBasePath: null });
					}
					this.enterScope(clause.block.startInclusive, clause.block.endExclusive, 'block');
					this.visitBlock(clause.block);
					this.leaveScope();
				}
				break;
			}
			case LuaSyntaxKind.WhileStatement: {
				const whileStatement = statement;
				this.visitExpression(whileStatement.condition, { tableBaseDecl: null, tableBasePath: null });
				this.enterScope(whileStatement.block.startInclusive, whileStatement.block.endExclusive, 'loop');
				this.visitBlock(whileStatement.block);
				this.leaveScope();
				break;
			}
			case LuaSyntaxKind.RepeatStatement: {
				const repeatStatement = statement;
				this.enterScope(
					repeatStatement.block.startInclusive,
					positionAfter(repeatStatement.range.end),
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
				this.enterScope(forNumeric.block.startInclusive, forNumeric.block.endExclusive, 'loop');
				const variable = this.declareLocal(forNumeric.variable, 'local', true);
				this.unknownValueDeclarations.add(variable.id);
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
				this.enterScope(forGeneric.block.startInclusive, forGeneric.block.endExclusive, 'loop');
				let valueVariable: InternalDecl | undefined;
				for (let index = 0; index < forGeneric.variables.length; index += 1) {
					const variable = this.declareLocal(forGeneric.variables[index], 'local', true);
					if (index === 0) {
						this.unknownValueDeclarations.add(variable.id);
					} else if (index === 1) {
						valueVariable = variable;
					}
				}
				if (tableSource && valueVariable) {
					this.setDeclarationProjection(valueVariable, appendValueElement(tableSource));
				}
				this.visitBlock(forGeneric.block);
				this.leaveScope();
				break;
			}
			case LuaSyntaxKind.DoStatement: {
				const doStatement = statement;
				this.enterScope(doStatement.block.startInclusive, doStatement.block.endExclusive, 'block');
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
		for (let index = 0; index < block.body.length; index += 1) {
			this.visitStatement(block.body[index]);
		}
	}

	private visitExpression(expression: LuaExpression, context: ExpressionContext): ResolvedNamePath {
		switch (expression.kind) {
			case LuaSyntaxKind.IdentifierExpression:
				return this.handleIdentifierExpression(expression, false);
			case LuaSyntaxKind.MemberExpression:
				return this.handleMemberExpression(expression, context, false);
			case LuaSyntaxKind.IndexExpression:
				return this.handleIndexExpression(expression, context);
			case LuaSyntaxKind.CallExpression: {
				const callExpression = expression;
				const methodName = callExpression.method?.name;
				const callResult = this.createExpressionValueSource(callExpression);
				const calleeInfo = methodName
					? this.visitExpression(callExpression.callee, context)
					: this.visitCallTarget(callExpression.callee, context);
				const requireArgument = resolveBuiltinRequireArgument(
					callExpression,
					calleeInfo !== null && calleeInfo.decl === null,
				);
				if (requireArgument) {
					this.moduleReferences.push(requireArgument);
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
				const calledValue = methodName && calleeInfo?.valueSource
					? appendValueMember(calleeInfo.valueSource, methodName)
					: calleeInfo?.valueSource;
				const moduleTarget = resolveModuleAliasValueSource(
					calledValue,
					this.moduleAliasesByDeclId,
				);
				const moduleTargetBinding = moduleTarget && calledValue
					? (calledValue.root.kind === 'module'
						|| (calledValue.root.kind === 'declaration'
							&& this.declById.get(calledValue.root.declId)?.kind === 'constant')
						? 'immutable'
						: 'mutable')
					: null;
				let firstArgumentInfo: ResolvedNamePath = null;
				let secondArgumentInfo: ResolvedNamePath = null;
				const argumentOffset = methodName ? 1 : 0;
				const argumentValues = new Array<SemanticValueSource | undefined>(
					callExpression.arguments.length + argumentOffset,
				);
				if (methodName) {
					argumentValues[0] = calleeInfo?.valueSource;
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
					argumentValues[index + argumentOffset] = argumentInfo?.valueSource;
				}
				if (calledValue) {
					this.recordCallValue({
						callee: calledValue,
						arguments: argumentValues,
						result: callResult,
					}, callReference);
				}
				this.callSites.push({
					expression: callExpression,
					calleeValue: calledValue,
					moduleTarget,
					moduleTargetBinding,
					reference: callReference,
					directTarget: callReference === undefined
						&& calleeInfo !== null
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
				return valueSource
					? { namePath: null, decl: null, valueSource }
					: null;
			}
			case LuaSyntaxKind.FunctionExpression: {
				const functionValue = context.tableBaseDecl
					? declarationValueSource(context.tableBaseDecl.id)
					: this.createExpressionValueSource(expression);
				this.visitFunctionExpression(expression, undefined, functionValue);
				return { namePath: null, decl: context.tableBaseDecl, valueSource: functionValue };
			}
			case LuaSyntaxKind.TableConstructorExpression: {
				const tableOwner = context.moduleReturn && context.tableOwner
					? context.tableOwner
					: this.createTableValueSource(expression);
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
					if (left?.valueSource) {
						this.recordValueFlow(valueSource, left.valueSource, 'value');
					}
					if (right?.valueSource) {
						this.recordValueFlow(valueSource, right.valueSource, 'value');
					}
					return { namePath: null, decl: null, valueSource };
				}
				return null;
			}
			case LuaSyntaxKind.UnaryExpression: {
				this.visitExpression(expression.operand, context);
				return null;
			}
			case LuaSyntaxKind.SizeOfExpression: {
				for (const lengthExpression of expression.typeRef.arrayLengths) {
					if (lengthExpression) {
						this.visitExpression(lengthExpression, { tableBaseDecl: null, tableBasePath: null });
					}
				}
				return null;
			}
			case LuaSyntaxKind.OffsetOfExpression:
				return null;
			case LuaSyntaxKind.VarargExpression:
			case LuaSyntaxKind.NilLiteralExpression:
				return null;
			case LuaSyntaxKind.StringLiteralExpression:
				return {
					namePath: null,
					decl: null,
					valueSource: literalValueSource({ kind: 'string', value: expression.value }),
				};
			case LuaSyntaxKind.NumericLiteralExpression:
				return {
					namePath: null,
					decl: null,
					valueSource: literalValueSource({ kind: 'number', value: expression.value }),
				};
			case LuaSyntaxKind.BooleanLiteralExpression:
				return {
					namePath: null,
					decl: null,
					valueSource: literalValueSource({ kind: 'boolean', value: expression.value }),
				};
			default:
				return null;
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
					if (context.tableOwner && valueInfo?.valueSource) {
						this.recordValueFlow(
							appendValueElement(context.tableOwner),
							valueInfo.valueSource,
							'value',
						);
					}
					break;
				}
				case LuaTableFieldKind.IdentifierKey: {
					const baseDecl = context.tableBaseDecl;
					const basePath = context.tableBasePath;
					const namePath = basePath ? appendToNamePath(basePath, field.name) : [field.name];
					const decl = this.ensureTableField(
						namePath,
						field.range.start,
						field.name.length,
						baseDecl,
						context.tableOwner,
					);
					const valueContext: ExpressionContext = {
						tableBaseDecl: decl,
						tableBasePath: decl.namePath,
						tableOwner: declarationValueSource(decl.id),
					};
					if (field.value.kind === LuaSyntaxKind.FunctionExpression) {
						this.recordFunctionSignature(decl, joinNamePath(decl.namePath), field.value, 'function');
					}
					const valueInfo = this.visitExpression(field.value, valueContext);
					this.setDeclarationValue(decl, valueInfo?.valueSource);
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
						const decl = this.ensureTableField(
							namePath,
							field.key.range.start,
							field.key.value.length,
							context.tableBaseDecl,
							context.tableOwner,
						);
						if (field.value.kind === LuaSyntaxKind.FunctionExpression) {
							this.recordFunctionSignature(decl, joinNamePath(decl.namePath), field.value, 'function');
						}
						const valueInfo = this.visitExpression(field.value, {
							tableBaseDecl: decl,
							tableBasePath: decl.namePath,
							tableOwner: declarationValueSource(decl.id),
						});
						this.setDeclarationValue(decl, valueInfo?.valueSource);
						break;
					}
					const valueInfo = this.visitExpression(field.value, { tableBaseDecl: null, tableBasePath: null });
					if (context.tableOwner && valueInfo?.valueSource) {
						this.recordValueFlow(
							keyInfo?.valueSource
								? appendValueIndex(context.tableOwner, keyInfo.valueSource)
								: appendValueElement(context.tableOwner),
							valueInfo.valueSource,
							'value',
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
		functionValue: FunctionSemanticValueSource,
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
			? ownedValueSource(`method-receiver:${semanticValueSourceKey(functionValue)}`)
			: undefined;
		if (receiver) {
			parameters[0] = receiver;
		}
		const valueFlow: FunctionValueFlowState = {
			functionValue,
			lexicalOwner: this.functionValueFlowStack[this.functionValueFlowStack.length - 1],
			parameters,
			receiverProjection,
			implicitReceiver: methodReceiverClass !== undefined,
			declarationIds: [],
			ownedValueKeys: [],
			members: [],
			calls: [],
			assignments: [],
		};
		this.functionValueFlowStack.push(valueFlow);
		const block = expression.body;
		this.enterScope(block.startInclusive, block.endExclusive, 'function');
		const inheritedMethodSelfPath = this.currentMethodSelfPath();
		const inheritedMethodSelfScope = this.methodSelfScopeStack[this.methodSelfScopeStack.length - 1];
		const effectiveMethodSelfPath = methodSelfPath ?? inheritedMethodSelfPath;
		this.methodSelfPathStack.push(effectiveMethodSelfPath?.slice());
		this.methodSelfScopeStack.push(methodSelfPath ? this.currentScope() : inheritedMethodSelfScope);
		const implicitSelfValue = receiver ?? this.currentMethodSelfValue();
		this.methodSelfValueStack.push(implicitSelfValue);
		this.currentScope().implicitSelfValue = implicitSelfValue;
		this.functionReturnValueStack.push({
			sources: [],
		});
		for (let index = 0; index < expression.parameters.length; index += 1) {
			const parameter = this.declareParameter(expression.parameters[index]);
			parameters[index + (receiver ? 1 : 0)] = declarationValueSource(parameter.id);
		}
		this.visitBlock(block);
		const returnValue = this.functionReturnValueStack.pop()!;
		this.methodSelfValueStack.pop();
		this.methodSelfScopeStack.pop();
		this.methodSelfPathStack.pop();
		this.leaveScope();
		this.functionValueFlowStack.pop();
		this.functionValueFlows.push(valueFlow);
		const functionKey = semanticValueSourceKey(functionValue);
		if (returnValue.sources.length > 0) {
			this.functionReturnValues.set(
				functionKey,
				returnValue.sources.map(source => ({ functionValue, source })),
			);
		} else {
			this.functionReturnValues.delete(functionKey);
		}
	}

	private currentMethodSelfPath(): readonly string[] | undefined {
		if (this.methodSelfPathStack.length === 0) {
			return undefined;
		}
		return this.methodSelfPathStack[this.methodSelfPathStack.length - 1];
	}

	private currentMethodSelfValue(): OwnedSemanticValueSource | undefined {
		return this.methodSelfValueStack[this.methodSelfValueStack.length - 1];
	}

	private handleAssignmentTarget(target: LuaAssignableExpression): AssignmentTargetInfo {
		switch (target.kind) {
			case LuaSyntaxKind.IdentifierExpression:
				return this.assignIdentifier(target);
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

	private assignIdentifier(identifier: LuaIdentifierExpression): AssignmentTargetInfo {
		const existing = this.resolveName(identifier.name);
		const range = identifier.range;
		if (existing) {
			this.recordReference({
				syntax: identifier,
				namePath: existing.namePath,
				name: identifier.name,
				range,
				target: existing.id,
				isWrite: true,
				referenceKind: 'identifier',
				staticExpressionPath: identifier.name,
			});
			return { decl: existing, namePath: existing.namePath, path: identifier.name };
		}
		const globalDecl = this.globalsByKey.get(identifier.name);
		if (globalDecl) {
			this.recordReference({
				syntax: identifier,
				namePath: globalDecl.namePath,
				name: identifier.name,
				range,
				target: globalDecl.id,
				isWrite: true,
				referenceKind: 'identifier',
				staticExpressionPath: identifier.name,
			});
			return { decl: globalDecl, namePath: globalDecl.namePath, path: identifier.name };
		}
		const decl = this.declareGlobal(identifier, range);
		this.recordReference({
			syntax: identifier,
			namePath: decl.namePath,
			name: identifier.name,
			range,
			target: decl.id,
			isWrite: true,
			referenceKind: 'identifier',
			staticExpressionPath: identifier.name,
		});
		return { decl, namePath: decl.namePath, path: identifier.name };
	}

	private assignMember(member: LuaMemberExpression): AssignmentTargetInfo {
		const baseInfo = this.visitExpression(member.base, { tableBaseDecl: null, tableBasePath: null });
		this.recordMemberAccess(
			member.member.range,
			baseInfo?.valueSource,
			member.operator,
			baseInfo?.namePath,
		);
		if (member.member.kind === LuaSyntaxKind.MissingIdentifier) {
			return { decl: null, namePath: null, path: null };
		}
		const basePath = resolveReferencedBasePath(baseInfo, member.base);
		const baseDecl = baseInfo?.decl;
		const memberName = member.member.name;
		const namePath = basePath ? appendToNamePath(basePath, memberName) : [memberName];
		const range = member.member.range;
		const decl = this.ensureTableField(
			namePath,
			range.start,
			memberName.length,
			baseDecl,
			baseInfo?.valueSource,
			member.member,
		);
		this.recordReference({
			syntax: member.member,
			namePath,
			name: memberName,
			range,
			target: decl.id,
			isWrite: true,
			referenceKind: 'member',
			staticExpressionPath: resolveStaticLuaExpressionPath(member),
			receiverSymbolKey: baseDecl?.symbolKey || (baseInfo?.namePath && joinNamePath(baseInfo.namePath)),
			receiverValue: baseInfo?.valueSource,
		});
		return {
			decl,
			namePath,
			path: joinNamePath(namePath),
			memberBaseDecl: baseDecl,
			memberOwner: baseInfo?.valueSource,
		};
	}

	private assignIndex(indexExpression: LuaIndexExpression): AssignmentTargetInfo {
		const baseInfo = this.visitExpression(indexExpression.base, { tableBaseDecl: null, tableBasePath: null });
		const indexInfo = this.visitExpression(indexExpression.index, { tableBaseDecl: null, tableBasePath: null });
		const namePath = resolveReferencedBasePath(baseInfo, indexExpression.base);
		if (indexExpression.index.kind === LuaSyntaxKind.StringLiteralExpression) {
			const fieldName = indexExpression.index.value;
			const fieldPath = namePath ? appendToNamePath(namePath, fieldName) : [fieldName];
			const decl = this.ensureTableField(
				fieldPath,
				indexExpression.index.range.start,
				fieldName.length,
				baseInfo?.decl,
				baseInfo?.valueSource,
			);
			this.recordReference({
				namePath: fieldPath,
				name: fieldName,
				range: indexExpression.index.range,
				target: decl.id,
				isWrite: true,
				referenceKind: 'member',
				staticExpressionPath: resolveStaticLuaExpressionPath(indexExpression),
				receiverSymbolKey: baseInfo?.decl?.symbolKey || (baseInfo?.namePath && joinNamePath(baseInfo.namePath)),
				receiverValue: baseInfo?.valueSource,
			});
			return {
				decl,
				namePath: fieldPath,
				path: joinNamePath(fieldPath),
				memberBaseDecl: baseInfo?.decl,
				memberOwner: baseInfo?.valueSource,
			};
		}
		return {
			decl: null,
			namePath,
			path: namePath && joinNamePath(namePath),
			valueTarget: baseInfo?.valueSource
				? indexInfo?.valueSource
					? appendValueIndex(baseInfo.valueSource, indexInfo.valueSource)
					: appendValueElement(baseInfo.valueSource)
				: undefined,
		};
	}

	private recordMethodReference(callExpression: LuaCallExpression, calleeInfo: ResolvedNamePath): Ref {
		let basePath = resolveReferencedBasePath(calleeInfo, callExpression.callee);
		let implicitSelfReceiver = false;
		if (basePath
			&& basePath.length === 1
			&& basePath[0] === 'self'
			&& (!calleeInfo || !calleeInfo.decl)) {
			const methodSelfPath = this.currentMethodSelfPath();
			if (methodSelfPath && methodSelfPath.length > 0) {
				basePath = methodSelfPath.slice();
				implicitSelfReceiver = true;
			}
		}
		const receiverSymbolKey = calleeInfo?.decl?.symbolKey || (calleeInfo?.namePath && joinNamePath(calleeInfo.namePath));
		const method = callExpression.method;
		this.recordMemberAccess(
			method.range,
			calleeInfo?.valueSource,
			LuaMemberOperator.Colon,
			calleeInfo?.namePath,
		);
		const methodName = method.name;
		const namePath = basePath ? appendToNamePath(basePath, methodName) : [methodName];
		const range = method.range;
		const decl = this.resolveMemberDeclaration(
			calleeInfo?.valueSource,
			methodName,
			calleeInfo?.decl,
		) ?? (implicitSelfReceiver || !calleeInfo?.valueSource
			? this.properties.get(joinNamePath(namePath))
			: undefined);
		const targetId = decl?.id;
		const receiverExpressionPath = resolveStaticLuaExpressionPath(callExpression.callee);
		const reference = this.recordReference({
			syntax: method,
			namePath,
			name: methodName,
			range,
			target: targetId,
			isWrite: false,
			referenceKind: 'method',
			staticExpressionPath: receiverExpressionPath === null
				? null
				: `${receiverExpressionPath}.${methodName}`,
			receiverSymbolKey,
			receiverValue: calleeInfo?.valueSource,
			isCall: true,
		});
		if (implicitSelfReceiver && targetId === undefined) {
			this.deferredMethodTargets.push(reference);
		}
		return reference;
	}

	private recordFunctionSignature(
		decl: InternalDecl,
		path: string,
		expression: LuaFunctionExpression,
		declarationStyle: 'function' | 'method',
	): void {
		decl.signature = registerFunctionFromExpression(
			this.functionSignaturesByPath,
			path,
			expression,
			declarationStyle,
		);
	}

	private handleIdentifierExpression(identifier: LuaIdentifierExpression, isWrite: boolean, isCall = false): ResolvedNamePath {
		const range = identifier.range;
		const resolved = this.resolveName(identifier.name);
		const namePath = [identifier.name];
		if (identifier.name === 'self') {
			const methodSelfPath = this.currentMethodSelfPath();
			if (methodSelfPath && methodSelfPath.length > 0) {
				const methodSelfScope = this.methodSelfScopeStack[this.methodSelfScopeStack.length - 1];
				let bindingScope = resolved?.scopeRef;
				while (bindingScope && bindingScope !== methodSelfScope) {
					bindingScope = bindingScope.parent;
				}
				if (!bindingScope) {
					const classValue = this.resolveValueSourceFromNamePath(methodSelfPath);
					this.recordReference({
						syntax: identifier,
						namePath,
						name: identifier.name,
						range,
						isWrite,
						referenceKind: 'self',
						staticExpressionPath: identifier.name,
						isCall,
					});
					return {
						namePath,
						decl: null,
						valueSource: this.currentMethodSelfValue()
							?? (classValue ? appendValueInstance(classValue) : undefined),
					};
				}
			}
		}
		const targetId = resolved?.id;
		if (resolved) {
			this.recordReference({
				syntax: identifier,
				namePath,
				name: identifier.name,
				range,
				target: targetId,
				isWrite,
				referenceKind: 'identifier',
				staticExpressionPath: identifier.name,
				isCall,
			});
			return {
				namePath,
				decl: resolved,
				valueSource: this.unknownValueDeclarations.has(resolved.id)
					? unknownValueSource()
					: declarationValueSource(resolved.id),
			};
		}
		const globalDecl = this.globalsByKey.get(identifier.name);
		if (globalDecl) {
			this.recordReference({
				syntax: identifier,
				namePath,
				name: identifier.name,
				range,
				target: globalDecl.id,
				isWrite,
				referenceKind: 'identifier',
				staticExpressionPath: identifier.name,
				isCall,
			});
			return {
				namePath,
				decl: globalDecl,
				valueSource: declarationValueSource(globalDecl.id),
			};
		}
		this.recordReference({
			syntax: identifier,
			namePath,
			name: identifier.name,
			range,
			isWrite,
			referenceKind: 'identifier',
			staticExpressionPath: identifier.name,
			isCall,
		});
		return {
			namePath,
			decl: null,
			valueSource: globalValueSource(identifier.name),
		};
	}

	private handleMemberExpression(member: LuaMemberExpression, context: ExpressionContext, isWrite: boolean, isCall = false): ResolvedNamePath {
		const baseInfo = this.visitExpression(member.base, context);
		this.recordMemberAccess(
			member.member.range,
			baseInfo?.valueSource,
			member.operator,
			baseInfo?.namePath,
		);
		if (member.member.kind === LuaSyntaxKind.MissingIdentifier) {
			return baseInfo;
		}
		const basePath = resolveReferencedBasePath(baseInfo, member.base);
		const memberName = member.member.name;
		const namePath = basePath ? appendToNamePath(basePath, memberName) : [memberName];
		const range = member.member.range;
		const decl = this.resolveMemberDeclaration(
			baseInfo?.valueSource,
			memberName,
			baseInfo?.decl,
		) ?? (baseInfo?.valueSource ? undefined : this.properties.get(joinNamePath(namePath)));
		const targetId = decl?.id;
		this.recordReference({
			syntax: member.member,
			namePath,
			name: memberName,
			range,
			target: targetId,
			isWrite,
			referenceKind: 'member',
			staticExpressionPath: resolveStaticLuaExpressionPath(member),
			receiverSymbolKey: baseInfo?.decl?.symbolKey || (baseInfo?.namePath && joinNamePath(baseInfo.namePath)),
			receiverValue: baseInfo?.valueSource,
			isCall,
		});
		return {
			namePath,
			decl,
			valueSource: baseInfo?.valueSource
				? appendValueMember(baseInfo.valueSource, memberName)
				: undefined,
		};
	}

	private recordMemberAccess(
		range: LuaSourceRange,
		receiver: SemanticValueSource | undefined,
		operator: LuaMemberOperator,
		namePath: readonly string[] | null | undefined,
	): void {
		if (receiver === undefined) {
			return;
		}
		if (namePath != null) {
			this.memberAccesses.push({ range, receiver, operator, namePath });
			return;
		}
		this.memberAccesses.push({ range, receiver, operator });
	}

	private handleIndexExpression(indexExpression: LuaIndexExpression, context: ExpressionContext): ResolvedNamePath {
		const baseInfo = this.visitExpression(indexExpression.base, context);
		const indexInfo = this.visitExpression(indexExpression.index, { tableBaseDecl: null, tableBasePath: null });
		if (!baseInfo?.valueSource) {
			return null;
		}
		if (indexExpression.index.kind === LuaSyntaxKind.StringLiteralExpression) {
			const name = indexExpression.index.value;
			const basePath = resolveReferencedBasePath(baseInfo, indexExpression.base);
			const namePath = basePath ? appendToNamePath(basePath, name) : [name];
			const decl = this.resolveMemberDeclaration(
				baseInfo.valueSource,
				name,
				baseInfo.decl,
			) ?? this.properties.get(joinNamePath(namePath));
			return {
				namePath,
				decl,
				valueSource: appendValueMember(baseInfo.valueSource, name),
			};
		}
		return {
			namePath: null,
			decl: null,
			valueSource: indexInfo?.valueSource
				? appendValueIndex(baseInfo.valueSource, indexInfo.valueSource)
				: appendValueElement(baseInfo.valueSource),
		};
	}

	private declareLocal(name: LuaIdentifierExpression, kind: SemanticSymbolKind, activate: boolean): InternalDecl {
		const scope = this.currentScope();
		const range = name.range;
		const decl = this.createDecl({
			syntax: name,
			namePath: [name.name],
			name: name.name,
			kind,
			range,
			scopeRef: scope,
			isGlobal: false,
			active: activate,
		});
		if (activate) {
			this.addBinding(scope, decl);
		}
		this.recordDefinitionAnnotation(decl);
		return decl;
	}

	private declareParameter(name: LuaIdentifierExpression): InternalDecl {
		const scope = this.currentScope();
		const range = name.range;
		const decl = this.createDecl({
			syntax: name,
			namePath: [name.name],
			name: name.name,
			kind: 'parameter',
			range,
			scopeRef: scope,
			isGlobal: false,
			active: true,
		});
		this.addBinding(scope, decl);
		this.recordDefinitionAnnotation(decl);
		return decl;
	}

	private declareType(name: LuaIdentifierExpression): InternalDecl {
		const scope = this.currentScope();
		const range = name.range;
		const decl = this.createDecl({
			syntax: name,
			namePath: [name.name],
			name: name.name,
			kind: 'type',
			range,
			scopeRef: scope,
			isGlobal: scope.kind === 'path',
			active: true,
		});
		this.addBinding(scope, decl);
		if (decl.isGlobal) {
			this.globalsByKey.set(decl.symbolKey, decl);
		}
		this.recordDefinitionAnnotation(decl);
		return decl;
	}

	private declareBss(name: LuaIdentifierExpression): InternalDecl {
		const scope = this.currentScope();
		const range = name.range;
		const decl = this.createDecl({
			syntax: name,
			namePath: [name.name],
			name: name.name,
			kind: 'bss',
			range,
			scopeRef: scope,
			isGlobal: scope.kind === 'path',
			active: true,
		});
		this.addBinding(scope, decl);
		if (decl.isGlobal) {
			this.globalsByKey.set(decl.symbolKey, decl);
		}
		this.recordDefinitionAnnotation(decl);
		return decl;
	}

	private declareData(name: LuaIdentifierExpression): InternalDecl {
		const scope = this.currentScope();
		const range = name.range;
		const decl = this.createDecl({
			syntax: name,
			namePath: [name.name],
			name: name.name,
			kind: 'data',
			range,
			scopeRef: scope,
			isGlobal: scope.kind === 'path',
			active: true,
		});
		this.addBinding(scope, decl);
		if (decl.isGlobal) {
			this.globalsByKey.set(decl.symbolKey, decl);
		}
		this.recordDefinitionAnnotation(decl);
		return decl;
	}

	private declareRodata(name: LuaIdentifierExpression): InternalDecl {
		const scope = this.currentScope();
		const range = name.range;
		const decl = this.createDecl({
			syntax: name,
			namePath: [name.name],
			name: name.name,
			kind: 'rodata',
			range,
			scopeRef: scope,
			isGlobal: scope.kind === 'path',
			active: true,
		});
		this.addBinding(scope, decl);
		if (decl.isGlobal) {
			this.globalsByKey.set(decl.symbolKey, decl);
		}
		this.recordDefinitionAnnotation(decl);
		return decl;
	}

	private declareGlobal(identifier: LuaIdentifierExpression, range: LuaSourceRange): InternalDecl {
		const scope = this.scopeStack[0];
		const namePath = [identifier.name];
		const decl = this.createDecl({
			syntax: identifier,
			namePath,
			name: identifier.name,
			kind: 'global',
			range,
			scopeRef: scope,
			isGlobal: true,
			active: true,
		});
		this.globalsByKey.set(decl.symbolKey, decl);
		this.recordDefinitionAnnotation(decl);
		return decl;
	}

	private ensureTableField(
		namePath: readonly string[],
		start: SourcePosition,
		length: number,
		baseDecl: InternalDecl,
		owner: SemanticValueSource,
		syntax?: LuaIdentifierExpression,
	): InternalDecl {
		const key = joinNamePath(namePath);
		const name = namePath[namePath.length - 1];
		const ownerKey = owner && this.memberOwnerKey(owner, name);
		const existing = this.resolveMemberDeclaration(
			owner,
			name,
			baseDecl,
		) ?? (owner ? undefined : this.properties.get(key));
		if (existing) {
			if (owner) {
				this.recordMemberValue({
					declId: existing.id,
					name: existing.name,
					owner,
				});
			}
			return existing;
		}
		const scope = baseDecl ? baseDecl.scopeRef : this.currentScope();
		const range = buildRangeFromPosition(start, length, this.path);
		const isGlobal = baseDecl ? baseDecl.isGlobal : scope.kind === 'path' && namePath.length > 1;
		const decl = this.createDecl({
			syntax,
			namePath: namePath,
			name,
			kind: 'property',
			range,
			scopeRef: scope,
			isGlobal,
			active: true,
		});
		this.properties.set(key, decl);
		if (ownerKey) {
			this.propertiesByOwner.set(ownerKey, decl);
		}
		if (isGlobal) {
			this.globalsByKey.set(key, decl);
		}
		this.recordDefinitionAnnotation(decl);
		if (owner) {
			this.recordMemberValue({
				declId: decl.id,
				name: decl.name,
				owner,
			});
		}
		return decl;
	}

	private recordMemberValue(entry: MemberValueEntry): void {
		const flow = this.functionValueFlowStack[this.functionValueFlowStack.length - 1];
		if (!this.memberValues.has(entry.declId)) {
			const receiver = flow?.parameters[0];
			this.memberValues.set(
				entry.declId,
				flow?.receiverProjection
					&& receiver
					&& semanticValueSourcesEqual(entry.owner, receiver)
					? { ...entry, owner: flow.receiverProjection }
					: entry,
			);
		}
		if (!flow) {
			return;
		}
		for (let memberIndex = 0; memberIndex < flow.members.length; memberIndex += 1) {
			const member = flow.members[memberIndex];
			if (member.declId === entry.declId
				&& member.name === entry.name
				&& semanticValueSourcesEqual(member.owner, entry.owner)) {
				return;
			}
		}
		flow.members.push(entry);
	}

	private memberOwnerKey(owner: SemanticValueSource, name: string): string {
		return `${semanticValueSourceKey(owner)}\0${name}`;
	}

	private resolveMemberDeclaration(
		owner: SemanticValueSource | undefined,
		name: string,
		binding: InternalDecl | undefined,
	): InternalDecl | undefined {
		if (owner) {
			const direct = this.propertiesByOwner.get(this.memberOwnerKey(owner, name));
			if (direct) {
				return direct;
			}
		}
		if (!binding) {
			return undefined;
		}
		const sources = this.declarationValues.get(binding.id);
		if (!sources) {
			return undefined;
		}
		for (let index = sources.length - 1; index >= 0; index -= 1) {
			const declaration = this.propertiesByOwner.get(this.memberOwnerKey(sources[index], name));
			if (declaration) {
				return declaration;
			}
		}
		return undefined;
	}

	private createDecl(options: {
		syntax?: LuaIdentifierExpression;
		namePath: readonly string[];
		name: string;
		kind: SemanticSymbolKind;
		range: LuaSourceRange;
		scopeRef: Scope;
		isGlobal: boolean;
		active: boolean;
	}): InternalDecl {
		const { syntax, namePath, name, kind, range, scopeRef, isGlobal, active } = options;
		const id = createSymbolId(this.path, range, kind, namePath);
		const decl: InternalDecl = {
			id,
			file: this.path,
			name,
			namePath: namePath.slice(),
			symbolKey: joinNamePath(namePath),
			kind,
			range,
			scopeIndex: scopeRef.index,
			visibleFrom: range.end,
			isGlobal,
			scopeRef,
			active,
		};
		if (namePath.length === 1) {
			scopeRef.declarationIndices.push(this.decls.length);
		}
		this.decls.push(decl);
		this.declById.set(id, decl);
		if (syntax !== undefined) {
			this.declarationIdsBySyntax.set(syntax, id);
		}
		const flow = this.functionValueFlowStack[this.functionValueFlowStack.length - 1];
		if (flow) {
			flow.declarationIds.push(id);
		}
		return decl;
	}

	private recordDefinitionAnnotation(decl: InternalDecl): void {
		this.annotate(decl.range, decl.name.length, decl.kind, 'definition');
	}

	private recordReference(options: {
		syntax?: LuaIdentifierExpression;
		namePath: readonly string[];
		name: string;
		range: LuaSourceRange;
		target?: SymbolID;
		isWrite: boolean;
		referenceKind: 'identifier' | 'self' | 'member' | 'method';
		staticExpressionPath: string | null;
		receiverSymbolKey?: string;
		receiverValue?: SemanticValueSource;
		isCall?: boolean;
	}): Ref {
		const targetDecl = options.target ? this.declById.get(options.target) : null;
		const ref: Ref = {
			file: this.path,
			name: options.name,
			namePath: options.namePath.slice(),
			symbolKey: joinNamePath(options.namePath),
			range: options.range,
			isWrite: options.isWrite,
			isCall: !!options.isCall,
			referenceKind: options.referenceKind,
			staticExpressionPath: options.staticExpressionPath,
			receiverSymbolKey: options.receiverSymbolKey,
			receiverValue: options.receiverValue,
		};
		if (ref.isCall) {
			for (let index = this.functionValueFlowStack.length - 1; index >= 0; index -= 1) {
				const root = this.functionValueFlowStack[index].functionValue.root;
				if (root.kind === 'declaration') {
					ref.caller = root.declId;
					break;
				}
			}
		}
		if (options.target) {
			ref.target = options.target;
		}
		this.refs.push(ref);
		if (options.syntax !== undefined) {
			this.referencesBySyntax.set(options.syntax, ref);
		}
		let references = this.referencesByName.get(ref.name);
		if (!references) {
			references = [];
			this.referencesByName.set(ref.name, references);
		}
		references.push(ref);
		const kind = targetDecl ? targetDecl.kind : inferReferenceKind(ref);
		this.annotate(ref.range, ref.name.length, kind, 'usage');
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
			let targetDecl: InternalDecl = null;
			if (namePath.length === 1) {
				targetDecl = this.resolveName(name) ?? this.globalsByKey.get(name);
			} else {
				const owner = this.resolveValueSourceFromNamePath(namePath.slice(0, -1));
				targetDecl = owner
					? this.propertiesByOwner.get(this.memberOwnerKey(owner, name))
					: this.properties.get(joinNamePath(namePath));
			}
			this.recordReference({
				syntax: identifier,
				namePath,
				name,
				range: identifier.range,
				target: targetDecl?.id,
				isWrite: false,
				referenceKind: index === 0 ? 'identifier' : 'member',
				staticExpressionPath: resolveStaticLuaNamePath(namePath),
			});
		}
	}

	private recordFunctionDeclarationWriteReference(statement: LuaFunctionDeclarationStatement, decl: InternalDecl): void {
		const path = statement.name.path;
		const method = statement.name.method;
		const declarationName = method ?? path[path.length - 1];
		let targetDecl: InternalDecl = decl;
		if (!method && path.length === 1) {
			targetDecl = this.resolveName(path[0].name);
			if (!targetDecl && this.currentScope().kind === 'path') {
				targetDecl = decl;
			}
		}
		this.recordReference({
			syntax: declarationName,
			namePath: decl.namePath,
			name: decl.name,
			range: declarationName.range,
			target: targetDecl?.id,
			isWrite: true,
			referenceKind: method ? 'method' : (decl.namePath.length === 1 ? 'identifier' : 'member'),
			staticExpressionPath: resolveStaticLuaNamePath(decl.namePath),
		});
	}

	private setDeclarationValue(
		decl: InternalDecl,
		source: SemanticValueSource | undefined,
	): void {
		if (!source
			|| (source.root.kind === 'declaration'
				&& source.root.declId === decl.id
				&& source.steps.length === 0)) {
			return;
		}
		let sources = this.declarationValues.get(decl.id);
		if (!sources) {
			sources = [];
			this.declarationValues.set(decl.id, sources);
		}
		for (let index = 0; index < sources.length; index += 1) {
			if (semanticValueSourcesEqual(sources[index], source)) {
				return;
			}
		}
		sources.push(source);
	}

	private setDeclarationProjection(decl: InternalDecl, source: SemanticValueSource): void {
		this.setDeclarationValue(decl, source);
		this.projectionValueDeclarations.add(decl.id);
	}

	private recordValueFlow(
		target: SemanticValueSource,
		source: SemanticValueSource,
		relation: ValueAssignmentEntry['relation'],
	): void {
		const assignment = { target, source, relation };
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
		const root = this.resolveName(namePath[0]) ?? this.globalsByKey.get(namePath[0]);
		let source = root
			? declarationValueSource(root.id)
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

	private recordFunctionReturnValue(valueSource: SemanticValueSource | undefined): void {
		if (!valueSource || this.functionReturnValueStack.length === 0) {
			return;
		}
		const state = this.functionReturnValueStack[this.functionReturnValueStack.length - 1];
		for (let index = 0; index < state.sources.length; index += 1) {
			if (semanticValueSourcesEqual(state.sources[index], valueSource)) {
				return;
			}
		}
		state.sources.push(valueSource);
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
				&& !this.resolveStaticExpressionDeclaration(iterator.callee)) {
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
	): SemanticValueSource | undefined {
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
					this.recordValueFlow(callResult, firstArgumentValue, 'value');
				}
				const metatableValue = secondArgument?.valueSource;
				if (firstArgumentValue && metatableValue) {
					this.recordValueFlow(firstArgumentValue, metatableValue, 'metatable');
					this.recordValueFlow(
						firstArgumentValue,
						appendValueMember(metatableValue, '__index'),
						'prototype',
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
		if (!callee?.valueSource) {
			return undefined;
		}
		return callResult;
	}

	private resolveStaticExpressionDeclaration(expression: LuaExpression): InternalDecl {
		const path = expression && extractStaticMemberPath(expression);
		if (!path || path.length === 0) {
			return null;
		}
		if (path.length === 1) {
			return this.resolveName(path[0]) ?? this.globalsByKey.get(path[0]);
		}
		const owner = this.resolveValueSourceFromNamePath(path.slice(0, -1));
		return owner
			? this.propertiesByOwner.get(this.memberOwnerKey(owner, path[path.length - 1]))
			: this.properties.get(joinNamePath(path));
	}

	private createExpressionValueSource(expression: LuaExpression): OwnedSemanticValueSource {
		return this.retainOwnedValueSource(expressionValueSource(
			this.path,
			expression.range.start.line,
			expression.range.start.column,
		));
	}

	private createTableValueSource(expression: LuaExpression): OwnedSemanticValueSource {
		return this.retainOwnedValueSource(tableValueSource(
			this.path,
			expression.range.start.line,
			expression.range.start.column,
		));
	}

	private retainOwnedValueSource(source: OwnedSemanticValueSource): OwnedSemanticValueSource {
		const flow = this.functionValueFlowStack[this.functionValueFlowStack.length - 1];
		if (flow) {
			const key = source.root.key;
			if (!flow.ownedValueKeys.includes(key)) {
				flow.ownedValueKeys.push(key);
			}
		}
		return source;
	}

	private resolveExpressionValueSource(expression: LuaExpression): SemanticValueSource | undefined {
		if (expression.kind === LuaSyntaxKind.CallExpression) {
			return this.createExpressionValueSource(expression);
		}
		if (expression.kind === LuaSyntaxKind.FunctionExpression
			|| (expression.kind === LuaSyntaxKind.BinaryExpression
				&& (expression.operator === LuaBinaryOperator.And || expression.operator === LuaBinaryOperator.Or))) {
			return this.createExpressionValueSource(expression);
		}
		const path = extractStaticMemberPath(expression);
		return path ? this.resolveValueSourceFromNamePath(path) : undefined;
	}

	private setModuleAlias(decl: InternalDecl, target: ModuleAliasTarget | null): void {
		if (target) {
			this.moduleAliasesByDeclId.set(decl.id, target);
		} else {
			this.moduleAliasesByDeclId.delete(decl.id);
		}
		if (decl.scopeRef.kind !== 'path') {
			return;
		}
		if (target) {
			this.moduleAliasesByName.set(decl.name, {
				declId: decl.id,
				alias: decl.name,
				module: target.module,
				memberPath: target.memberPath,
			});
		} else {
			this.moduleAliasesByName.delete(decl.name);
		}
	}

	private annotate(range: LuaSourceRange, length: number, kind: SemanticSymbolKind, role: SemanticRole): void {
		const rowIndex = range.start.line - 1;
		if (rowIndex < 0 || rowIndex >= this.annotations.length) {
			return;
		}
		const startColumn = range.start.column - 1;
		const endColumn = startColumn + Math.max(length, 1);
		let rowAnnotations = this.annotations[rowIndex];
		if (!rowAnnotations) {
			rowAnnotations = [];
			this.annotations[rowIndex] = rowAnnotations;
		}
		rowAnnotations.push({
			start: startColumn,
			end: endColumn,
			kind,
			role,
		});
	}

	private activateDecl(decl: InternalDecl, visibleFrom: SourcePosition): void {
		if (decl.active) {
			return;
		}
		decl.visibleFrom = visibleFrom;
		this.addBinding(decl.scopeRef, decl);
		decl.active = true;
	}

	private addBinding(scope: Scope, decl: InternalDecl): void {
		let bucket = scope.bindings.get(decl.name);
		if (!bucket) {
			bucket = [];
			scope.bindings.set(decl.name, bucket);
		}
		bucket.push(decl);
	}

	private resolveName(name: string): InternalDecl {
		let scope: Scope = this.currentScope();
		while (scope) {
			const bucket = scope.bindings.get(name);
			if (bucket && bucket.length > 0) {
				return bucket[bucket.length - 1] ;
			}
			scope = scope.parent;
		}
		return null;
	}

	private currentScope(): Scope {
		return this.scopeStack[this.scopeStack.length - 1];
	}

	private enterScope(
		startInclusive: SourcePosition,
		endExclusive: SourcePosition,
		kind: ScopeKind,
	): void {
		const scope: Scope = {
			index: this.scopes.length,
			kind,
			startInclusive,
			endExclusive,
			parent: this.scopeStack.length > 0 ? this.scopeStack[this.scopeStack.length - 1] : null,
			bindings: new Map(),
			declarationIndices: [],
			implicitSelfValue: this.currentMethodSelfValue(),
		};
		this.scopes.push(scope);
		this.scopeStack.push(scope);
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

function buildRangeFromPosition(position: SourcePosition, length: number, path: string): LuaSourceRange {
	const endColumn = position.column + Math.max(length, 1) - 1;
	return {
		path,
		start: { line: position.line, column: position.column },
		end: { line: position.line, column: endColumn },
	};
}

function cloneRange(range: LuaSourceRange): LuaSourceRange {
	return {
		path: range.path,
		start: { line: range.start.line, column: range.start.column },
		end: { line: range.end.line, column: range.end.column },
	};
}

function positionAfter(position: SourcePosition): SourcePosition {
	return { line: position.line, column: position.column + 1 };
}

function createSymbolId(file: string, range: LuaSourceRange, kind: SemanticSymbolKind, namePath: readonly string[]): SymbolID {
	const key = joinNamePath(namePath);
	return `${file}|${range.start.line}|${range.start.column}|${kind}|${key}`;
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

function finalizeAnnotations(annotations: SemanticAnnotations): SemanticAnnotations {
	for (let index = 0; index < annotations.length; index += 1) {
		const row = annotations[index];
		if (!row) {
			continue;
		}
		row.sort((a, b) => a.start - b.start);
	}
	return annotations;
}

function toDecl(internal: InternalDecl): Decl {
	return {
		id: internal.id,
		file: internal.file,
		name: internal.name,
		namePath: internal.namePath.slice(),
		symbolKey: internal.symbolKey,
		kind: internal.kind,
		range: cloneRange(internal.range),
		scopeIndex: internal.scopeIndex,
		visibleFrom: {
			line: internal.visibleFrom.line,
			column: internal.visibleFrom.column,
		},
		isGlobal: internal.isGlobal,
		signature: internal.signature,
	};
}

function toSemanticScope(scope: Scope): SemanticScope {
	return {
		startInclusive: {
			line: scope.startInclusive.line,
			column: scope.startInclusive.column,
		},
		endExclusive: {
			line: scope.endExclusive.line,
			column: scope.endExclusive.column,
		},
		parentIndex: scope.parent ? scope.parent.index : -1,
		declarationIndices: scope.declarationIndices.slice(),
		implicitSelfValue: scope.implicitSelfValue,
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

function registerFunctionSignatureExplicit(
	signatures: Map<string, FunctionSignatureInfo>,
	path: string,
	params: string[],
	hasVararg: boolean,
	minimumArgumentCount: number,
	declarationStyle: 'function' | 'method',
): void {
	if (!path || path.length === 0) {
		return;
	}
	signatures.set(path, { params, hasVararg, minimumArgumentCount, declarationStyle });
}

function registerFunctionFromExpression(
	signatures: Map<string, FunctionSignatureInfo>,
	path: string,
	expression: LuaFunctionExpression,
	declarationStyle: 'function' | 'method',
): FunctionSignatureInfo {
	const params: string[] = [];
	for (let index = 0; index < expression.parameters.length; index += 1) {
		const parameter = expression.parameters[index];
		if (parameter.name.length > 0) {
			params.push(parameter.name);
		}
	}
	const minimumArgumentCount = inferMinimumArgumentCount(expression, params, signatures);
	const signature: FunctionSignatureInfo = {
		params,
		hasVararg: expression.hasVararg,
		minimumArgumentCount,
		declarationStyle,
	};
	signatures.set(path, signature);
	if (declarationStyle === 'method') {
		const dotPath = methodPathToPropertyPath(path);
		if (dotPath) {
			const extended = ['self', ...params];
			registerFunctionSignatureExplicit(signatures, dotPath, extended, expression.hasVararg, minimumArgumentCount + 1, 'function');
		}
	}
	return signature;
}

function inferMinimumArgumentCount(
	expression: LuaFunctionExpression,
	params: readonly string[],
	signatures: ReadonlyMap<string, FunctionSignatureInfo>,
): number {
	let minimumArgumentCount = params.length;
	for (let index = params.length - 1; index >= 0; index -= 1) {
		const parameterName = params[index];
		if (parameterHasUnsafeUse(expression.body.body, parameterName, signatures, false)) {
			break;
		}
		if (index < params.length - 1 && !parameterHasExplicitOptionalPattern(expression.body.body, parameterName, signatures)) {
			break;
		}
		minimumArgumentCount = index;
	}
	return minimumArgumentCount;
}

function parameterHasUnsafeUse(
	statements: readonly LuaStatement[],
	parameterName: string,
	signatures: ReadonlyMap<string, FunctionSignatureInfo>,
	guarded: boolean,
): boolean {
	let parameterGuarded = guarded;
	for (let index = 0; index < statements.length; index += 1) {
		const statement = statements[index];
		if (statement.kind === LuaSyntaxKind.IfStatement) {
			const ifStatement = statement;
			for (let clauseIndex = 0; clauseIndex < ifStatement.clauses.length; clauseIndex += 1) {
				const clause = ifStatement.clauses[clauseIndex];
				const condition = clause.condition as LuaExpression | null;
				if (condition && expressionHasUnsafeParameterUse(condition, parameterName, signatures, parameterGuarded)) {
					return true;
				}
				const clauseGuarded = parameterGuarded || (condition ? conditionGuaranteesParameterPresent(condition, parameterName) : false);
				if (parameterHasUnsafeUse(clause.block.body, parameterName, signatures, clauseGuarded)) {
					return true;
				}
			}
			if (isEarlyReturnOnMissingParameter(ifStatement, parameterName)) {
				parameterGuarded = true;
			}
			continue;
		}
		if (statement.kind === LuaSyntaxKind.WhileStatement) {
			const whileStatement = statement;
			if (expressionHasUnsafeParameterUse(whileStatement.condition, parameterName, signatures, parameterGuarded)) {
				return true;
			}
			if (parameterHasUnsafeUse(whileStatement.block.body, parameterName, signatures, parameterGuarded || conditionGuaranteesParameterPresent(whileStatement.condition, parameterName))) {
				return true;
			}
			continue;
		}
		if (statement.kind === LuaSyntaxKind.RepeatStatement) {
			const repeatStatement = statement;
			if (parameterHasUnsafeUse(repeatStatement.block.body, parameterName, signatures, parameterGuarded)) {
				return true;
			}
			if (expressionHasUnsafeParameterUse(repeatStatement.condition, parameterName, signatures, parameterGuarded)) {
				return true;
			}
			continue;
		}
		if (statement.kind === LuaSyntaxKind.DoStatement) {
			if (parameterHasUnsafeUse(statement.block.body, parameterName, signatures, parameterGuarded)) {
				return true;
			}
			continue;
		}
		if (statement.kind === LuaSyntaxKind.ForNumericStatement) {
			if (expressionHasUnsafeParameterUse(statement.start, parameterName, signatures, parameterGuarded)
				|| expressionHasUnsafeParameterUse(statement.limit, parameterName, signatures, parameterGuarded)
				|| (statement.step ? expressionHasUnsafeParameterUse(statement.step, parameterName, signatures, parameterGuarded) : false)) {
				return true;
			}
			if (parameterHasUnsafeUse(statement.block.body, parameterName, signatures, parameterGuarded)) {
				return true;
			}
			continue;
		}
		if (statement.kind === LuaSyntaxKind.ForGenericStatement) {
			for (let iteratorIndex = 0; iteratorIndex < statement.iterators.length; iteratorIndex += 1) {
				if (expressionHasUnsafeParameterUse(statement.iterators[iteratorIndex], parameterName, signatures, parameterGuarded)) {
					return true;
				}
			}
			if (parameterHasUnsafeUse(statement.block.body, parameterName, signatures, parameterGuarded)) {
				return true;
			}
			continue;
		}
		if (statement.kind === LuaSyntaxKind.LocalFunctionStatement || statement.kind === LuaSyntaxKind.FunctionDeclarationStatement) {
			continue;
		}
		if (statement.kind === LuaSyntaxKind.LocalAssignmentStatement) {
			for (let valueIndex = 0; valueIndex < statement.values.length; valueIndex += 1) {
				if (expressionHasUnsafeParameterUse(statement.values[valueIndex], parameterName, signatures, parameterGuarded)) {
					return true;
				}
			}
			continue;
		}
		if (statement.kind === LuaSyntaxKind.AssignmentStatement) {
			for (let targetIndex = 0; targetIndex < statement.left.length; targetIndex += 1) {
				if (expressionHasUnsafeParameterUse(statement.left[targetIndex], parameterName, signatures, parameterGuarded)) {
					return true;
				}
			}
			for (let valueIndex = 0; valueIndex < statement.right.length; valueIndex += 1) {
				if (expressionHasUnsafeParameterUse(statement.right[valueIndex], parameterName, signatures, parameterGuarded)) {
					return true;
				}
			}
			continue;
		}
		if (statement.kind === LuaSyntaxKind.ReturnStatement) {
			for (let expressionIndex = 0; expressionIndex < statement.expressions.length; expressionIndex += 1) {
				if (expressionHasUnsafeParameterUse(statement.expressions[expressionIndex], parameterName, signatures, parameterGuarded)) {
					return true;
				}
			}
			continue;
		}
		if (statement.kind === LuaSyntaxKind.CallStatement) {
			if (expressionHasUnsafeParameterUse(statement.expression, parameterName, signatures, parameterGuarded)) {
				return true;
			}
		}
	}
	return false;
}

function parameterHasExplicitOptionalPattern(
	statements: readonly LuaStatement[],
	parameterName: string,
	signatures: ReadonlyMap<string, FunctionSignatureInfo>,
): boolean {
	for (let index = 0; index < statements.length; index += 1) {
		const statement = statements[index];
		if (statement.kind === LuaSyntaxKind.IfStatement) {
			if (isEarlyReturnOnMissingParameter(statement, parameterName)) {
				return true;
			}
			for (let clauseIndex = 0; clauseIndex < statement.clauses.length; clauseIndex += 1) {
				const clause = statement.clauses[clauseIndex];
				const condition = clause.condition as LuaExpression | null;
				if (condition && expressionHasExplicitOptionalPattern(condition, parameterName, signatures)) {
					return true;
				}
				if (parameterHasExplicitOptionalPattern(clause.block.body, parameterName, signatures)) {
					return true;
				}
			}
			continue;
		}
		if (statement.kind === LuaSyntaxKind.WhileStatement) {
			if (expressionHasExplicitOptionalPattern(statement.condition, parameterName, signatures)
				|| parameterHasExplicitOptionalPattern(statement.block.body, parameterName, signatures)) {
				return true;
			}
			continue;
		}
		if (statement.kind === LuaSyntaxKind.RepeatStatement) {
			if (parameterHasExplicitOptionalPattern(statement.block.body, parameterName, signatures)
				|| expressionHasExplicitOptionalPattern(statement.condition, parameterName, signatures)) {
				return true;
			}
			continue;
		}
		if (statement.kind === LuaSyntaxKind.DoStatement) {
			if (parameterHasExplicitOptionalPattern(statement.block.body, parameterName, signatures)) {
				return true;
			}
			continue;
		}
		if (statement.kind === LuaSyntaxKind.ForNumericStatement) {
			if (expressionHasExplicitOptionalPattern(statement.start, parameterName, signatures)
				|| expressionHasExplicitOptionalPattern(statement.limit, parameterName, signatures)
				|| (statement.step ? expressionHasExplicitOptionalPattern(statement.step, parameterName, signatures) : false)
				|| parameterHasExplicitOptionalPattern(statement.block.body, parameterName, signatures)) {
				return true;
			}
			continue;
		}
		if (statement.kind === LuaSyntaxKind.ForGenericStatement) {
			for (let iteratorIndex = 0; iteratorIndex < statement.iterators.length; iteratorIndex += 1) {
				if (expressionHasExplicitOptionalPattern(statement.iterators[iteratorIndex], parameterName, signatures)) {
					return true;
				}
			}
			if (parameterHasExplicitOptionalPattern(statement.block.body, parameterName, signatures)) {
				return true;
			}
			continue;
		}
		if (statement.kind === LuaSyntaxKind.LocalFunctionStatement || statement.kind === LuaSyntaxKind.FunctionDeclarationStatement) {
			continue;
		}
		if (statement.kind === LuaSyntaxKind.LocalAssignmentStatement) {
			for (let valueIndex = 0; valueIndex < statement.values.length; valueIndex += 1) {
				if (expressionHasExplicitOptionalPattern(statement.values[valueIndex], parameterName, signatures)) {
					return true;
				}
			}
			continue;
		}
		if (statement.kind === LuaSyntaxKind.AssignmentStatement) {
			for (let targetIndex = 0; targetIndex < statement.left.length; targetIndex += 1) {
				if (expressionHasExplicitOptionalPattern(statement.left[targetIndex], parameterName, signatures)) {
					return true;
				}
			}
			for (let valueIndex = 0; valueIndex < statement.right.length; valueIndex += 1) {
				if (expressionHasExplicitOptionalPattern(statement.right[valueIndex], parameterName, signatures)) {
					return true;
				}
			}
			continue;
		}
		if (statement.kind === LuaSyntaxKind.ReturnStatement) {
			for (let expressionIndex = 0; expressionIndex < statement.expressions.length; expressionIndex += 1) {
				if (expressionHasExplicitOptionalPattern(statement.expressions[expressionIndex], parameterName, signatures)) {
					return true;
				}
			}
			continue;
		}
		if (statement.kind === LuaSyntaxKind.CallStatement && expressionHasExplicitOptionalPattern(statement.expression, parameterName, signatures)) {
			return true;
		}
	}
	return false;
}

function expressionPairHasUnsafeParameterUse(
	left: LuaExpression,
	right: LuaExpression,
	parameterName: string,
	signatures: ReadonlyMap<string, FunctionSignatureInfo>,
): boolean {
	return expressionHasUnsafeParameterUse(left, parameterName, signatures, false)
		|| expressionHasUnsafeParameterUse(right, parameterName, signatures, false);
}

function expressionHasUnsafeParameterUse(
	expression: LuaExpression,
	parameterName: string,
	signatures: ReadonlyMap<string, FunctionSignatureInfo>,
	guarded: boolean,
): boolean {
	if (!expressionContainsParameter(expression, parameterName)) {
		return false;
	}
	if (guarded) {
		return false;
	}
	switch (expression.kind) {
		case LuaSyntaxKind.IdentifierExpression:
			return false;
		case LuaSyntaxKind.MemberExpression:
			return expressionContainsParameter(expression.base, parameterName);
		case LuaSyntaxKind.IndexExpression:
			return expressionContainsParameter(expression.base, parameterName)
				|| expressionHasUnsafeParameterUse(expression.index, parameterName, signatures, false);
		case LuaSyntaxKind.UnaryExpression:
			if (expression.operator === LuaUnaryOperator.Not) {
				return expressionHasUnsafeParameterUse(expression.operand, parameterName, signatures, false);
			}
			return expressionContainsParameter(expression.operand, parameterName);
		case LuaSyntaxKind.BinaryExpression:
			switch (expression.operator) {
				case LuaBinaryOperator.And:
					if (conditionGuaranteesParameterPresent(expression.left, parameterName)) {
						return expressionHasUnsafeParameterUse(expression.left, parameterName, signatures, false)
							|| expressionHasUnsafeParameterUse(expression.right, parameterName, signatures, true);
					}
					return expressionPairHasUnsafeParameterUse(expression.left, expression.right, parameterName, signatures);
				case LuaBinaryOperator.Or:
					if (expressionContainsParameter(expression.left, parameterName)
						&& !expressionHasUnsafeParameterUse(expression.left, parameterName, signatures, false)) {
						return expressionHasUnsafeParameterUse(expression.right, parameterName, signatures, false);
					}
					return expressionHasUnsafeParameterUse(expression.left, parameterName, signatures, false)
						|| expressionHasUnsafeParameterUse(expression.right, parameterName, signatures, false);
				case LuaBinaryOperator.Equal:
				case LuaBinaryOperator.NotEqual:
					return expressionPairHasUnsafeParameterUse(expression.left, expression.right, parameterName, signatures);
				default:
					return expressionContainsParameter(expression.left, parameterName)
						|| expressionContainsParameter(expression.right, parameterName);
			}
		case LuaSyntaxKind.CallExpression:
			if (expressionContainsParameter(expression.callee, parameterName)) {
				return true;
			}
			for (let index = 0; index < expression.arguments.length; index += 1) {
				const argument = expression.arguments[index];
				if (isOptionalCallArgumentUse(expression, index, argument, parameterName, signatures)) {
					continue;
				}
				if (expressionHasUnsafeParameterUse(argument, parameterName, signatures, false)) {
					return true;
				}
			}
			return false;
		case LuaSyntaxKind.TableConstructorExpression:
			for (let index = 0; index < expression.fields.length; index += 1) {
				const field = expression.fields[index];
				if (field.kind === LuaTableFieldKind.Array || field.kind === LuaTableFieldKind.IdentifierKey) {
					if (expressionHasUnsafeParameterUse(field.value, parameterName, signatures, false)) {
						return true;
					}
					continue;
				}
				if (expressionHasUnsafeParameterUse(field.key, parameterName, signatures, false)
					|| expressionHasUnsafeParameterUse(field.value, parameterName, signatures, false)) {
					return true;
				}
			}
			return false;
		case LuaSyntaxKind.FunctionExpression:
			return false;
		default:
			return false;
	}
}

function expressionHasExplicitOptionalPattern(
	expression: LuaExpression,
	parameterName: string,
	signatures: ReadonlyMap<string, FunctionSignatureInfo>,
): boolean {
	if (!expressionContainsParameter(expression, parameterName)) {
		return false;
	}
	if (expression.kind === LuaSyntaxKind.BinaryExpression) {
		if (expression.operator === LuaBinaryOperator.Or
			&& expressionContainsParameter(expression.left, parameterName)
			&& !expressionHasUnsafeParameterUse(expression.left, parameterName, signatures, false)) {
			return true;
		}
		if (expressionHasExplicitOptionalPattern(expression.left, parameterName, signatures)
			|| expressionHasExplicitOptionalPattern(expression.right, parameterName, signatures)) {
			return true;
		}
		return false;
	}
	if (expression.kind === LuaSyntaxKind.UnaryExpression) {
		return expressionHasExplicitOptionalPattern(expression.operand, parameterName, signatures);
	}
	if (expression.kind === LuaSyntaxKind.CallExpression) {
		for (let index = 0; index < expression.arguments.length; index += 1) {
			if (isOptionalCallArgumentUse(expression, index, expression.arguments[index], parameterName, signatures)) {
				return true;
			}
			if (expressionHasExplicitOptionalPattern(expression.arguments[index], parameterName, signatures)) {
				return true;
			}
		}
		return expressionHasExplicitOptionalPattern(expression.callee, parameterName, signatures);
	}
	if (expression.kind === LuaSyntaxKind.MemberExpression) {
		return expressionHasExplicitOptionalPattern(expression.base, parameterName, signatures);
	}
	if (expression.kind === LuaSyntaxKind.IndexExpression) {
		return expressionHasExplicitOptionalPattern(expression.base, parameterName, signatures)
			|| expressionHasExplicitOptionalPattern(expression.index, parameterName, signatures);
	}
	if (expression.kind === LuaSyntaxKind.TableConstructorExpression) {
		for (let index = 0; index < expression.fields.length; index += 1) {
			const field = expression.fields[index];
			if (field.kind === LuaTableFieldKind.Array || field.kind === LuaTableFieldKind.IdentifierKey) {
				if (expressionHasExplicitOptionalPattern(field.value, parameterName, signatures)) {
					return true;
				}
				continue;
			}
			if (expressionHasExplicitOptionalPattern(field.key, parameterName, signatures)
				|| expressionHasExplicitOptionalPattern(field.value, parameterName, signatures)) {
				return true;
			}
		}
	}
	return false;
}

function isEarlyReturnOnMissingParameter(statement: LuaStatement, parameterName: string): boolean {
	if (statement.kind !== LuaSyntaxKind.IfStatement || statement.clauses.length !== 1) {
		return false;
	}
	const clause = statement.clauses[0];
	const condition = clause.condition as LuaExpression | null;
	return !!condition && conditionGuaranteesParameterAbsent(condition, parameterName) && blockEndsWithReturn(clause.block.body);
}

function blockEndsWithReturn(statements: readonly LuaStatement[]): boolean {
	if (statements.length === 0) {
		return false;
	}
	return statements[statements.length - 1].kind === LuaSyntaxKind.ReturnStatement;
}

function conditionGuaranteesParameterPresent(expression: LuaExpression, parameterName: string): boolean {
	if (expression.kind === LuaSyntaxKind.IdentifierExpression) {
		return expression.name === parameterName;
	}
	if (expression.kind === LuaSyntaxKind.UnaryExpression && expression.operator === LuaUnaryOperator.Not) {
		return false;
	}
	if (expression.kind === LuaSyntaxKind.BinaryExpression) {
		if (expression.operator === LuaBinaryOperator.And) {
			return conditionGuaranteesParameterPresent(expression.left, parameterName)
				|| conditionGuaranteesParameterPresent(expression.right, parameterName);
		}
		if (expression.operator === LuaBinaryOperator.NotEqual && isDirectParameterReference(expression.left, parameterName) && isNilLiteral(expression.right)) {
			return true;
		}
		if (expression.operator === LuaBinaryOperator.NotEqual && isDirectParameterReference(expression.right, parameterName) && isNilLiteral(expression.left)) {
			return true;
		}
		if (expression.operator === LuaBinaryOperator.Equal && isTypeCallOnParameter(expression.left, parameterName) && expression.right.kind === LuaSyntaxKind.StringLiteralExpression) {
			return true;
		}
		if (expression.operator === LuaBinaryOperator.Equal && isTypeCallOnParameter(expression.right, parameterName) && expression.left.kind === LuaSyntaxKind.StringLiteralExpression) {
			return true;
		}
	}
	return false;
}

function conditionGuaranteesParameterAbsent(expression: LuaExpression, parameterName: string): boolean {
	if (expression.kind === LuaSyntaxKind.UnaryExpression && expression.operator === LuaUnaryOperator.Not) {
		return isDirectParameterReference(expression.operand, parameterName);
	}
	if (expression.kind === LuaSyntaxKind.BinaryExpression) {
		if (expression.operator === LuaBinaryOperator.Equal && isDirectParameterReference(expression.left, parameterName) && isNilLiteral(expression.right)) {
			return true;
		}
		if (expression.operator === LuaBinaryOperator.Equal && isDirectParameterReference(expression.right, parameterName) && isNilLiteral(expression.left)) {
			return true;
		}
	}
	return false;
}

function isOptionalCallArgumentUse(
	callExpression: LuaCallExpression,
	argumentIndex: number,
	argument: LuaExpression,
	parameterName: string,
	signatures: ReadonlyMap<string, FunctionSignatureInfo>,
): boolean {
	if (!isDirectParameterReference(argument, parameterName)) {
		return false;
	}
	const callPath = resolveDirectCallPath(callExpression);
	if (!callPath) {
		return true;
	}
	const signature = signatures.get(callPath);
	if (!signature) {
		return true;
	}
	return argumentIndex + 1 > signature.minimumArgumentCount;
}

function resolveDirectCallPath(expression: LuaCallExpression): string {
	if (expression.method) {
		const basePath = extractNamePath(expression.callee);
		return basePath ? `${joinNamePath(basePath)}:${expression.method.name}` : null;
	}
	const calleePath = extractNamePath(expression.callee);
	return calleePath ? joinNamePath(calleePath) : null;
}

function isDirectParameterReference(expression: LuaExpression, parameterName: string): boolean {
	return expression.kind === LuaSyntaxKind.IdentifierExpression && expression.name === parameterName;
}

function isNilLiteral(expression: LuaExpression): boolean {
	return expression.kind === LuaSyntaxKind.NilLiteralExpression;
}

function isTypeCallOnParameter(expression: LuaExpression, parameterName: string): boolean {
	if (expression.kind !== LuaSyntaxKind.CallExpression || expression.method) {
		return false;
	}
	if (resolveDirectCallName(expression.callee) !== 'type' || expression.arguments.length !== 1) {
		return false;
	}
	return isDirectParameterReference(expression.arguments[0], parameterName);
}

function expressionContainsParameter(expression: LuaExpression, parameterName: string): boolean {
	switch (expression.kind) {
		case LuaSyntaxKind.IdentifierExpression:
			return expression.name === parameterName;
		case LuaSyntaxKind.MemberExpression:
			return expressionContainsParameter(expression.base, parameterName);
		case LuaSyntaxKind.IndexExpression:
			return expressionContainsParameter(expression.base, parameterName) || expressionContainsParameter(expression.index, parameterName);
		case LuaSyntaxKind.CallExpression:
			if (expressionContainsParameter(expression.callee, parameterName)) {
				return true;
			}
			for (let index = 0; index < expression.arguments.length; index += 1) {
				if (expressionContainsParameter(expression.arguments[index], parameterName)) {
					return true;
				}
			}
			return false;
		case LuaSyntaxKind.BinaryExpression:
			return expressionContainsParameter(expression.left, parameterName) || expressionContainsParameter(expression.right, parameterName);
		case LuaSyntaxKind.UnaryExpression:
			return expressionContainsParameter(expression.operand, parameterName);
		case LuaSyntaxKind.TableConstructorExpression:
			for (let index = 0; index < expression.fields.length; index += 1) {
				const field = expression.fields[index];
				if (field.kind === LuaTableFieldKind.Array || field.kind === LuaTableFieldKind.IdentifierKey) {
					if (expressionContainsParameter(field.value, parameterName)) {
						return true;
					}
					continue;
				}
				if (expressionContainsParameter(field.key, parameterName) || expressionContainsParameter(field.value, parameterName)) {
					return true;
				}
			}
			return false;
		case LuaSyntaxKind.FunctionExpression:
			return false;
		default:
			return false;
	}
}

export class LuaSemanticWorkspace {
	private readonly index = new LuaProjectIndex();
	private snapshot: LuaSemanticWorkspaceSnapshot = null;

	public get version(): number {
		return this.index.getVersion();
	}

	public updateFile(file: string, source: string, parsed?: ParsedLuaChunk): FileSemanticData {
		const previousVersion = this.index.getVersion();
		const data = this.index.updateFile(file, source, parsed);
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
