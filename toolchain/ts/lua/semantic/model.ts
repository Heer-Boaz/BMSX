import {
	LuaBinaryOperator,
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
	type LuaReturnStatement,
	type LuaStructDeclarationStatement,
	type LuaBssDeclarationStatement,
	type LuaDataDeclarationStatement,
	type LuaRodataDeclarationStatement,
	type LuaFunctionDeclarationStatement,
	type LuaDefinitionInfo,
	type LuaSourceRange,
} from '../syntax/ast';
import type { LuaToken } from '../syntax/token';
import { LuaTokenType } from '../syntax/token';
import type { LuaSymbolEntry } from '../semantic_contracts';
import type { ParsedLuaChunk } from '../analysis/parse';
import { getCachedLuaParse } from '../analysis/cache';
import { sourcePositionInRange } from './source_range';
import type { SourcePosition } from '../source_range';
import { semanticNamePathMatches, type SemanticSymbolKind } from './symbols';
import type { SemanticAnnotations, SemanticRole } from './tokens';
import { methodPathToPropertyPath } from './common';
import { toLuaModulePath } from '../module_path';
import { LUA_BUILTIN_TABLE_ITERATOR_ARGUMENTS } from '../builtin_descriptors';
import {
	resolveModuleAliasInitializer,
	type ModuleAliasEntry,
	type ModuleAliasTarget,
} from './module_aliases';
import {
	appendValueElement,
	appendValueInstance,
	appendValueMember,
	bindingValueSource,
	declarationValueSource,
	expressionValueSource,
	globalValueSource,
	moduleTableValueSource,
	moduleValueSource,
	objectBindingId,
	prefabBindingId,
	semanticValueSourceKey,
	semanticValueSourcesEqual,
	sourceBindingId,
	tableValueSource,
	type BaseValueEntry,
	type CallValueEntry,
	type DeclarationValueEntry,
	type FunctionParameterValueEntry,
	type FunctionReturnValueEntry,
	type MemberValueEntry,
	type ModuleValueEntry,
	type SemanticValueSource,
	type ValueAssignmentEntry,
} from './value_graph';
import {
	ComponentProgramSemanticCollector,
	type ComponentProgramCallbackEntry,
	type ComponentProgramKind,
	type ComponentProgramMountEntry,
	type ComponentProgramSemanticHost,
} from './component_programs';
import {
	ComponentCompositionSemanticCollector,
	type ComponentAttachmentCallEntry,
	type ComponentCompositionSemanticHost,
	type ComponentCompositionContract,
	type ComponentMountEntry,
	type ComponentPublicationEntry,
} from './component_composition';
import { WorkspaceSymbolResolver } from './workspace_symbol_resolver';

export type SymbolID = string;

export type LuaReferenceLookupResult = {
	definition: LuaDefinitionInfo;
	references: LuaSourceRange[];
};

export type FunctionSignatureInfo = {
	params: string[];
	hasVararg: boolean;
	minimumArgumentCount: number;
	declarationStyle: 'function' | 'method';
};

export type StaticStringSource =
	| { kind: 'literal'; value: string }
	| { kind: 'declaration'; declId: SymbolID }
	| { kind: 'global'; symbolKey: string }
	| { kind: 'module'; module: string; memberPath: readonly string[] };

export type DeclStringSourceEntry = {
	declId: SymbolID;
	source: StaticStringSource;
};

export type PrefabClassEntry = {
	defId: StaticStringSource;
	classDeclId: SymbolID;
};

export type ObjectBindingEntry = {
	objectId: StaticStringSource;
	prefabId: StaticStringSource;
};

export type PrefabReferenceEntry = {
	bindingId: string;
	defId: StaticStringSource;
};

export type EventEmitterParameterEntry = {
	parameterDeclId: SymbolID;
	emitterId: StaticStringSource;
};

export type LuaSemanticModel = {
	file: string;
	annotations: SemanticAnnotations;
	decls: readonly Decl[];
	refs: readonly Ref[];
	definitions: readonly LuaDefinitionInfo[];
	callExpressions?: readonly LuaCallExpression[];
	functionSignatures?: ReadonlyMap<string, FunctionSignatureInfo>;
	lookupIdentifier(row: number, column: number, namePath: readonly string[]): LuaDefinitionInfo;
	lookupReferences(row: number, column: number, namePath: readonly string[]): LuaReferenceLookupResult;
	getDefinitionReferences(definition: LuaDefinitionInfo): LuaSourceRange[];
	symbolAt(row: number, column: number): { id: SymbolID; decl: Decl };
};

export type Decl = {
	id: SymbolID;
	file: string;
	name: string;
	namePath: readonly string[];
	symbolKey: string;
	kind: SemanticSymbolKind;
	range: LuaSourceRange;
	scope: LuaSourceRange;
	isGlobal: boolean;
};

export type Ref = {
	file: string;
	name: string;
	namePath: readonly string[];
	symbolKey: string;
	range: LuaSourceRange;
	target?: SymbolID;
	lexicalTarget?: SymbolID;
	isWrite: boolean;
	referenceKind: 'identifier' | 'self' | 'member' | 'method';
	receiverSymbolKey?: string;
	receiverValue?: SemanticValueSource;
};

export type FileSemanticData = {
	model: LuaSemanticModel;
	source: string;
	lines: readonly string[];
	parsed: ParsedLuaChunk;
	chunk: LuaChunk;
	annotations: SemanticAnnotations;
	decls: readonly Decl[];
	refs: readonly Ref[];
	moduleAliases: readonly ModuleAliasEntry[];
	callExpressions: readonly LuaCallExpression[];
	functionSignatures: ReadonlyMap<string, FunctionSignatureInfo>;
	declarationValues: readonly DeclarationValueEntry[];
	moduleValues: readonly ModuleValueEntry[];
	memberValues: readonly MemberValueEntry[];
	functionReturnValues: readonly FunctionReturnValueEntry[];
	functionParameterValues: readonly FunctionParameterValueEntry[];
	callValues: readonly CallValueEntry[];
	valueAssignments: readonly ValueAssignmentEntry[];
	baseValues: readonly BaseValueEntry[];
	declStringSources: readonly DeclStringSourceEntry[];
	prefabClasses: readonly PrefabClassEntry[];
	objectBindings: readonly ObjectBindingEntry[];
	prefabReferences: readonly PrefabReferenceEntry[];
	eventEmitterParameters: readonly EventEmitterParameterEntry[];
	componentProgramMounts: readonly ComponentProgramMountEntry[];
	componentProgramCallbacks: readonly ComponentProgramCallbackEntry[];
	componentPublications: readonly ComponentPublicationEntry[];
	componentMounts: readonly ComponentMountEntry[];
	componentAttachmentCalls: readonly ComponentAttachmentCallEntry[];
};

const EMPTY_CALL_EXPRESSIONS: readonly LuaCallExpression[] = [];
const EMPTY_FUNCTION_SIGNATURES = new Map<string, FunctionSignatureInfo>();

export type LuaSemanticWorkspaceSourceSnapshot = {
	path: string;
	source: string;
	lines: readonly string[];
	parsed: ParsedLuaChunk;
	chunk: LuaChunk;
	analysis: FileSemanticData;
};

export type LuaSemanticWorkspaceSnapshotInput = {
	path: string;
	source: string;
	version?: number;
	lines?: readonly string[];
	parsed?: ParsedLuaChunk;
	chunk?: LuaChunk;
	analysis?: FileSemanticData;
};

export class LuaSemanticWorkspaceSnapshot {
	public readonly version: number;
	public readonly files: readonly string[];
	public readonly sources: readonly LuaSemanticWorkspaceSourceSnapshot[];
	public readonly symbolResolver: WorkspaceSymbolResolver;
	private readonly dataByPath: ReadonlyMap<string, FileSemanticData>;
	private readonly globalDecls: readonly Decl[];

	constructor(
		version: number,
		files: readonly string[],
		sources: readonly LuaSemanticWorkspaceSourceSnapshot[],
		symbolResolver: WorkspaceSymbolResolver,
	) {
		this.version = version;
		this.files = files;
		this.sources = sources;
		this.symbolResolver = symbolResolver;
		const dataByPath = new Map<string, FileSemanticData>();
		const globalDecls: Decl[] = [];
		for (let index = 0; index < sources.length; index += 1) {
			const source = sources[index];
			dataByPath.set(source.path, source.analysis);
			for (let declIndex = 0; declIndex < source.analysis.decls.length; declIndex += 1) {
				const decl = source.analysis.decls[declIndex];
				if (decl.isGlobal) {
					globalDecls.push(decl);
				}
			}
		}
		this.dataByPath = dataByPath;
		this.globalDecls = globalDecls;
	}

	public getFileData(path: string): FileSemanticData {
		return this.dataByPath.get(path);
	}

	public listGlobalDecls(): readonly Decl[] {
		return this.globalDecls;
	}

	public symbolAt(path: string, row: number, column: number): { id: SymbolID; decl: Decl } {
		const symbols = this.symbolsAt(path, row, column);
		return symbols.length === 1 ? symbols[0] : null;
	}

	public symbolsAt(path: string, row: number, column: number): readonly { id: SymbolID; decl: Decl }[] {
		const data = this.dataByPath.get(path);
		if (!data) {
			return [];
		}
		for (let declIndex = 0; declIndex < data.decls.length; declIndex += 1) {
			const decl = data.decls[declIndex];
			if (!sourcePositionInRange(row, column, decl.range)) {
				continue;
			}
			return [{ id: decl.id, decl }];
		}
		for (let refIndex = 0; refIndex < data.refs.length; refIndex += 1) {
			const ref = data.refs[refIndex];
			if (!sourcePositionInRange(row, column, ref.range)) {
				continue;
			}
			const targets = this.symbolResolver.resolveReferenceTargets(ref);
			const symbols: { id: SymbolID; decl: Decl }[] = [];
			for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
				const target = targets[targetIndex];
				const decl = this.symbolResolver.getDeclaration(target);
				if (decl) {
					symbols.push({ id: target, decl });
				}
			}
			return symbols;
		}
		return [];
	}
}

function createWorkspaceSnapshotFromIndex(index: LuaProjectIndex): LuaSemanticWorkspaceSnapshot {
	const files = index.listFiles();
	const sources = new Array<LuaSemanticWorkspaceSourceSnapshot>(files.length);
	for (let indexInFiles = 0; indexInFiles < files.length; indexInFiles += 1) {
		const path = files[indexInFiles];
		const data = index.getFileData(path);
		if (!data) {
			throw new Error(`[LuaSemanticWorkspace] Missing file data for '${path}'.`);
		}
		sources[indexInFiles] = {
			path,
			source: data.source,
			lines: data.lines,
			parsed: data.parsed,
			chunk: data.chunk,
			analysis: data,
		};
	}
	return new LuaSemanticWorkspaceSnapshot(index.getVersion(), files, sources, index.getSymbolResolver());
}

export function buildLuaSemanticWorkspaceSnapshot(sources: ReadonlyArray<LuaSemanticWorkspaceSnapshotInput>): LuaSemanticWorkspaceSnapshot {
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
			lines: source.lines,
			version: source.version,
			parsed: source.parsed,
			withSyntaxError: true,
		});
		if (parseEntry.syntaxError) {
			throw new Error(`[LuaSemanticWorkspace] Syntax error in ${source.path}: ${parseEntry.syntaxError.message}`);
		}
		analyses[index] = buildLuaFileSemanticData(
			parseEntry.source,
			source.path,
			parseEntry.lines,
			parseEntry.parsed,
			source.version,
		);
	}
	workspace.updateFiles(analyses);
	return workspace.getSnapshot();
}

type ScopeKind = 'path' | 'function' | 'block' | 'loop';

type Scope = {
	id: number;
	kind: ScopeKind;
	range: LuaSourceRange;
	parent: Scope;
	bindings: Map<string, InternalDecl[]>;
};

type InternalDecl = Decl & {
	scopeRef: Scope;
	active: boolean;
	constantInitializer?: LuaExpression;
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

type AssignmentTargetInfo = {
	decl: InternalDecl;
	namePath: readonly string[];
	path: string | null;
	valueTarget?: SemanticValueSource;
	moduleAlias?: ModuleAliasTarget;
	memberBaseDecl?: InternalDecl;
	memberOwner?: SemanticValueSource;
};

const CARTLIB_CALL_NONE = 0;
const CARTLIB_CALL_PREFAB_DEFINE = 1;
const CARTLIB_CALL_WORLD_SPAWN = 2;
const CARTLIB_CALL_STATE_MACHINE_REGISTER = 3;
const CARTLIB_CALL_STATE_MACHINE_FACTORY = 4;
const CARTLIB_CALL_BEHAVIOUR_TREE_REGISTER = 5;
const CARTLIB_CALL_BEHAVIOUR_TREE_FACTORY = 6;
const CARTLIB_STATE_MACHINE_COMPONENT_MODULE = 'cartlib/fsm/fsm_component';
const CARTLIB_STATE_MACHINE_LIBRARY_MODULE = 'cartlib/fsm/library';
const CARTLIB_BEHAVIOUR_TREE_COMPONENT_MODULE = 'cartlib/behaviour_tree/bt_component';
const CARTLIB_BEHAVIOUR_TREE_LIBRARY_MODULE = 'cartlib/behaviour_tree/library';
const CARTLIB_PREFAB_MODULE = 'cartlib/world/prefab';
const CARTLIB_WORLD_MODULE = 'cartlib/world/world';
const CARTLIB_WORLD_OBJECT_MODULE = 'cartlib/world/world_object';
const CARTLIB_COMPONENT_COMPOSITION_CONTRACT: ComponentCompositionContract = {
	attachmentOwner: moduleValueSource(CARTLIB_WORLD_OBJECT_MODULE),
	attachmentMethodName: 'add_component',
	lifecycleMethodName: 'on_attach',
};

type CartlibCallKind =
	| typeof CARTLIB_CALL_NONE
	| typeof CARTLIB_CALL_PREFAB_DEFINE
	| typeof CARTLIB_CALL_WORLD_SPAWN
	| typeof CARTLIB_CALL_STATE_MACHINE_REGISTER
	| typeof CARTLIB_CALL_STATE_MACHINE_FACTORY
	| typeof CARTLIB_CALL_BEHAVIOUR_TREE_REGISTER
	| typeof CARTLIB_CALL_BEHAVIOUR_TREE_FACTORY;

type SemanticBuildResult = {
	decls: InternalDecl[];
	refs: Ref[];
	annotations: SemanticAnnotations;
	callExpressions: LuaCallExpression[];
	functionSignatures: Map<string, FunctionSignatureInfo>;
	declarationValues: DeclarationValueEntry[];
	moduleValues: ModuleValueEntry[];
	memberValues: MemberValueEntry[];
	functionReturnValues: FunctionReturnValueEntry[];
	functionParameterValues: FunctionParameterValueEntry[];
	callValues: CallValueEntry[];
	valueAssignments: ValueAssignmentEntry[];
	baseValues: BaseValueEntry[];
	declStringSources: DeclStringSourceEntry[];
	prefabClasses: PrefabClassEntry[];
	objectBindings: ObjectBindingEntry[];
	prefabReferences: PrefabReferenceEntry[];
	eventEmitterParameters: EventEmitterParameterEntry[];
	componentProgramMounts: ComponentProgramMountEntry[];
	componentProgramCallbacks: ComponentProgramCallbackEntry[];
	componentPublications: ComponentPublicationEntry[];
	componentMounts: ComponentMountEntry[];
	componentAttachmentCalls: ComponentAttachmentCallEntry[];
	moduleAliases: ModuleAliasEntry[];
};

type TokenInfo = {
	token: LuaToken;
	index: number;
};

export function buildLuaFileSemanticData(
	source: string,
	path: string,
	lines?: readonly string[],
	parsed?: ParsedLuaChunk,
	version?: number,
): FileSemanticData {
	const parseEntry = getCachedLuaParse({
		path,
		source,
		lines,
		version,
		parsed,
	});
	const fileLines = parseEntry.lines;
	const chunk = parseEntry.parsed.chunk;
	const tokens = parseEntry.parsed.tokens;
	const builder = new SemanticBuilder({
		path,
		chunk,
		tokens,
		lines: fileLines,
	});
	const result = builder.build();
	const decls = result.decls.map(toDecl);
	const definitions = decls.map(decl => declToDefinitionInfo(decl));
	definitions.sort(compareDefinitionInfo);
	const refs = result.refs.slice();
	const annotations = finalizeAnnotations(result.annotations);
	const model: LuaSemanticModel = createSemanticModel({
		file: path,
		decls,
		definitions,
		refs,
		annotations,
		callExpressions: result.callExpressions,
		functionSignatures: result.functionSignatures,
	});
	return {
		model,
		source,
		lines: fileLines,
		parsed: parseEntry.parsed,
		chunk,
		annotations,
		decls,
		refs,
		moduleAliases: result.moduleAliases,
		callExpressions: result.callExpressions,
		functionSignatures: result.functionSignatures,
		declarationValues: result.declarationValues,
		moduleValues: result.moduleValues,
		memberValues: result.memberValues,
		functionReturnValues: result.functionReturnValues,
		functionParameterValues: result.functionParameterValues,
		callValues: result.callValues,
		valueAssignments: result.valueAssignments,
		baseValues: result.baseValues,
		declStringSources: result.declStringSources,
		prefabClasses: result.prefabClasses,
		objectBindings: result.objectBindings,
		prefabReferences: result.prefabReferences,
		eventEmitterParameters: result.eventEmitterParameters,
		componentProgramMounts: result.componentProgramMounts,
		componentProgramCallbacks: result.componentProgramCallbacks,
		componentPublications: result.componentPublications,
		componentMounts: result.componentMounts,
		componentAttachmentCalls: result.componentAttachmentCalls,
	};
}

export function buildLuaSemanticModel(source: string, path: string, lines?: readonly string[], parsed?: ParsedLuaChunk): LuaSemanticModel {
	const data = buildLuaFileSemanticData(source, path, lines, parsed);
	return data.model;
}

class LuaProjectIndex {
	private readonly files: Map<string, FileSemanticData> = new Map();
	private readonly symbols: Map<SymbolID, Decl> = new Map();
	private readonly directDeclByFileAndKey: Map<string, SymbolID> = new Map();
	private readonly memberDeclByFileAndKey: Map<string, SymbolID> = new Map();
	private readonly globalsByKey: Map<string, SymbolID> = new Map();
	private readonly stringSourcesByDeclId: Map<SymbolID, StaticStringSource> = new Map();
	private readonly moduleAliasTargetsByDeclId: Map<SymbolID, ModuleAliasTarget> = new Map();
	private readonly globalsSources: Map<string, Map<SymbolID, number>> = new Map();
	private readonly fileOrder: Map<string, number> = new Map();
	private symbolResolver: WorkspaceSymbolResolver;
	private version = 0;
	private nextFileOrder = 1;

	constructor() {
		this.symbolResolver = this.buildWorkspaceSymbolResolver();
	}

	public updateFile(file: string, source: string, lines?: readonly string[], parsed?: ParsedLuaChunk, version?: number): void {
		const data = buildLuaFileSemanticData(source, file, lines, parsed, version);
		this.storeFileData(file, data);
	}

	public updateFiles(files: readonly FileSemanticData[]): void {
		let changed = false;
		for (let index = 0; index < files.length; index += 1) {
			const data = files[index];
			const file = data.model.file;
			changed = this.replaceIndexedFile(file, data) || changed;
		}
		if (changed) {
			this.commitFileChanges();
		}
	}

	public getVersion(): number {
		return this.version;
	}

	public getFileData(file: string): FileSemanticData {
		return this.files.get(file);
	}

	public getSymbolResolver(): WorkspaceSymbolResolver {
		return this.symbolResolver;
	}

	public listGlobalDecls(): Decl[] {
		const decls: Decl[] = [];
		for (const data of this.files.values()) {
			const fileDecls = data.decls;
			for (let index = 0; index < fileDecls.length; index += 1) {
				const decl = fileDecls[index];
				if (decl.isGlobal) {
					decls.push(decl);
				}
			}
		}
		decls.sort((a, b) => {
			const orderA = this.fileOrder.get(a.file)!;
			const orderB = this.fileOrder.get(b.file)!;
			if (orderA !== orderB) {
				return orderA - orderB;
			}
			const startA = a.range.start;
			const startB = b.range.start;
			if (startA.line !== startB.line) {
				return startA.line - startB.line;
			}
			if (startA.column !== startB.column) {
				return startA.column - startB.column;
			}
			return a.symbolKey.localeCompare(b.symbolKey);
		});
		return decls;
	}

	public listFiles(): string[] {
		return Array.from(this.files.keys());
	}

	private applyFileData(data: FileSemanticData): void {
		for (let i = 0; i < data.declStringSources.length; i += 1) {
			const entry = data.declStringSources[i];
			this.stringSourcesByDeclId.set(entry.declId, entry.source);
		}
		for (let i = 0; i < data.moduleAliases.length; i += 1) {
			const entry = data.moduleAliases[i];
			this.moduleAliasTargetsByDeclId.set(entry.declId, entry);
		}
		for (let i = 0; i < data.decls.length; i += 1) {
			const decl = data.decls[i];
			this.symbols.set(decl.id, decl);
			if (decl.kind === 'property' || decl.namePath.length > 1) {
				this.memberDeclByFileAndKey.set(fileSymbolKey(decl.file, decl.symbolKey), decl.id);
			} else {
				this.directDeclByFileAndKey.set(fileSymbolKey(decl.file, decl.symbolKey), decl.id);
			}
		}
		for (let i = 0; i < data.decls.length; i += 1) {
			const decl = data.decls[i];
			if (decl.isGlobal) {
				this.addGlobalDecl(decl);
			}
		}
	}

	private removeFileData(data: FileSemanticData): void {
		for (let i = 0; i < data.declStringSources.length; i += 1) {
			this.stringSourcesByDeclId.delete(data.declStringSources[i].declId);
		}
		for (let i = 0; i < data.moduleAliases.length; i += 1) {
			this.moduleAliasTargetsByDeclId.delete(data.moduleAliases[i].declId);
		}
		for (let i = 0; i < data.decls.length; i += 1) {
			const decl = data.decls[i];
			this.symbols.delete(decl.id);
			if (decl.kind === 'property' || decl.namePath.length > 1) {
				this.memberDeclByFileAndKey.delete(fileSymbolKey(decl.file, decl.symbolKey));
			} else {
				this.directDeclByFileAndKey.delete(fileSymbolKey(decl.file, decl.symbolKey));
			}
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

	private buildWorkspaceSymbolResolver(): WorkspaceSymbolResolver {
		const orderedFiles = this.listFiles();
		orderedFiles.sort((left, right) => this.fileOrder.get(left)! - this.fileOrder.get(right)!);
		const moduleFiles = buildModuleFileMap(orderedFiles);
		const declarationValues = new Map<SymbolID, SemanticValueSource[]>();
		const identityDeclarations = new Set<SymbolID>();
		const projectionDeclarations = new Set<SymbolID>();
		const moduleValues = new Map<string, SemanticValueSource>();
		const memberValues: MemberValueEntry[] = [];
		const functionReturns: FunctionReturnValueEntry[] = [];
		const functionParameters: FunctionParameterValueEntry[] = [];
		const calls: CallValueEntry[] = [];
		const valueAssignments: ValueAssignmentEntry[] = [];
		const baseValues: BaseValueEntry[] = [];
		const eventEmitterParameters: EventEmitterParameterEntry[] = [];
		const componentProgramMounts: ComponentProgramMountEntry[] = [];
		const componentProgramCallbacks: ComponentProgramCallbackEntry[] = [];
		const componentPublications: ComponentPublicationEntry[] = [];
		const componentMounts: ComponentMountEntry[] = [];
		const componentAttachmentCalls: ComponentAttachmentCallEntry[] = [];
		const orderedData = new Array<FileSemanticData>(orderedFiles.length);
		for (let fileIndex = 0; fileIndex < orderedFiles.length; fileIndex += 1) {
			const data = this.files.get(orderedFiles[fileIndex])!;
			orderedData[fileIndex] = data;
			for (let index = 0; index < data.declarationValues.length; index += 1) {
				const entry = data.declarationValues[index];
				if (entry.relation === 'identity') {
					identityDeclarations.add(entry.declId);
				} else if (entry.relation === 'projection') {
					projectionDeclarations.add(entry.declId);
				}
				let sources = declarationValues.get(entry.declId);
				if (!sources) {
					sources = [];
					declarationValues.set(entry.declId, sources);
				}
				sources.push(entry.source);
			}
			for (let index = 0; index < data.moduleValues.length; index += 1) {
				const entry = data.moduleValues[index];
				moduleValues.set(entry.module, entry.source);
			}
			for (let index = 0; index < data.memberValues.length; index += 1) {
				memberValues.push(data.memberValues[index]);
			}
			for (let index = 0; index < data.functionReturnValues.length; index += 1) {
				functionReturns.push(data.functionReturnValues[index]);
			}
			for (let index = 0; index < data.functionParameterValues.length; index += 1) {
				functionParameters.push(data.functionParameterValues[index]);
			}
			for (let index = 0; index < data.callValues.length; index += 1) {
				calls.push(data.callValues[index]);
			}
			for (let index = 0; index < data.valueAssignments.length; index += 1) {
				valueAssignments.push(data.valueAssignments[index]);
			}
			for (let index = 0; index < data.baseValues.length; index += 1) {
				baseValues.push(data.baseValues[index]);
			}
			for (let index = 0; index < data.eventEmitterParameters.length; index += 1) {
				eventEmitterParameters.push(data.eventEmitterParameters[index]);
			}
			for (let index = 0; index < data.componentProgramMounts.length; index += 1) {
				componentProgramMounts.push(data.componentProgramMounts[index]);
			}
			for (let index = 0; index < data.componentProgramCallbacks.length; index += 1) {
				componentProgramCallbacks.push(data.componentProgramCallbacks[index]);
			}
			for (let index = 0; index < data.componentPublications.length; index += 1) {
				componentPublications.push(data.componentPublications[index]);
			}
			for (let index = 0; index < data.componentMounts.length; index += 1) {
				componentMounts.push(data.componentMounts[index]);
			}
			for (let index = 0; index < data.componentAttachmentCalls.length; index += 1) {
				componentAttachmentCalls.push(data.componentAttachmentCalls[index]);
			}
		}
		const stringValues = new WorkspaceStringValueResolver({
			files: this.files,
			globalsByKey: this.globalsByKey,
			moduleFiles,
			directDeclByFileAndKey: this.directDeclByFileAndKey,
			memberDeclByFileAndKey: this.memberDeclByFileAndKey,
			stringSourcesByDeclId: this.stringSourcesByDeclId,
			moduleAliasTargetsByDeclId: this.moduleAliasTargetsByDeclId,
		});
		const prefabClasses = new Map<string, SymbolID>();
		for (let fileIndex = 0; fileIndex < orderedFiles.length; fileIndex += 1) {
			const entries = orderedData[fileIndex].prefabClasses;
			for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
				const entry = entries[entryIndex];
				const definitionId = stringValues.resolve(entry.defId);
				if (definitionId !== undefined && !prefabClasses.has(definitionId)) {
					prefabClasses.set(definitionId, entry.classDeclId);
				}
			}
		}
		const bindingValues = new Map<string, SemanticValueSource>();
		for (const [definitionId, classDeclId] of prefabClasses) {
			bindingValues.set(
				prefabBindingId(definitionId),
				appendValueInstance(declarationValueSource(classDeclId)),
			);
		}
		for (let fileIndex = 0; fileIndex < orderedFiles.length; fileIndex += 1) {
			const data = orderedData[fileIndex];
			for (let entryIndex = 0; entryIndex < data.objectBindings.length; entryIndex += 1) {
				const entry = data.objectBindings[entryIndex];
				const objectId = stringValues.resolve(entry.objectId);
				const definitionId = stringValues.resolve(entry.prefabId);
				if (objectId !== undefined && definitionId !== undefined) {
					const classDeclId = prefabClasses.get(definitionId);
					if (!classDeclId) {
						continue;
					}
					bindingValues.set(
						objectBindingId(objectId),
						appendValueInstance(declarationValueSource(classDeclId)),
					);
				}
			}
			for (let entryIndex = 0; entryIndex < data.prefabReferences.length; entryIndex += 1) {
				const entry = data.prefabReferences[entryIndex];
				const definitionId = stringValues.resolve(entry.defId);
				if (definitionId === undefined) {
					continue;
				}
				const classDeclId = prefabClasses.get(definitionId);
				if (classDeclId) {
					bindingValues.set(
						entry.bindingId,
						appendValueInstance(declarationValueSource(classDeclId)),
					);
				}
			}
		}
		for (let index = 0; index < eventEmitterParameters.length; index += 1) {
			const entry = eventEmitterParameters[index];
			const emitterId = stringValues.resolve(entry.emitterId);
			if (emitterId === undefined || !bindingValues.has(objectBindingId(emitterId))) {
				continue;
			}
			let sources = declarationValues.get(entry.parameterDeclId);
			if (!sources) {
				sources = [];
				declarationValues.set(entry.parameterDeclId, sources);
			}
			sources.push(bindingValueSource(objectBindingId(emitterId)));
		}
		const classesByComponentProgram = new Map<string, SymbolID[]>();
		for (let index = 0; index < componentProgramMounts.length; index += 1) {
			const entry = componentProgramMounts[index];
			const programId = stringValues.resolve(entry.programId);
			if (programId === undefined) {
				continue;
			}
			const programKey = `${entry.programKind}\0${programId}`;
			let classes = classesByComponentProgram.get(programKey);
			if (!classes) {
				classes = [];
				classesByComponentProgram.set(programKey, classes);
			}
			if (!classes.includes(entry.classDeclId)) {
				classes.push(entry.classDeclId);
			}
		}
		for (let index = 0; index < componentProgramCallbacks.length; index += 1) {
			const entry = componentProgramCallbacks[index];
			const programId = stringValues.resolve(entry.programId);
			if (programId === undefined) {
				continue;
			}
			const classes = classesByComponentProgram.get(`${entry.programKind}\0${programId}`);
			if (!classes) {
				continue;
			}
			for (let classIndex = 0; classIndex < classes.length; classIndex += 1) {
				let receiver = appendValueInstance(declarationValueSource(classes[classIndex]));
				const receiverPath = entry.receiverPath;
				if (receiverPath) {
					for (let pathIndex = 0; pathIndex < receiverPath.length; pathIndex += 1) {
						receiver = appendValueMember(receiver, receiverPath[pathIndex]);
					}
				}
				calls.push({
					callee: entry.callee,
					arguments: [receiver],
				});
			}
		}
		const globals = new Map(this.globalsByKey);
		const valueGraphInput = {
			declarationValues,
			identityDeclarations,
			projectionDeclarations,
			moduleValues,
			memberValues,
			functionReturns,
			functionParameters,
			calls,
			valueAssignments,
			baseValues,
			componentPublications,
			componentMounts,
			componentAttachmentCalls,
			componentCompositionContract: CARTLIB_COMPONENT_COMPOSITION_CONTRACT,
			bindingValues,
			globalValues: globals,
		};
		return new WorkspaceSymbolResolver({
			files: orderedData,
			declarations: new Map(this.symbols),
			globals,
			valueGraphInput,
		});
	}

	private storeFileData(file: string, data: FileSemanticData): void {
		if (!this.replaceIndexedFile(file, data)) {
			return;
		}
		this.commitFileChanges();
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
		this.symbolResolver = this.buildWorkspaceSymbolResolver();
		this.version += 1;
	}
}

function createSemanticModel(options: {
	file: string;
	decls: readonly Decl[];
	definitions: readonly LuaDefinitionInfo[];
	refs: readonly Ref[];
	annotations: SemanticAnnotations;
	callExpressions?: readonly LuaCallExpression[];
	functionSignatures?: ReadonlyMap<string, FunctionSignatureInfo>;
}): LuaSemanticModel {
	const {
		file,
		decls,
		definitions,
		refs,
		annotations,
		callExpressions,
		functionSignatures,
	} = options;
	const declById = new Map<SymbolID, Decl>();
	const definitionById = new Map<SymbolID, LuaDefinitionInfo>();
	const definitionIdByKey = new Map<string, SymbolID>();
	for (let index = 0; index < decls.length; index += 1) {
		const decl = decls[index];
		declById.set(decl.id, decl);
		const definition = definitions[index];
		definitionById.set(decl.id, definition);
		const key = definitionLookupKey(definition.definition, definition.namePath);
		if (!definitionIdByKey.has(key)) {
			definitionIdByKey.set(key, decl.id);
		}
	}
	const lookupDefinition = (row: number, column: number, namePath: readonly string[]): LuaDefinitionInfo => {
		const symbol = symbolAtPosition({
			row,
			column,
			namePath,
			decls,
			refs,
			declById,
		});
		if (!symbol) {
			return null;
		}
		const info = definitionById.get(symbol.id);
		return info ;
	};
	const getReferencesForDefinition = (definition: LuaDefinitionInfo): LuaSourceRange[] => {
		const key = definitionLookupKey(definition.definition, definition.namePath);
		const symbolId = definitionIdByKey.get(key);
		if (!symbolId) {
			return [];
		}
		const ranges: LuaSourceRange[] = [];
		for (let index = 0; index < refs.length; index += 1) {
			const ref = refs[index];
			if (ref.target === symbolId) {
				ranges.push(cloneRange(ref.range));
			}
		}
		return ranges;
	};
	return {
		file,
		annotations,
		decls,
		refs,
		definitions,
		callExpressions: callExpressions ?? EMPTY_CALL_EXPRESSIONS,
		functionSignatures: functionSignatures ?? EMPTY_FUNCTION_SIGNATURES,
		lookupIdentifier(row: number, column: number, namePath: readonly string[]): LuaDefinitionInfo {
			return lookupDefinition(row, column, namePath);
		},
		lookupReferences(row: number, column: number, namePath: readonly string[]): LuaReferenceLookupResult {
			const definition = lookupDefinition(row, column, namePath);
			if (!definition) {
				return { definition: null, references: [] };
			}
			return {
				definition,
				references: getReferencesForDefinition(definition),
			};
		},
		getDefinitionReferences(definition: LuaDefinitionInfo): LuaSourceRange[] {
			return getReferencesForDefinition(definition);
		},
		symbolAt(row: number, column: number): { id: SymbolID; decl: Decl } {
			const result = symbolAtPosition({
				row,
				column,
				namePath: null,
				decls,
				refs,
				declById,
			});
			return result;
		},
	};
}

function symbolAtPosition(options: {
	row: number;
	column: number;
	namePath: readonly string[];
	decls: readonly Decl[];
	refs: readonly Ref[];
	declById: Map<SymbolID, Decl>;
}): { id: SymbolID; decl: Decl } {
	const { row, column, namePath, decls, refs, declById } = options;
	for (let index = 0; index < decls.length; index += 1) {
		const decl = decls[index];
		if (sourcePositionInRange(row, column, decl.range)) {
			if (namePath && !semanticNamePathMatches(decl.namePath, namePath)) {
				continue;
			}
			return { id: decl.id, decl };
		}
	}
	for (let index = 0; index < refs.length; index += 1) {
		const ref = refs[index];
		if (!sourcePositionInRange(row, column, ref.range)) {
			continue;
		}
		if (namePath && !semanticNamePathMatches(ref.namePath, namePath)) {
			continue;
		}
		const targetId = ref.target;
		if (!targetId) {
			continue;
		}
		const decl = declById.get(targetId);
		if (!decl) {
			continue;
		}
		return { id: targetId, decl };
	}
	return null;
}

class SemanticBuilder implements ComponentProgramSemanticHost, ComponentCompositionSemanticHost {
	private readonly chunk: LuaChunk;
	private readonly path: string;
	private readonly tokens: readonly LuaToken[];
	private readonly annotations: SemanticAnnotations;
	private readonly tokenMap: Map<string, TokenInfo>;
	private readonly scopeStack: Scope[] = [];
	private readonly properties: Map<string, InternalDecl> = new Map();
	private readonly propertiesByOwner: Map<string, InternalDecl> = new Map();
	private readonly globalsByKey: Map<string, InternalDecl> = new Map();
	private readonly decls: InternalDecl[] = [];
	private readonly declById: Map<SymbolID, InternalDecl> = new Map();
	private readonly refs: Ref[] = [];
	private readonly callExpressions: LuaCallExpression[] = [];
	private readonly functionSignatures: Map<string, FunctionSignatureInfo> = new Map();
	private readonly methodSelfPathStack: (readonly string[] | undefined)[] = [];
	private readonly methodSelfScopeStack: (Scope | undefined)[] = [];
	private readonly declarationValues: Map<SymbolID, SemanticValueSource[]> = new Map();
	private readonly projectionValueDeclarations: Set<SymbolID> = new Set();
	private readonly projectionSourcesByDeclId: Map<SymbolID, SemanticValueSource[]> = new Map();
	private readonly memberValues: Map<SymbolID, MemberValueEntry> = new Map();
	private readonly functionReturnValues: Map<string, FunctionReturnValueEntry[]> = new Map();
	private readonly functionParameterValues: Map<string, FunctionParameterValueEntry> = new Map();
	private readonly callValues: CallValueEntry[] = [];
	private readonly valueAssignments: ValueAssignmentEntry[] = [];
	private moduleValue?: SemanticValueSource;
	private readonly declStringSources: Map<SymbolID, StaticStringSource> = new Map();
	private readonly prefabClasses: PrefabClassEntry[] = [];
	private readonly objectBindings: ObjectBindingEntry[] = [];
	private readonly prefabReferences: PrefabReferenceEntry[] = [];
	private readonly eventEmitterParameters: EventEmitterParameterEntry[] = [];
	private readonly componentPrograms: ComponentProgramSemanticCollector;
	private readonly componentComposition: ComponentCompositionSemanticCollector;
	private readonly baseValuesByClassDeclId: Map<SymbolID, BaseValueEntry> = new Map();
	private readonly instanceBaseValues: BaseValueEntry[] = [];
	private readonly moduleAliasesByDeclId: Map<SymbolID, ModuleAliasTarget> = new Map();
	private readonly immutableModuleAliasesByDeclId: Map<SymbolID, ModuleAliasTarget> = new Map();
	private readonly moduleAliasesByName: Map<string, ModuleAliasEntry> = new Map();
	private readonly functionReturnValueStack: FunctionReturnValueState[] = [];
	private readonly metatableIndexValues: Map<string, SemanticValueSource> = new Map();
	private readonly moduleAliasLookup = (name: string): ModuleAliasTarget => this.moduleAliasForName(name);
	private readonly immutableModuleAliasLookup = (name: string): ModuleAliasTarget => this.immutableModuleAliasForName(name);
	private nextScopeId = 1;

	constructor(options: {
		chunk: LuaChunk;
		path: string;
		tokens: readonly LuaToken[];
		lines: readonly string[];
	}) {
		this.chunk = options.chunk;
		this.path = options.path;
		this.tokens = options.tokens;
		this.annotations = new Array(options.lines.length);
		this.tokenMap = buildTokenMap(options.tokens);
		this.componentPrograms = new ComponentProgramSemanticCollector(this);
		this.componentComposition = new ComponentCompositionSemanticCollector(
			this,
			CARTLIB_COMPONENT_COMPOSITION_CONTRACT.attachmentMethodName,
		);
	}

	public get file(): string {
		return this.path;
	}

	public build(): SemanticBuildResult {
		this.enterScope(this.chunk.range, 'path');
		for (let index = 0; index < this.chunk.body.length; index += 1) {
			this.visitStatement(this.chunk.body[index]);
		}
		this.leaveScope();
		return {
			decls: this.decls,
			refs: this.refs,
			annotations: this.annotations,
			callExpressions: this.callExpressions,
			functionSignatures: this.functionSignatures,
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
			functionParameterValues: Array.from(this.functionParameterValues.values()),
			callValues: this.callValues,
			valueAssignments: this.valueAssignments,
			baseValues: [
				...this.baseValuesByClassDeclId.values(),
				...this.instanceBaseValues,
			],
			declStringSources: Array.from(this.declStringSources.entries(), ([declId, source]) => ({ declId, source })),
			prefabClasses: this.prefabClasses,
			objectBindings: this.objectBindings,
			prefabReferences: this.prefabReferences,
			eventEmitterParameters: this.eventEmitterParameters,
			componentProgramMounts: this.componentPrograms.mounts,
			componentProgramCallbacks: this.componentPrograms.callbacks,
			componentPublications: this.componentComposition.publications,
			componentMounts: this.componentComposition.mounts,
			componentAttachmentCalls: this.componentComposition.attachmentCalls,
			moduleAliases: Array.from(this.moduleAliasesByName.values()),
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
					this.activateDecl(pending[0]);
				}
				const valueLimit = localAssignment.values.length;
				for (let index = 0; index < valueLimit; index += 1) {
					const valueExpression = localAssignment.values[index];
					const targetDecl = index < pending.length ? pending[index] : pending[pending.length - 1];
					if (valueExpression.kind === LuaSyntaxKind.FunctionExpression) {
						const nameIndex = index < localAssignment.names.length ? index : localAssignment.names.length - 1;
						const binding = localAssignment.names[nameIndex];
						const bindingName = binding?.name;
						if (bindingName) {
							this.recordFunctionSignature(bindingName, valueExpression as LuaFunctionExpression, 'function');
						}
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
					if (targetDecl) {
						this.setDeclStringSource(targetDecl, valueExpression, false);
					}
				}
				for (let index = 0; index < pending.length; index += 1) {
					if (index >= localAssignment.values.length) {
						continue;
					}
					const initializer = localAssignment.values[index];
					const decl = pending[index];
					this.setModuleAlias(decl, this.resolveModuleAliasInitializer(initializer, this.moduleAliasLookup));
					if (pending[index].kind === 'constant') {
						this.setImmutableModuleAlias(
							decl,
							this.resolveModuleAliasInitializer(initializer, this.immutableModuleAliasLookup),
						);
					}
				}
				for (let index = 0; index < pending.length; index += 1) {
					if (index >= localAssignment.values.length) {
						this.setModuleAlias(pending[index], null);
					}
					this.activateDecl(pending[index]);
				}
				break;
			}
			case LuaSyntaxKind.LocalFunctionStatement: {
				const localFunction = statement;
				const decl = this.declareLocal(localFunction.name, 'function', true);
				this.recordFunctionSignature(localFunction.name.name, localFunction.functionExpression, 'function');
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
					const scopeRange = scope.range;
					const isGlobal = scope.kind === 'path';
					const tokenInfo = findFunctionNameToken(functionDeclaration, this.tokens, this.tokenMap);
					const range = tokenInfo
						? buildRangeFromToken(tokenInfo, this.path)
						: buildRangeFromPosition(functionDeclaration.range.start, namePath[namePath.length - 1].length, this.path);
					decl = this.createDecl({
						namePath,
						name: namePath[namePath.length - 1],
						kind: 'function',
						range,
						scopeRange,
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
					this.memberValues.set(decl.id, {
						declId: decl.id,
						name: decl.name,
						owner: functionOwner,
					});
				}
				this.recordFunctionNameReferences(functionDeclaration);
				this.recordFunctionDeclarationWriteReference(functionDeclaration, decl);
				const basePath = functionDeclaration.name.identifiers.join('.');
				const methodName = functionDeclaration.name.methodName;
				const declarationPath = methodName
					? (basePath.length > 0 ? `${basePath}:${methodName}` : methodName)
					: basePath;
				this.recordFunctionSignature(declarationPath, functionDeclaration.functionExpression, methodName ? 'method' : 'function');
				let methodSelfPath = methodName ? functionDeclaration.name.identifiers.slice() : undefined;
				if (!methodSelfPath
					&& functionDeclaration.name.identifiers.length > 1
					&& functionDeclaration.functionExpression.parameters[0]?.name === 'self') {
					methodSelfPath = functionDeclaration.name.identifiers.slice(0, -1);
				}
				this.visitFunctionExpression(
					functionDeclaration.functionExpression,
					methodSelfPath,
					declarationValueSource(decl.id),
					decl.name === CARTLIB_COMPONENT_COMPOSITION_CONTRACT.lifecycleMethodName && functionOwner
						? {
							lifecycleDeclId: decl.id,
						}
						: undefined,
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
					if (targetInfo?.decl) {
						this.setDeclStringSource(targetInfo.decl, valueExpression, false);
					}
					if (valueExpression.kind === LuaSyntaxKind.FunctionExpression) {
						if (targetInfo?.path) {
							this.recordFunctionSignature(targetInfo.path, valueExpression, 'function');
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
							: expressionValueSource(
								this.path,
								valueExpression.range.start.line,
								valueExpression.range.start.column,
							);
						if (targetInfo?.decl?.name === CARTLIB_COMPONENT_COMPOSITION_CONTRACT.lifecycleMethodName
							&& targetInfo.memberOwner) {
							this.visitFunctionExpression(
								valueExpression,
								selfPath,
								functionValue,
								{
									lifecycleDeclId: targetInfo.decl.id,
								},
							);
						} else {
							this.visitFunctionExpression(valueExpression, selfPath, functionValue);
						}
						if (targetInfo?.valueTarget) {
							this.recordValueAssignment(targetInfo.valueTarget, functionValue);
						}
						this.recordComponentProgramMemberAssignment(targetInfo, valueExpression);
						continue;
					}
					const valueInfo = this.visitExpression(valueExpression, context);
					if (targetInfo?.decl) {
						this.setDeclarationValue(targetInfo.decl, valueInfo?.valueSource);
					}
					if (targetInfo?.valueTarget && valueInfo?.valueSource) {
						this.recordValueAssignment(targetInfo.valueTarget, valueInfo.valueSource);
					}
					if (targetInfo?.decl) {
						this.componentComposition.recordMemberAssignment(
							targetInfo.memberOwner,
							targetInfo.decl.name,
							targetInfo.decl.id,
							valueInfo?.valueSource,
						);
					}
					this.recordComponentProgramMemberAssignment(targetInfo, valueExpression);
					if (targetInfo) {
						this.recordMetatableIndexAssignment(targetInfo, valueInfo);
					}
				}
				for (let index = 0; index < assignment.left.length; index += 1) {
					const target = assignment.left[index];
					if (target.kind !== LuaSyntaxKind.IdentifierExpression || index >= assignment.right.length) {
						continue;
					}
					targets[index].moduleAlias = this.resolveModuleAliasInitializer(
						assignment.right[index],
						this.moduleAliasLookup,
					);
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
					this.enterScope(clause.block.range, 'block');
					this.visitBlock(clause.block);
					this.leaveScope();
				}
				break;
			}
			case LuaSyntaxKind.WhileStatement: {
				const whileStatement = statement;
				this.visitExpression(whileStatement.condition, { tableBaseDecl: null, tableBasePath: null });
				this.enterScope(whileStatement.block.range, 'loop');
				this.visitBlock(whileStatement.block);
				this.leaveScope();
				break;
			}
			case LuaSyntaxKind.RepeatStatement: {
				const repeatStatement = statement;
				this.enterScope(repeatStatement.block.range, 'loop');
				this.visitBlock(repeatStatement.block);
				this.leaveScope();
				this.visitExpression(repeatStatement.condition, { tableBaseDecl: null, tableBasePath: null });
				break;
			}
			case LuaSyntaxKind.ForNumericStatement: {
				const forNumeric = statement;
				this.visitExpression(forNumeric.start, { tableBaseDecl: null, tableBasePath: null });
				this.visitExpression(forNumeric.limit, { tableBaseDecl: null, tableBasePath: null });
				if (forNumeric.step) {
					this.visitExpression(forNumeric.step, { tableBaseDecl: null, tableBasePath: null });
				}
				this.enterScope(forNumeric.block.range, 'loop');
				this.declareLocal(forNumeric.variable, 'local', true);
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
				this.enterScope(forGeneric.block.range, 'loop');
				let valueVariable: InternalDecl | undefined;
				for (let index = 0; index < forGeneric.variables.length; index += 1) {
					const variable = this.declareLocal(forGeneric.variables[index], 'local', true);
					if (index === 1) {
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
				this.enterScope(doStatement.block.range, 'block');
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
				const methodName = callExpression.methodName;
				const callResult = expressionValueSource(
					this.path,
					callExpression.range.start.line,
					callExpression.range.start.column,
				);
				const calleeInfo = this.visitExpression(callExpression.callee, context);
				if (methodName) {
					this.recordMethodReference(callExpression, calleeInfo);
				}
				let firstArgumentInfo: ResolvedNamePath = null;
				let secondArgumentInfo: ResolvedNamePath = null;
				const argumentValues = new Array<SemanticValueSource | undefined>(callExpression.arguments.length);
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
					argumentValues[index] = argumentInfo?.valueSource;
				}
				const calledValue = methodName && calleeInfo?.valueSource
					? appendValueMember(calleeInfo.valueSource, methodName)
					: calleeInfo?.valueSource;
				if (calledValue) {
					this.callValues.push({
						callee: calledValue,
						arguments: argumentValues,
						result: callResult,
					});
				}
				this.componentComposition.recordAttachmentCall(
					methodName,
					calleeInfo?.valueSource,
					argumentValues[0],
				);
				this.recordMetatableClassBase(callExpression);
				this.callExpressions.push(callExpression);
				const cartlibValue = this.recordCartlibCallMetadata(callExpression);
				const valueSource = this.resolveCallResultValue(
					callExpression,
					calleeInfo,
					firstArgumentInfo,
					secondArgumentInfo,
					cartlibValue,
					callResult,
				);
				return valueSource
					? { namePath: null, decl: null, valueSource }
					: null;
			}
			case LuaSyntaxKind.FunctionExpression: {
				const functionValue = context.tableBaseDecl
					? declarationValueSource(context.tableBaseDecl.id)
					: expressionValueSource(
						this.path,
						expression.range.start.line,
						expression.range.start.column,
					);
				this.visitFunctionExpression(expression, undefined, functionValue);
				return { namePath: null, decl: context.tableBaseDecl, valueSource: functionValue };
			}
			case LuaSyntaxKind.TableConstructorExpression: {
				const tableOwner = context.tableOwner ?? tableValueSource(
					this.path,
					expression.range.start.line,
					expression.range.start.column,
				);
				if (context.tableBaseDecl) {
					this.componentPrograms.recordTableInitializer(context.tableBaseDecl.id, expression);
				}
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
					const valueSource = expressionValueSource(
						this.path,
						expression.range.start.line,
						expression.range.start.column,
					);
					if (left?.valueSource) {
						this.recordValueAssignment(valueSource, left.valueSource);
					}
					if (right?.valueSource) {
						this.recordValueAssignment(valueSource, right.valueSource);
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
			case LuaSyntaxKind.NumericLiteralExpression:
			case LuaSyntaxKind.StringLiteralExpression:
			case LuaSyntaxKind.BooleanLiteralExpression:
			case LuaSyntaxKind.NilLiteralExpression:
				return null;
			default:
				return null;
		}
	}

	private visitTableConstructorExpression(expression: LuaTableConstructorExpression, context: ExpressionContext): void {
		for (let index = 0; index < expression.fields.length; index += 1) {
			const field = expression.fields[index];
			switch (field.kind) {
				case LuaTableFieldKind.Array: {
					const valueInfo = this.visitExpression(field.value, { tableBaseDecl: null, tableBasePath: null });
					if (context.tableOwner && valueInfo?.valueSource) {
						this.recordValueAssignment(
							appendValueElement(context.tableOwner),
							valueInfo.valueSource,
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
					const valueInfo = this.visitExpression(field.value, valueContext);
					this.setDeclarationValue(decl, valueInfo?.valueSource);
					this.setDeclStringSource(decl, field.value, context.moduleReturn === true);
					break;
				}
				case LuaTableFieldKind.ExpressionKey: {
					this.visitExpression(field.key, { tableBaseDecl: null, tableBasePath: null });
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
						const valueInfo = this.visitExpression(field.value, {
							tableBaseDecl: decl,
							tableBasePath: decl.namePath,
							tableOwner: declarationValueSource(decl.id),
						});
						this.setDeclarationValue(decl, valueInfo?.valueSource);
						this.setDeclStringSource(decl, field.value, context.moduleReturn === true);
						break;
					}
					const valueInfo = this.visitExpression(field.value, { tableBaseDecl: null, tableBasePath: null });
					if (context.tableOwner && valueInfo?.valueSource) {
						this.recordValueAssignment(
							appendValueElement(context.tableOwner),
							valueInfo.valueSource,
						);
					}
					break;
				}
				default:
					break;
			}
		}
		this.recordEventEmitterParameter(expression, context.tableOwner);
	}

	private recordEventEmitterParameter(
		expression: LuaTableConstructorExpression,
		owner: SemanticValueSource | undefined,
	): void {
		if (!owner) {
			return;
		}
		let emitterExpression: LuaExpression | undefined;
		let goExpression: LuaExpression | undefined;
		for (let index = 0; index < expression.fields.length; index += 1) {
			const field = expression.fields[index];
			if (field.kind !== LuaTableFieldKind.IdentifierKey) {
				continue;
			}
			if (field.name === 'emitter') {
				emitterExpression = field.value;
			} else if (field.name === 'go') {
				goExpression = field.value;
			}
		}
		if (!emitterExpression || !goExpression) {
			return;
		}
		const emitterId = this.resolveConstantStringSource(emitterExpression);
		if (!emitterId) {
			return;
		}
		const goDecl = goExpression.kind === LuaSyntaxKind.FunctionExpression
			? this.propertiesByOwner.get(this.memberOwnerKey(owner, 'go'))
			: this.resolveStaticExpressionDeclaration(goExpression);
		const parameters = goDecl && this.functionParameterValues.get(
			semanticValueSourceKey(declarationValueSource(goDecl.id)),
		);
		if (!parameters || parameters.parameterDeclIds.length < 4) {
			return;
		}
		this.eventEmitterParameters.push({
			parameterDeclId: parameters.parameterDeclIds[3],
			emitterId,
		});
	}

	private visitFunctionExpression(
		expression: LuaFunctionExpression,
		methodSelfPath: readonly string[] | undefined,
		functionValue: SemanticValueSource,
		componentLifecycle?: {
			lifecycleDeclId: SymbolID;
		},
	): void {
		this.componentComposition.enterFunction(componentLifecycle);
		const block = expression.body;
		const scopeRange = block.range;
		this.enterScope(scopeRange, 'function');
		const inheritedMethodSelfPath = this.currentMethodSelfPath();
		const inheritedMethodSelfScope = this.methodSelfScopeStack[this.methodSelfScopeStack.length - 1];
		const effectiveMethodSelfPath = methodSelfPath ?? inheritedMethodSelfPath;
		this.methodSelfPathStack.push(effectiveMethodSelfPath?.slice());
		this.methodSelfScopeStack.push(methodSelfPath ? this.currentScope() : inheritedMethodSelfScope);
		this.functionReturnValueStack.push({
			sources: [],
		});
		const parameterDeclIds = new Array<SymbolID>(expression.parameters.length);
		for (let index = 0; index < expression.parameters.length; index += 1) {
			const parameter = this.declareParameter(expression.parameters[index], expression.range);
			parameterDeclIds[index] = parameter.id;
			if (index === 0
				&& parameter.name === 'self'
				&& methodSelfPath
				&& methodSelfPath.length > 0) {
				const classValue = this.resolveValueSourceFromNamePath(methodSelfPath);
				if (classValue) {
					this.setDeclarationProjection(parameter, appendValueInstance(classValue));
				}
			}
		}
		this.functionParameterValues.set(semanticValueSourceKey(functionValue), {
			functionValue,
			parameterDeclIds,
		});
		this.visitBlock(block);
		const returnValue = this.functionReturnValueStack.pop()!;
		this.methodSelfScopeStack.pop();
		this.methodSelfPathStack.pop();
		this.leaveScope();
		const functionKey = semanticValueSourceKey(functionValue);
		if (returnValue.sources.length > 0) {
			this.functionReturnValues.set(
				functionKey,
				returnValue.sources.map(source => ({ functionValue, source })),
			);
		} else {
			this.functionReturnValues.delete(functionKey);
		}
		this.componentComposition.leaveFunction();
	}

	private currentMethodSelfPath(): readonly string[] | undefined {
		if (this.methodSelfPathStack.length === 0) {
			return undefined;
		}
		return this.methodSelfPathStack[this.methodSelfPathStack.length - 1];
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
				throw new Error('[LuaSemanticModel] Unsupported unary assignment target.');
			default:
				return { decl: null, namePath: null, path: null };
		}
	}

	private assignIdentifier(identifier: LuaIdentifierExpression): AssignmentTargetInfo {
		const existing = this.resolveName(identifier.name);
		const range = buildIdentifierRange(identifier, this.tokenMap, this.path);
		if (existing) {
			this.recordReference({
				namePath: existing.namePath,
				name: identifier.name,
				range,
				target: existing.id,
				isWrite: true,
				referenceKind: 'identifier',
			});
			return { decl: existing, namePath: existing.namePath, path: identifier.name };
		}
		const globalDecl = this.globalsByKey.get(identifier.name);
		if (globalDecl) {
			this.recordReference({
				namePath: globalDecl.namePath,
				name: identifier.name,
				range,
				target: globalDecl.id,
				isWrite: true,
				referenceKind: 'identifier',
			});
			return { decl: globalDecl, namePath: globalDecl.namePath, path: identifier.name };
		}
		const decl = this.declareGlobal(identifier, range);
		return { decl, namePath: decl.namePath, path: identifier.name };
	}

	private assignMember(member: LuaMemberExpression): AssignmentTargetInfo {
		const baseInfo = this.visitExpression(member.base, { tableBaseDecl: null, tableBasePath: null });
		const basePath = resolveReferencedBasePath(baseInfo, member.base);
		const baseDecl = baseInfo?.decl;
		const namePath = basePath ? appendToNamePath(basePath, member.identifier) : [member.identifier];
		const range = buildPropertyRange(member, this.tokenMap, this.path);
		const decl = this.ensureTableField(
			namePath,
			range.start,
			member.identifier.length,
			baseDecl,
			baseInfo?.valueSource,
		);
		this.recordReference({
			namePath,
			name: member.identifier,
			range,
			target: decl.id,
			isWrite: true,
			referenceKind: 'member',
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
		this.visitExpression(indexExpression.index, { tableBaseDecl: null, tableBasePath: null });
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
				? appendValueElement(baseInfo.valueSource)
				: undefined,
		};
	}

	private recordMethodReference(callExpression: LuaCallExpression, calleeInfo: ResolvedNamePath): void {
		let basePath = resolveReferencedBasePath(calleeInfo, callExpression.callee);
		if (basePath
			&& basePath.length === 1
			&& basePath[0] === 'self'
			&& (!calleeInfo || !calleeInfo.decl)) {
			const methodSelfPath = this.currentMethodSelfPath();
			if (methodSelfPath && methodSelfPath.length > 0) {
				basePath = methodSelfPath.slice();
			}
		}
		const receiverSymbolKey = calleeInfo?.decl?.symbolKey || (calleeInfo?.namePath && joinNamePath(calleeInfo.namePath));
		const methodName = callExpression.methodName!;
		const namePath = basePath ? appendToNamePath(basePath, methodName) : [methodName];
		const tokenInfo = findMethodToken(callExpression, this.tokens, this.tokenMap);
		const range = tokenInfo ? buildRangeFromToken(tokenInfo, this.path) : callExpression.range;
		const decl = calleeInfo?.valueSource
			? this.propertiesByOwner.get(this.memberOwnerKey(calleeInfo.valueSource, methodName))
			: this.properties.get(joinNamePath(namePath));
		const targetId = decl?.id;
		this.recordReference({
			namePath,
			name: methodName,
			range,
			target: targetId,
			isWrite: false,
			referenceKind: 'method',
			receiverSymbolKey,
			receiverValue: calleeInfo?.valueSource,
		});
	}

	private recordFunctionSignature(path: string, expression: LuaFunctionExpression, declarationStyle: 'function' | 'method'): void {
		if (!path || path.length === 0) {
			return;
		}
		registerFunctionFromExpression(this.functionSignatures, path, expression, declarationStyle);
	}

	private handleIdentifierExpression(identifier: LuaIdentifierExpression, isWrite: boolean): ResolvedNamePath {
		const range = buildIdentifierRange(identifier, this.tokenMap, this.path);
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
						namePath,
						name: identifier.name,
						range,
						isWrite,
						referenceKind: 'self',
					});
					return {
						namePath,
						decl: null,
						valueSource: classValue ? appendValueInstance(classValue) : undefined,
					};
				}
			}
		}
		const targetId = resolved?.id;
		if (resolved) {
			this.recordReference({
				namePath,
				name: identifier.name,
				range,
				target: targetId,
				isWrite,
				referenceKind: 'identifier',
			});
			return {
				namePath,
				decl: resolved,
				valueSource: declarationValueSource(resolved.id),
			};
		}
		const globalDecl = this.globalsByKey.get(identifier.name);
		const target = globalDecl?.id;
		if (target) {
			this.recordReference({
				namePath,
				name: identifier.name,
				range,
				target,
				isWrite,
				referenceKind: 'identifier',
			});
		} else {
			this.recordReference({
				namePath,
				name: identifier.name,
				range,
				isWrite,
				referenceKind: 'identifier',
			});
		}
		return {
			namePath,
			decl: globalDecl,
			valueSource: globalDecl
				? declarationValueSource(globalDecl.id)
				: globalValueSource(identifier.name),
		};
	}

	private handleMemberExpression(member: LuaMemberExpression, context: ExpressionContext, isWrite: boolean): ResolvedNamePath {
		const baseInfo = this.visitExpression(member.base, context);
		const basePath = resolveReferencedBasePath(baseInfo, member.base);
		const namePath = basePath ? appendToNamePath(basePath, member.identifier) : [member.identifier];
		const range = buildPropertyRange(member, this.tokenMap, this.path);
		const decl = baseInfo?.valueSource
			? this.propertiesByOwner.get(this.memberOwnerKey(baseInfo.valueSource, member.identifier))
			: this.properties.get(joinNamePath(namePath));
		const targetId = decl?.id;
		this.recordReference({
			namePath,
			name: member.identifier,
			range,
			target: targetId,
			isWrite,
			referenceKind: 'member',
			receiverSymbolKey: baseInfo?.decl?.symbolKey || (baseInfo?.namePath && joinNamePath(baseInfo.namePath)),
			receiverValue: baseInfo?.valueSource,
		});
		return {
			namePath,
			decl,
			valueSource: baseInfo?.valueSource
				? appendValueMember(baseInfo.valueSource, member.identifier)
				: undefined,
		};
	}

	private handleIndexExpression(indexExpression: LuaIndexExpression, context: ExpressionContext): ResolvedNamePath {
		const baseInfo = this.visitExpression(indexExpression.base, context);
		this.visitExpression(indexExpression.index, { tableBaseDecl: null, tableBasePath: null });
		if (!baseInfo?.valueSource) {
			return null;
		}
		if (indexExpression.index.kind === LuaSyntaxKind.StringLiteralExpression) {
			const name = indexExpression.index.value;
			const basePath = resolveReferencedBasePath(baseInfo, indexExpression.base);
			const namePath = basePath ? appendToNamePath(basePath, name) : [name];
			const decl = this.propertiesByOwner.get(this.memberOwnerKey(baseInfo.valueSource, name))
				?? this.properties.get(joinNamePath(namePath));
			return {
				namePath,
				decl,
				valueSource: appendValueMember(baseInfo.valueSource, name),
			};
		}
		return {
			namePath: null,
			decl: null,
			valueSource: appendValueElement(baseInfo.valueSource),
		};
	}

	private declareLocal(name: LuaIdentifierExpression, kind: SemanticSymbolKind, activate: boolean): InternalDecl {
		const scope = this.currentScope();
		const range = buildIdentifierRange(name, this.tokenMap, this.path);
		const decl = this.createDecl({
			namePath: [name.name],
			name: name.name,
			kind,
			range,
			scopeRange: scope.range,
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

	private declareParameter(name: LuaIdentifierExpression, scopeRange: LuaSourceRange): InternalDecl {
		const scope = this.currentScope();
		const range = buildIdentifierRange(name, this.tokenMap, this.path);
		const decl = this.createDecl({
			namePath: [name.name],
			name: name.name,
			kind: 'parameter',
			range,
			scopeRange,
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
		const range = buildIdentifierRange(name, this.tokenMap, this.path);
		const decl = this.createDecl({
			namePath: [name.name],
			name: name.name,
			kind: 'type',
			range,
			scopeRange: scope.range,
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
		const range = buildIdentifierRange(name, this.tokenMap, this.path);
		const decl = this.createDecl({
			namePath: [name.name],
			name: name.name,
			kind: 'bss',
			range,
			scopeRange: scope.range,
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
		const range = buildIdentifierRange(name, this.tokenMap, this.path);
		const decl = this.createDecl({
			namePath: [name.name],
			name: name.name,
			kind: 'data',
			range,
			scopeRange: scope.range,
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
		const range = buildIdentifierRange(name, this.tokenMap, this.path);
		const decl = this.createDecl({
			namePath: [name.name],
			name: name.name,
			kind: 'rodata',
			range,
			scopeRange: scope.range,
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
			namePath,
			name: identifier.name,
			kind: 'global',
			range,
			scopeRange: scope.range,
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
	): InternalDecl {
		const key = joinNamePath(namePath);
		const ownerKey = owner && this.memberOwnerKey(owner, namePath[namePath.length - 1]);
		const existing = ownerKey
			? this.propertiesByOwner.get(ownerKey)
			: this.properties.get(key);
		if (existing) {
			if (owner && !this.memberValues.has(existing.id)) {
				this.memberValues.set(existing.id, {
					declId: existing.id,
					name: existing.name,
					owner,
				});
			}
			return existing;
		}
		const scope = baseDecl ? baseDecl.scopeRef : this.currentScope();
		const scopeRange = baseDecl ? baseDecl.scope : scope.range;
		const range = buildRangeFromPosition(start, length, this.path);
		const isGlobal = baseDecl ? baseDecl.isGlobal : scope.kind === 'path' && namePath.length > 1;
		const decl = this.createDecl({
			namePath: namePath,
			name: namePath[namePath.length - 1],
			kind: 'property',
			range,
			scopeRange,
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
			this.memberValues.set(decl.id, {
				declId: decl.id,
				name: decl.name,
				owner,
			});
		}
		return decl;
	}

	private recordComponentProgramMemberAssignment(
		target: AssignmentTargetInfo | undefined,
		expression: LuaExpression,
	): void {
		if (!target?.decl || !target.memberOwner) {
			return;
		}
		this.componentPrograms.recordMemberAssignment(
			target.memberOwner,
			target.decl.name,
			target.decl.id,
			expression,
		);
		const baseDecl = target.memberBaseDecl;
		if (!baseDecl) {
			return;
		}
		const projections = this.projectionSourcesByDeclId.get(baseDecl.id);
		if (!projections) {
			return;
		}
		for (let projectionIndex = 0; projectionIndex < projections.length; projectionIndex += 1) {
			this.componentPrograms.recordMemberAssignment(
				projections[projectionIndex],
				target.decl.name,
				target.decl.id,
				expression,
			);
		}
	}

	private memberOwnerKey(owner: SemanticValueSource, name: string): string {
		return `${semanticValueSourceKey(owner)}\0${name}`;
	}

	private createDecl(options: {
		namePath: readonly string[];
		name: string;
		kind: SemanticSymbolKind;
		range: LuaSourceRange;
		scopeRange: LuaSourceRange;
		scopeRef: Scope;
		isGlobal: boolean;
		active: boolean;
	}): InternalDecl {
		const { namePath, name, kind, range, scopeRange, scopeRef, isGlobal, active } = options;
		const id = createSymbolId(this.path, range, kind, namePath);
		const decl: InternalDecl = {
			id,
			file: this.path,
			name,
			namePath: namePath.slice(),
			symbolKey: joinNamePath(namePath),
			kind,
			range,
			scope: scopeRange,
			isGlobal,
			scopeRef,
			active,
		};
		this.decls.push(decl);
		this.declById.set(id, decl);
		return decl;
	}

	private recordDefinitionAnnotation(decl: InternalDecl): void {
		this.annotate(decl.range, decl.name.length, decl.kind, 'definition');
	}

	private recordReference(options: {
		namePath: readonly string[];
		name: string;
		range: LuaSourceRange;
		target?: SymbolID;
		isWrite: boolean;
		referenceKind: 'identifier' | 'self' | 'member' | 'method';
		receiverSymbolKey?: string;
		receiverValue?: SemanticValueSource;
	}): void {
		const targetDecl = options.target ? this.declById.get(options.target) : null;
		const ref: Ref = {
			file: this.path,
			name: options.name,
			namePath: options.namePath.slice(),
			symbolKey: joinNamePath(options.namePath),
			range: options.range,
			isWrite: options.isWrite,
			referenceKind: options.referenceKind,
			receiverSymbolKey: options.receiverSymbolKey,
			receiverValue: options.receiverValue,
		};
		if (options.target) {
			ref.target = options.target;
		}
		if (targetDecl && !targetDecl.isGlobal && options.referenceKind === 'identifier') {
			ref.lexicalTarget = targetDecl.id;
		}
		this.refs.push(ref);
		const kind = targetDecl ? targetDecl.kind : inferReferenceKind(ref);
		this.annotate(ref.range, ref.name.length, kind, 'usage');
	}

	private recordFunctionNameReferences(statement: LuaFunctionDeclarationStatement): void {
		const identifiers = statement.name.methodName
			? statement.name.identifiers
			: statement.name.identifiers.slice(0, Math.max(statement.name.identifiers.length - 1, 0));
		if (identifiers.length === 0) {
			return;
		}
		const tokenInfos = findFunctionNameIdentifierTokens(statement, identifiers, this.tokens, this.tokenMap);
		if (tokenInfos.length === 0) {
			return;
		}
		const namePath: string[] = [];
		for (let index = 0; index < tokenInfos.length; index += 1) {
			const identifier = identifiers[index];
			const tokenInfo = tokenInfos[index];
			namePath.push(identifier);
			const range = buildRangeFromToken(tokenInfo, this.path);
			let targetDecl: InternalDecl = null;
			if (namePath.length === 1) {
				targetDecl = this.resolveName(identifier) ?? this.globalsByKey.get(identifier);
			} else {
				const owner = this.resolveValueSourceFromNamePath(namePath.slice(0, -1));
				targetDecl = owner
					? this.propertiesByOwner.get(this.memberOwnerKey(owner, identifier))
					: this.properties.get(joinNamePath(namePath));
			}
			this.recordReference({
				namePath,
				name: identifier,
				range,
				target: targetDecl?.id,
				isWrite: false,
				referenceKind: index === 0 ? 'identifier' : 'member',
			});
		}
	}

	private recordFunctionDeclarationWriteReference(statement: LuaFunctionDeclarationStatement, decl: InternalDecl): void {
		const tokenInfo = findFunctionNameToken(statement, this.tokens, this.tokenMap);
		if (!tokenInfo) {
			return;
		}
		let targetDecl: InternalDecl = decl;
		if (!statement.name.methodName && statement.name.identifiers.length === 1) {
			targetDecl = this.resolveName(statement.name.identifiers[0]);
			if (!targetDecl && this.currentScope().kind === 'path') {
				targetDecl = decl;
			}
		}
		this.recordReference({
			namePath: decl.namePath,
			name: decl.name,
			range: buildRangeFromToken(tokenInfo, this.path),
			target: targetDecl?.id,
			isWrite: true,
			referenceKind: statement.name.methodName ? 'method' : (decl.namePath.length === 1 ? 'identifier' : 'member'),
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
		let sources = this.projectionSourcesByDeclId.get(decl.id);
		if (!sources) {
			sources = [];
			this.projectionSourcesByDeclId.set(decl.id, sources);
		}
		for (let index = 0; index < sources.length; index += 1) {
			if (semanticValueSourcesEqual(sources[index], source)) {
				return;
			}
		}
		sources.push(source);
	}

	private recordValueAssignment(target: SemanticValueSource, source: SemanticValueSource): void {
		this.valueAssignments.push({ target, source });
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

	private setDeclStringSource(decl: InternalDecl, expression: LuaExpression, moduleExport: boolean): void {
		if (decl.kind === 'constant') {
			decl.constantInitializer = expression;
		}
		const source = moduleExport
			? this.resolveConstantStringSource(expression)
			: this.resolveStaticStringSource(expression);
		const retain = source && (
			source.kind === 'literal'
			|| (source.kind === 'module' && (decl.kind === 'property' || moduleExport))
			|| (source.kind === 'declaration' && this.declStringSources.has(source.declId))
			|| (moduleExport && source.kind === 'global')
		);
		if (retain) {
			this.declStringSources.set(decl.id, source);
		} else {
			this.declStringSources.delete(decl.id);
		}
	}

	private resolveStaticStringSource(expression: LuaExpression): StaticStringSource {
		if (expression.kind === LuaSyntaxKind.StringLiteralExpression) {
			return { kind: 'literal', value: expression.value };
		}
		const moduleAlias = this.resolveModuleAliasInitializer(expression, this.moduleAliasLookup);
		if (moduleAlias) {
			return {
				kind: 'module',
				module: moduleAlias.module,
				memberPath: moduleAlias.memberPath.slice(),
			};
		}
		const path = extractStaticMemberPath(expression);
		if (!path || path.length === 0) {
			return null;
		}
		const decl = this.resolveStaticExpressionDeclaration(expression);
		if (decl) {
			return { kind: 'declaration', declId: decl.id };
		}
		return { kind: 'global', symbolKey: joinNamePath(path) };
	}

	public resolveConstantStringSource(expression: LuaExpression): StaticStringSource {
		let source = this.resolveStaticStringSource(expression);
		while (source?.kind === 'declaration') {
			const retained = this.declStringSources.get(source.declId);
			if (retained) {
				source = retained;
				continue;
			}
			const initializer = this.declById.get(source.declId)?.constantInitializer;
			if (!initializer) {
				break;
			}
			source = this.resolveStaticStringSource(initializer);
		}
		return source;
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
			&& !iterator.methodName) {
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

	private recordMetatableIndexAssignment(
		target: AssignmentTargetInfo,
		value: ResolvedNamePath,
	): void {
		const targetPath = target.namePath;
		if (this.currentScope().kind !== 'path'
			|| !targetPath
			|| targetPath.length < 2
			|| targetPath[targetPath.length - 1] !== '__index') {
			return;
		}
		const metatableKey = joinNamePath(targetPath.slice(0, targetPath.length - 1));
		if (value?.valueSource) {
			this.metatableIndexValues.set(metatableKey, value.valueSource);
		} else {
			this.metatableIndexValues.delete(metatableKey);
		}
	}

	private resolveCallResultValue(
		callExpression: LuaCallExpression,
		callee: ResolvedNamePath,
		firstArgument: ResolvedNamePath,
		secondArgument: ResolvedNamePath,
		cartlibValue: SemanticValueSource | undefined,
		callResult: SemanticValueSource,
	): SemanticValueSource | undefined {
		if (cartlibValue) {
			return cartlibValue;
		}
		if (!callExpression.methodName) {
			const directCallName = resolveDirectCallName(callExpression.callee);
			if (directCallName === 'require'
				&& !this.resolveName('require')
				&& callExpression.arguments.length === 1
				&& callExpression.arguments[0].kind === LuaSyntaxKind.StringLiteralExpression) {
				return moduleValueSource(callExpression.arguments[0].value);
			}
			if (directCallName === 'setmetatable'
				&& !callee?.decl
				&& callExpression.arguments.length === 2) {
				if (secondArgument?.namePath) {
					const classValue = this.metatableIndexValues.get(joinNamePath(secondArgument.namePath));
					if (classValue) {
						const instanceValue = appendValueInstance(classValue);
						if (firstArgument?.valueSource) {
							this.instanceBaseValues.push({
								owner: instanceValue,
								base: firstArgument.valueSource,
								origin: 'instance',
							});
						}
						return instanceValue;
					}
				}
				return firstArgument?.valueSource;
			}
		}
		if (!callee?.valueSource) {
			return undefined;
		}
		return callResult;
	}

	private recordCartlibCallMetadata(callExpression: LuaCallExpression): SemanticValueSource | undefined {
		const callKind = this.classifyCartlibCall(callExpression);
		if (callKind === CARTLIB_CALL_PREFAB_DEFINE) {
			this.recordPrefabMetadata(callExpression);
			return undefined;
		}
		if (callKind === CARTLIB_CALL_STATE_MACHINE_REGISTER
			|| callKind === CARTLIB_CALL_BEHAVIOUR_TREE_REGISTER) {
			const programExpression = callExpression.arguments[0];
			const definition = callExpression.arguments[1];
			if (programExpression && definition) {
				const programId = this.resolveConstantStringSource(programExpression);
				if (programId) {
					this.componentPrograms.recordProgram(
						callKind === CARTLIB_CALL_STATE_MACHINE_REGISTER ? 'state_machine' : 'behaviour_tree',
						programId,
						definition,
					);
				}
			}
			return undefined;
		}
		if (callKind === CARTLIB_CALL_WORLD_SPAWN) {
			const prefabExpression = callExpression.arguments[0];
			if (!prefabExpression) {
				return undefined;
			}
			const prefabId = this.resolveConstantStringSource(prefabExpression);
			if (!prefabId) {
				return undefined;
			}
			const objectId = this.resolveObjectBindingId(callExpression);
			if (objectId) {
				this.objectBindings.push({ objectId, prefabId });
				if (objectId.kind === 'literal') {
					return bindingValueSource(objectBindingId(objectId.value));
				}
			}
			if (prefabId.kind === 'literal') {
				return bindingValueSource(prefabBindingId(prefabId.value));
			}
			const bindingId = sourceBindingId(
				this.path,
				callExpression.range.start.line,
				callExpression.range.start.column,
			);
			this.prefabReferences.push({ bindingId, defId: prefabId });
			return bindingValueSource(bindingId);
		}
		return undefined;
	}

	private resolveObjectBindingId(callExpression: LuaCallExpression): StaticStringSource {
		const options = callExpression.arguments[1];
		if (!options || options.kind !== LuaSyntaxKind.TableConstructorExpression) {
			return null;
		}
		for (let index = 0; index < options.fields.length; index += 1) {
			const field = options.fields[index];
			if (field.kind === LuaTableFieldKind.IdentifierKey && field.name === 'id') {
				return this.resolveConstantStringSource(field.value);
			}
		}
		return null;
	}

	private recordPrefabMetadata(callExpression: LuaCallExpression): void {
		const descriptor = callExpression.arguments[0];
		if (!descriptor || descriptor.kind !== LuaSyntaxKind.TableConstructorExpression) {
			return;
		}
		let defId: StaticStringSource = null;
		let classExpression: LuaExpression = null;
		let baseExpression: LuaExpression = null;
		let hasBase = false;
		for (let index = 0; index < descriptor.fields.length; index += 1) {
			const field = descriptor.fields[index];
			if (field.kind !== LuaTableFieldKind.IdentifierKey) {
				continue;
			}
			switch (field.name) {
				case 'def_id':
					defId = this.resolveConstantStringSource(field.value);
					break;
				case 'class':
					classExpression = field.value;
					break;
				case 'base':
					baseExpression = field.value;
					hasBase = true;
					break;
			}
		}
		const classDecl = this.resolveStaticExpressionDeclaration(classExpression);
		if (!classDecl) {
			return;
		}
		this.componentPrograms.recordMounts(descriptor, classDecl.id);
		this.componentComposition.recordPrefabComponents(descriptor, classDecl.id);
		if (defId) {
			this.prefabClasses.push({
				defId,
				classDeclId: classDecl.id,
			});
		}
		if (this.baseValuesByClassDeclId.has(classDecl.id)) {
			return;
		}
		if (!hasBase || baseExpression.kind === LuaSyntaxKind.NilLiteralExpression) {
			this.baseValuesByClassDeclId.set(classDecl.id, {
				owner: declarationValueSource(classDecl.id),
				origin: 'prefab',
				base: moduleValueSource(CARTLIB_WORLD_OBJECT_MODULE),
			});
			return;
		}
		const baseDecl = this.resolveStaticExpressionDeclaration(baseExpression);
		if (baseDecl && baseDecl.id !== classDecl.id) {
			this.baseValuesByClassDeclId.set(classDecl.id, {
				owner: declarationValueSource(classDecl.id),
				origin: 'prefab',
				base: declarationValueSource(baseDecl.id),
			});
		}
	}

	private recordMetatableClassBase(callExpression: LuaCallExpression): void {
		if (this.currentScope().kind !== 'path') {
			return;
		}
		const relation = extractMetatableClassBaseExpressions(callExpression);
		if (!relation) {
			return;
		}
		const classDecl = this.resolveStaticExpressionDeclaration(relation.classExpression);
		const baseDecl = this.resolveStaticExpressionDeclaration(relation.baseExpression);
		if (!classDecl || !baseDecl || classDecl.id === baseDecl.id) {
			return;
		}
		this.baseValuesByClassDeclId.set(classDecl.id, {
			owner: declarationValueSource(classDecl.id),
			origin: 'metatable',
			base: declarationValueSource(baseDecl.id),
		});
	}

	public resolveStaticExpressionDeclaration(expression: LuaExpression): InternalDecl {
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

	public resolveMemberValueSource(owner: SemanticValueSource, name: string): SemanticValueSource {
		const decl = this.propertiesByOwner.get(this.memberOwnerKey(owner, name));
		return decl ? declarationValueSource(decl.id) : appendValueMember(owner, name);
	}

	public resolveExpressionValueSource(expression: LuaExpression): SemanticValueSource | undefined {
		if (expression.kind === LuaSyntaxKind.CallExpression) {
			return expressionValueSource(
				this.path,
				expression.range.start.line,
				expression.range.start.column,
			);
		}
		if (expression.kind === LuaSyntaxKind.FunctionExpression
			|| (expression.kind === LuaSyntaxKind.BinaryExpression
				&& (expression.operator === LuaBinaryOperator.And || expression.operator === LuaBinaryOperator.Or))) {
			return expressionValueSource(
				this.path,
				expression.range.start.line,
				expression.range.start.column,
			);
		}
		const path = extractStaticMemberPath(expression);
		return path ? this.resolveValueSourceFromNamePath(path) : undefined;
	}

	private resolveModuleAliasInitializer(
		expression: LuaExpression,
		lookup: (name: string) => ModuleAliasTarget,
	): ModuleAliasTarget {
		return resolveModuleAliasInitializer(
			expression,
			lookup,
			this.resolveName('require') === null,
		);
	}

	private classifyCartlibCall(callExpression: LuaCallExpression): CartlibCallKind {
		let trailingMember = callExpression.methodName;
		let memberCount = trailingMember ? 1 : 0;
		let expression = callExpression.callee;
		while (expression.kind === LuaSyntaxKind.MemberExpression
			|| expression.kind === LuaSyntaxKind.IndexExpression) {
			let member: string;
			if (expression.kind === LuaSyntaxKind.MemberExpression) {
				member = expression.identifier;
			} else {
				if (expression.index.kind !== LuaSyntaxKind.StringLiteralExpression) {
					return CARTLIB_CALL_NONE;
				}
				member = expression.index.value;
			}
			memberCount += 1;
			if (memberCount > 1) {
				return CARTLIB_CALL_NONE;
			}
			trailingMember = member;
			expression = expression.base;
		}
		if (expression.kind !== LuaSyntaxKind.IdentifierExpression) {
			return CARTLIB_CALL_NONE;
		}
		const alias = this.immutableModuleAliasForName(expression.name);
		if (!alias || alias.memberPath.length + memberCount > 1) {
			return CARTLIB_CALL_NONE;
		}
		if (alias.memberPath.length === 1) {
			trailingMember = alias.memberPath[0];
		}
		const totalMemberCount = alias.memberPath.length + memberCount;
		if (alias.module === CARTLIB_PREFAB_MODULE && totalMemberCount === 1) {
			if (trailingMember === 'define') {
				return CARTLIB_CALL_PREFAB_DEFINE;
			}
			return CARTLIB_CALL_NONE;
		}
		if (alias.module === CARTLIB_WORLD_MODULE && totalMemberCount === 1) {
			return trailingMember === 'spawn' ? CARTLIB_CALL_WORLD_SPAWN : CARTLIB_CALL_NONE;
		}
		if (alias.module === CARTLIB_STATE_MACHINE_LIBRARY_MODULE && totalMemberCount === 1) {
			return trailingMember === 'register' ? CARTLIB_CALL_STATE_MACHINE_REGISTER : CARTLIB_CALL_NONE;
		}
		if (alias.module === CARTLIB_STATE_MACHINE_COMPONENT_MODULE && totalMemberCount === 1) {
			return trailingMember === 'factory' ? CARTLIB_CALL_STATE_MACHINE_FACTORY : CARTLIB_CALL_NONE;
		}
		if (alias.module === CARTLIB_BEHAVIOUR_TREE_LIBRARY_MODULE && totalMemberCount === 1) {
			return trailingMember === 'register' ? CARTLIB_CALL_BEHAVIOUR_TREE_REGISTER : CARTLIB_CALL_NONE;
		}
		if (alias.module === CARTLIB_BEHAVIOUR_TREE_COMPONENT_MODULE && totalMemberCount === 1) {
			return trailingMember === 'factory' ? CARTLIB_CALL_BEHAVIOUR_TREE_FACTORY : CARTLIB_CALL_NONE;
		}
		return CARTLIB_CALL_NONE;
	}

	public classifyComponentFactory(callExpression: LuaCallExpression): ComponentProgramKind | undefined {
		const callKind = this.classifyCartlibCall(callExpression);
		if (callKind === CARTLIB_CALL_STATE_MACHINE_FACTORY) {
			return 'state_machine';
		}
		if (callKind === CARTLIB_CALL_BEHAVIOUR_TREE_FACTORY) {
			return 'behaviour_tree';
		}
		return undefined;
	}

	private moduleAliasForName(name: string): ModuleAliasTarget {
		const decl = this.resolveName(name);
		return decl ? this.moduleAliasesByDeclId.get(decl.id) : null;
	}

	private immutableModuleAliasForName(name: string): ModuleAliasTarget {
		const decl = this.resolveName(name);
		return decl ? this.immutableModuleAliasesByDeclId.get(decl.id) : null;
	}

	private setModuleAlias(decl: InternalDecl, target: ModuleAliasTarget): void {
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

	private setImmutableModuleAlias(decl: InternalDecl, target: ModuleAliasTarget): void {
		if (target) {
			this.immutableModuleAliasesByDeclId.set(decl.id, target);
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

	private activateDecl(decl: InternalDecl): void {
		if (decl.active) {
			return;
		}
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

	private enterScope(range: LuaSourceRange, kind: ScopeKind): void {
		const scope: Scope = {
			id: this.nextScopeId,
			kind,
			range,
			parent: this.scopeStack.length > 0 ? this.scopeStack[this.scopeStack.length - 1] : null,
			bindings: new Map(),
		};
		this.nextScopeId += 1;
		this.scopeStack.push(scope);
	}

	private leaveScope(): void {
		this.scopeStack.pop();
	}
}

function buildTokenMap(tokens: readonly LuaToken[]): Map<string, TokenInfo> {
	const map = new Map<string, TokenInfo>();
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		const key = tokenKey(token.line, token.column);
		if (!map.has(key)) {
			map.set(key, { token, index });
		}
	}
	return map;
}

function tokenKey(line: number, column: number): string {
	return `${line}:${column}`;
}

function inferReferenceKind(ref: Ref): SemanticSymbolKind {
	if (ref.symbolKey.includes('.')) {
		return 'property';
	}
	return 'global';
}

function buildIdentifierRange(identifier: LuaIdentifierExpression, tokenMap: Map<string, TokenInfo>, path: string): LuaSourceRange {
	const info = tokenMap.get(tokenKey(identifier.range.start.line, identifier.range.start.column));
	const length = info ? info.token.lexeme.length : identifier.name.length;
	return buildRangeFromPosition(identifier.range.start, length, path);
}

function buildPropertyRange(member: LuaMemberExpression, tokenMap: Map<string, TokenInfo>, path: string): LuaSourceRange {
	const end = member.range.end;
	const start = { line: end.line, column: end.column - Math.max(0, member.identifier.length - 1) };
	const info = tokenMap.get(tokenKey(start.line, start.column));
	const length = info ? info.token.lexeme.length : member.identifier.length;
	return buildRangeFromPosition(start, length, path);
}

function buildRangeFromToken(tokenInfo: TokenInfo, path: string): LuaSourceRange {
	const token = tokenInfo.token;
	return buildRangeFromPosition({ line: token.line, column: token.column }, token.lexeme.length, path);
}

function buildRangeFromPosition(position: SourcePosition, length: number, path: string): LuaSourceRange {
	const endColumn = position.column + Math.max(length, 1) - 1;
	return {
		path,
		start: { line: position.line, column: position.column },
		end: { line: position.line, column: endColumn },
	};
}

function declToDefinitionInfo(decl: Decl): LuaDefinitionInfo {
	return {
		name: decl.name,
		namePath: decl.namePath.slice(),
		definition: cloneRange(decl.range),
		scope: cloneRange(decl.scope),
		kind: symbolKindToDefinitionKind(decl.kind),
	};
}

function cloneRange(range: LuaSourceRange): LuaSourceRange {
	return {
		path: range.path,
		start: { line: range.start.line, column: range.start.column },
		end: { line: range.end.line, column: range.end.column },
	};
}

function symbolKindToDefinitionKind(kind: SemanticSymbolKind): LuaDefinitionInfo['kind'] {
	switch (kind) {
		case 'parameter':
			return 'parameter';
		case 'function':
			return 'function';
		case 'property':
			return 'table_field';
		case 'constant':
			return 'constant';
		case 'type':
			return 'type';
		case 'global':
		case 'local':
		default:
			return 'variable';
	}
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

function fileSymbolKey(file: string, symbolKey: string): string {
	return `${file}|${symbolKey}`;
}

function appendSymbolKey(baseSymbolKey: string, member: string): string {
	return baseSymbolKey.length > 0 ? `${baseSymbolKey}.${member}` : member;
}

function buildModuleFileMap(files: readonly string[]): Map<string, string> {
	const modules = new Map<string, string>();
	for (let index = 0; index < files.length; index += 1) {
		const file = files[index];
		const modulePath = toLuaModulePath(file);
		if (!modules.has(modulePath)) {
			modules.set(modulePath, file);
		}
	}
	return modules;
}

class WorkspaceStringValueResolver {
	private readonly sources: ReadonlyMap<SymbolID, StaticStringSource>;
	private readonly moduleAliasTargetsByDeclId: ReadonlyMap<SymbolID, ModuleAliasTarget>;
	private readonly globalsByKey: ReadonlyMap<string, SymbolID>;
	private readonly files: ReadonlyMap<string, FileSemanticData>;
	private readonly moduleFiles: ReadonlyMap<string, string>;
	private readonly directDeclByFileAndKey: ReadonlyMap<string, SymbolID>;
	private readonly memberDeclByFileAndKey: ReadonlyMap<string, SymbolID>;
	private readonly values: Map<SymbolID, string> = new Map();
	private readonly resolvingDecls: Set<SymbolID> = new Set();
	private readonly resolvingModules: Set<string> = new Set();

	constructor(project: {
		files: ReadonlyMap<string, FileSemanticData>;
		globalsByKey: ReadonlyMap<string, SymbolID>;
		moduleFiles: ReadonlyMap<string, string>;
		directDeclByFileAndKey: ReadonlyMap<string, SymbolID>;
		memberDeclByFileAndKey: ReadonlyMap<string, SymbolID>;
		stringSourcesByDeclId: ReadonlyMap<SymbolID, StaticStringSource>;
		moduleAliasTargetsByDeclId: ReadonlyMap<SymbolID, ModuleAliasTarget>;
	}) {
		this.files = project.files;
		this.globalsByKey = project.globalsByKey;
		this.moduleFiles = project.moduleFiles;
		this.directDeclByFileAndKey = project.directDeclByFileAndKey;
		this.memberDeclByFileAndKey = project.memberDeclByFileAndKey;
		this.sources = project.stringSourcesByDeclId;
		this.moduleAliasTargetsByDeclId = project.moduleAliasTargetsByDeclId;
	}

	public resolve(source: StaticStringSource): string {
		switch (source.kind) {
			case 'literal':
				return source.value;
			case 'declaration':
				return this.resolveDeclaration(source.declId);
			case 'global': {
				const declId = this.globalsByKey.get(source.symbolKey);
				return declId ? this.resolveDeclaration(declId) : null;
			}
			case 'module':
				return this.resolveModuleMember(source);
		}
	}

	private resolveDeclaration(declId: SymbolID): string {
		const value = this.values.get(declId);
		if (value != null) {
			return value;
		}
		if (this.resolvingDecls.has(declId)) {
			return null;
		}
		const source = this.sources.get(declId);
		if (!source) {
			return null;
		}
		this.resolvingDecls.add(declId);
		const resolved = this.resolve(source);
		this.resolvingDecls.delete(declId);
		if (resolved != null) {
			this.values.set(declId, resolved);
		}
		return resolved;
	}

	private resolveModuleMember(source: Extract<StaticStringSource, { kind: 'module' }>): string {
		const resolutionKey = `${source.module}|${source.memberPath.join('.')}`;
		if (this.resolvingModules.has(resolutionKey)) {
			return null;
		}
		this.resolvingModules.add(resolutionKey);
		let resolved: string = null;
		const moduleFile = this.moduleFiles.get(source.module);
		if (moduleFile) {
			const data = this.files.get(moduleFile)!;
			const moduleRoot = resolveModuleReturnNamePath(data.chunk);
			if (moduleRoot) {
				const rootDeclId = moduleRoot.length > 0
					? this.directDeclByFileAndKey.get(fileSymbolKey(moduleFile, moduleRoot[0]))
					: null;
				const rootAlias = rootDeclId && this.moduleAliasTargetsByDeclId.get(rootDeclId);
				if (rootAlias) {
					resolved = this.resolve({
						kind: 'module',
						module: rootAlias.module,
						memberPath: rootAlias.memberPath.concat(moduleRoot.slice(1), source.memberPath),
					});
				} else {
					let symbolKey = joinNamePath(moduleRoot);
					for (let index = 0; index < source.memberPath.length; index += 1) {
						symbolKey = appendSymbolKey(symbolKey, source.memberPath[index]);
					}
					const key = fileSymbolKey(moduleFile, symbolKey);
					const declId = this.memberDeclByFileAndKey.get(key)
						?? this.directDeclByFileAndKey.get(key);
					if (declId) {
						resolved = this.resolveDeclaration(declId);
					}
				}
			}
		}
		this.resolvingModules.delete(resolutionKey);
		return resolved;
	}
}

function extractMetatableClassBaseExpressions(call: LuaCallExpression): {
	classExpression: LuaExpression;
	baseExpression: LuaExpression;
} {
	if (call.methodName
		|| resolveDirectCallName(call.callee) !== 'setmetatable'
		|| call.arguments.length !== 2) {
		return null;
	}
	const metatable = call.arguments[1];
	if (metatable.kind !== LuaSyntaxKind.TableConstructorExpression) {
		return null;
	}
	for (let fieldIndex = 0; fieldIndex < metatable.fields.length; fieldIndex += 1) {
		const field = metatable.fields[fieldIndex];
		if (field.kind === LuaTableFieldKind.IdentifierKey && field.name === '__index') {
			return {
				classExpression: call.arguments[0],
				baseExpression: field.value,
			};
		}
	}
	return null;
}

function resolveModuleReturnNamePath(chunk: LuaChunk): string[] | null {
	const statements = chunk.body;
	if (statements.length === 0) {
		return null;
	}
	const last = statements[statements.length - 1];
	if (last.kind !== LuaSyntaxKind.ReturnStatement) {
		return null;
	}
	const returnStatement = last as LuaReturnStatement;
	if (returnStatement.expressions.length !== 1) {
		return null;
	}
	const expression = returnStatement.expressions[0];
	return expression.kind === LuaSyntaxKind.TableConstructorExpression
		? []
		: extractStaticMemberPath(expression);
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
		base.push(expression.identifier);
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

function definitionLookupKey(range: LuaSourceRange, namePath: readonly string[]): string {
	return `${range.path}|${range.start.line}|${range.start.column}|${joinNamePath(namePath)}`;
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

function compareDefinitionInfo(a: LuaDefinitionInfo, b: LuaDefinitionInfo): number {
	if (a.definition.start.line !== b.definition.start.line) {
		return a.definition.start.line - b.definition.start.line;
	}
	if (a.definition.start.column !== b.definition.start.column) {
		return a.definition.start.column - b.definition.start.column;
	}
	return a.name.localeCompare(b.name);
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
		scope: cloneRange(internal.scope),
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
			return appendToNamePath(base, expression.identifier);
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

function buildFunctionNamePath(name: { identifiers: readonly string[]; methodName: string }): string[] {
	const identifiers = name.identifiers.slice();
	if (name.methodName) {
		identifiers.push(name.methodName);
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
): void {
	if (!path || path.length === 0) {
		return;
	}
	const params: string[] = [];
	for (let index = 0; index < expression.parameters.length; index += 1) {
		const parameter = expression.parameters[index];
		if (parameter.name.length > 0) {
			params.push(parameter.name);
		}
	}
	const minimumArgumentCount = inferMinimumArgumentCount(expression, params, signatures);
	registerFunctionSignatureExplicit(signatures, path, params, expression.hasVararg, minimumArgumentCount, declarationStyle);
	if (declarationStyle === 'method') {
		const dotPath = methodPathToPropertyPath(path);
		if (dotPath) {
			const extended = ['self', ...params];
			registerFunctionSignatureExplicit(signatures, dotPath, extended, expression.hasVararg, minimumArgumentCount + 1, 'function');
		}
	}
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
	if (expression.methodName) {
		const basePath = extractNamePath(expression.callee);
		return basePath ? `${joinNamePath(basePath)}:${expression.methodName}` : null;
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
	if (expression.kind !== LuaSyntaxKind.CallExpression || expression.methodName) {
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

function findFunctionNameToken(statement: LuaFunctionDeclarationStatement, tokens: readonly LuaToken[], tokenMap: Map<string, TokenInfo>): TokenInfo {
	const identifiers = statement.name.identifiers;
	const target = statement.name.methodName && statement.name.methodName.length > 0
		? statement.name.methodName
		: (identifiers.length > 0 ? identifiers[identifiers.length - 1] : null);
	if (!target) {
		return null;
	}
	const startLine = statement.range.start.line;
	const endLine = statement.functionExpression.range.start.line;
	let candidate: TokenInfo = null;
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (token.type !== LuaTokenType.Identifier) {
			continue;
		}
		if (token.lexeme !== target) {
			continue;
		}
		if (token.line < startLine || token.line > endLine) {
			continue;
		}
		const info = tokenMap.get(tokenKey(token.line, token.column));
		if (info) {
			candidate = info;
		}
	}
	return candidate;
}

function findFunctionNameIdentifierTokens(
	statement: LuaFunctionDeclarationStatement,
	identifiers: readonly string[],
	tokens: readonly LuaToken[],
	tokenMap: Map<string, TokenInfo>,
): TokenInfo[] {
	if (identifiers.length === 0) {
		return [];
	}
	const startLine = statement.range.start.line;
	const endLine = statement.functionExpression.range.start.line;
	const results: TokenInfo[] = [];
	let nextIdentifierIndex = 0;
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (token.line < startLine || token.line > endLine) {
			continue;
		}
		if (token.type !== LuaTokenType.Identifier) {
			continue;
		}
		if (token.lexeme !== identifiers[nextIdentifierIndex]) {
			continue;
		}
		const info = tokenMap.get(tokenKey(token.line, token.column));
		if (!info) {
			continue;
		}
		results.push(info);
		nextIdentifierIndex += 1;
		if (nextIdentifierIndex >= identifiers.length) {
			break;
		}
	}
	return results;
}

function findMethodToken(callExpression: LuaCallExpression, tokens: readonly LuaToken[], tokenMap: Map<string, TokenInfo>): TokenInfo {
	const methodName = callExpression.methodName;
	if (!methodName) {
		return null;
	}
	const rangeStartLine = callExpression.callee.range.start.line;
	const rangeEndLine = callExpression.range.end.line;
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (token.type !== LuaTokenType.Identifier) {
			continue;
		}
		if (token.lexeme !== methodName) {
			continue;
		}
		if (token.line < rangeStartLine || token.line > rangeEndLine) {
			continue;
		}
		const previous = index > 0 ? tokens[index - 1] : null;
		if (!previous || previous.type !== LuaTokenType.Colon) {
			continue;
		}
		const info = tokenMap.get(tokenKey(token.line, token.column));
		if (info) {
			return info;
		}
	}
	return null;
}

export class LuaSemanticWorkspace {
	private readonly index: LuaProjectIndex;
	private snapshot: LuaSemanticWorkspaceSnapshot = null;
	constructor() {
		this.index = new LuaProjectIndex();
	}

	public get version(): number {
		return this.index.getVersion();
	}

	public updateFile(file: string, source: string, lines?: readonly string[], parsed?: ParsedLuaChunk, version?: number): void {
		this.index.updateFile(file, source, lines, parsed, version);
		this.snapshot = null;
	}

	public updateFiles(files: readonly FileSemanticData[]): void {
		if (files.length === 0) {
			return;
		}
		this.index.updateFiles(files);
		this.snapshot = null;
	}

	public getFileData(file: string): FileSemanticData {
		return this.index.getFileData(file);
	}

	public getSnapshot(): LuaSemanticWorkspaceSnapshot {
		if (this.snapshot && this.snapshot.version === this.index.getVersion()) {
			return this.snapshot;
		}
		this.snapshot = createWorkspaceSnapshotFromIndex(this.index);
		return this.snapshot;
	}

	public listFiles(): string[] {
		return this.index.listFiles();
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
