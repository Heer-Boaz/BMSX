import {
	LuaBinaryOperator,
	LuaSyntaxKind,
	LuaTableFieldKind,
	LuaUnaryOperator,
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
	type LuaTableConstructorExpression,
	type LuaAssignmentStatement,
	type LuaLocalAssignmentStatement,
	type LuaStringLiteralExpression,
	type LuaFunctionDeclarationStatement,
	type LuaDefinitionInfo,
	type LuaSourceRange,
} from '../../../../lua/syntax/ast';
import type { LuaToken } from '../../../../lua/syntax/token';
import { LuaTokenType } from '../../../../lua/syntax/token';
import type { LuaSymbolEntry } from '../../../../machine/runtime/contracts';
import type { ParsedLuaChunk } from '../../../language/lua/parse';
import { getCachedLuaParse } from '../../../language/lua/analysis_cache';
import { luaNamePathMatches, luaPositionInRange, methodPathToPropertyPath } from './semantic_common';
import type { SemanticSymbolKind as SymbolKind } from './semantic_common';

export type { SemanticSymbolKind as SymbolKind } from './semantic_common';

export type SymbolID = string;

export type SemanticRole = 'definition' | 'usage';

export type TokenAnnotation = {
	start: number;
	end: number;
	kind: SymbolKind;
	role: SemanticRole;
};

export type SemanticAnnotations = Array<TokenAnnotation[]>;

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

export type SemanticHintKey = string;

export type DeclValueHintEntry = {
	declId: SymbolID;
	hintKey: SemanticHintKey;
};

export type PrefabClassEntry = {
	defId: string;
	classHintKey: SemanticHintKey;
};

export type ObjectBindingEntry = {
	objectId: string;
	prefabId: string;
};

export type ModuleAliasEntry = {
	alias: string;
	module: string;
	memberPath?: readonly string[];
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
	kind: SymbolKind;
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
	target: SymbolID;
	lexicalTarget?: SymbolID;
	isWrite: boolean;
	referenceKind: 'identifier' | 'member' | 'method';
	receiverSymbolKey?: string;
	receiverHintKey?: SemanticHintKey;
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
	declValueHints: readonly DeclValueHintEntry[];
	prefabClasses: readonly PrefabClassEntry[];
	objectBindings: readonly ObjectBindingEntry[];
};

export type SerializedFileSemanticData = {
	file: string;
	source: string;
	lines: readonly string[];
	annotations: SemanticAnnotations;
	decls: readonly Decl[];
	refs: readonly Ref[];
	definitions: readonly LuaDefinitionInfo[];
	moduleAliases: readonly ModuleAliasEntry[];
	callExpressions?: readonly LuaCallExpression[];
	functionSignatures?: ReadonlyArray<[string, FunctionSignatureInfo]>;
	declValueHints?: readonly DeclValueHintEntry[];
	prefabClasses?: readonly PrefabClassEntry[];
	objectBindings?: readonly ObjectBindingEntry[];
};

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
	private readonly dataByPath: ReadonlyMap<string, FileSemanticData>;
	private readonly declById: ReadonlyMap<SymbolID, Decl>;
	private readonly refsBySymbol: ReadonlyMap<SymbolID, readonly Ref[]>;
	private readonly globalDecls: readonly Decl[];

	constructor(version: number, files: readonly string[], sources: readonly LuaSemanticWorkspaceSourceSnapshot[]) {
		this.version = version;
		this.files = files;
		this.sources = sources;
		const dataByPath = new Map<string, FileSemanticData>();
		const declById = new Map<SymbolID, Decl>();
		const refsBySymbol = new Map<SymbolID, Ref[]>();
		const globalDecls: Decl[] = [];
		for (let index = 0; index < sources.length; index += 1) {
			const source = sources[index];
			dataByPath.set(source.path, source.analysis);
			for (let declIndex = 0; declIndex < source.analysis.decls.length; declIndex += 1) {
				const decl = source.analysis.decls[declIndex];
				declById.set(decl.id, decl);
				if (decl.isGlobal) {
					globalDecls.push(decl);
				}
			}
			for (let refIndex = 0; refIndex < source.analysis.refs.length; refIndex += 1) {
				const ref = source.analysis.refs[refIndex];
				if (!ref.target) {
					continue;
				}
				let bucket = refsBySymbol.get(ref.target);
				if (!bucket) {
					bucket = [];
					refsBySymbol.set(ref.target, bucket);
				}
				bucket.push(ref);
			}
		}
		this.dataByPath = dataByPath;
		this.declById = declById;
		this.refsBySymbol = refsBySymbol;
		this.globalDecls = globalDecls;
	}

	public getFileData(path: string): FileSemanticData {
		return this.dataByPath.get(path) ?? null;
	}

	public getDecl(symbolId: SymbolID): Decl {
		return this.declById.get(symbolId) ?? null;
	}

	public getReferences(symbolId: SymbolID): readonly Ref[] {
		return this.refsBySymbol.get(symbolId) ?? [];
	}

	public listGlobalDecls(): readonly Decl[] {
		return this.globalDecls;
	}

	public symbolAt(path: string, row: number, column: number): { id: SymbolID; decl: Decl } {
		const data = this.dataByPath.get(path);
		if (!data) {
			return null;
		}
		for (let declIndex = 0; declIndex < data.decls.length; declIndex += 1) {
			const decl = data.decls[declIndex];
			if (!luaPositionInRange(row, column, decl.range)) {
				continue;
			}
			return { id: decl.id, decl };
		}
		for (let refIndex = 0; refIndex < data.refs.length; refIndex += 1) {
			const ref = data.refs[refIndex];
			if (!ref.target || !luaPositionInRange(row, column, ref.range)) {
				continue;
			}
			const decl = this.declById.get(ref.target);
			if (!decl) {
				continue;
			}
			return { id: ref.target, decl };
		}
		return null;
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
	return new LuaSemanticWorkspaceSnapshot(index.getVersion(), files, sources);
}

export function buildLuaSemanticWorkspaceSnapshot(sources: ReadonlyArray<LuaSemanticWorkspaceSnapshotInput>): LuaSemanticWorkspaceSnapshot {
	const workspace = new LuaSemanticWorkspace();
	for (let index = 0; index < sources.length; index += 1) {
		const source = sources[index];
		if (source.analysis) {
			workspace.publishFileData(source.path, source.analysis);
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
		workspace.updateFile(source.path, parseEntry.source, parseEntry.lines, parseEntry.parsed, source.version);
	}
	return workspace.getSnapshot();
}

export function hydrateFileSemanticData(data: SerializedFileSemanticData): FileSemanticData {
	const parseEntry = getCachedLuaParse({
		path: data.file,
		source: data.source,
		lines: data.lines,
		withSyntaxError: false,
	});
	const signatureEntries = data.functionSignatures
		? new Map<string, FunctionSignatureInfo>(data.functionSignatures.map(([key, value]) => [key, {
			...value,
			minimumArgumentCount: value.minimumArgumentCount ?? value.params.length,
		}]))
		: new Map<string, FunctionSignatureInfo>();
	const moduleAliases = data.moduleAliases.map(normalizeModuleAliasEntry);
	const refs = data.refs.map(ref => ({
		...ref,
		referenceKind: ref.referenceKind ?? (ref.receiverSymbolKey || ref.receiverHintKey ? 'member' : 'identifier'),
	}));
	const model = createSemanticModel({
		file: data.file,
		decls: data.decls,
		definitions: data.definitions,
		refs,
		annotations: data.annotations,
		callExpressions: data.callExpressions ?? [],
		functionSignatures: signatureEntries,
	});
	return {
		model,
		source: data.source,
		lines: data.lines,
		parsed: parseEntry.parsed,
		chunk: parseEntry.parsed.chunk,
		annotations: data.annotations,
		decls: data.decls,
		refs,
		moduleAliases,
		callExpressions: data.callExpressions ?? [],
		functionSignatures: signatureEntries,
		declValueHints: data.declValueHints ?? [],
		prefabClasses: data.prefabClasses ?? [],
		objectBindings: data.objectBindings ?? [],
	};
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
};

type ResolvedNamePath = {
	namePath: string[] | null;
	decl: InternalDecl | null;
	hintKey: SemanticHintKey | null;
};

type ExpressionContext = {
	tableBaseDecl: InternalDecl;
	tableBasePath: readonly string[];
};

type AssignmentTargetInfo = {
	decl: InternalDecl;
	namePath: readonly string[];
	path: string | null;
};

type SemanticBuildResult = {
	decls: InternalDecl[];
	refs: Ref[];
	annotations: SemanticAnnotations;
	callExpressions: LuaCallExpression[];
	functionSignatures: Map<string, FunctionSignatureInfo>;
	declValueHints: DeclValueHintEntry[];
	prefabClasses: PrefabClassEntry[];
	objectBindings: ObjectBindingEntry[];
};

type Position = {
	line: number;
	column: number;
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
	const moduleAliases = collectModuleAliasEntriesFromChunk(chunk);
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
		moduleAliases,
		callExpressions: result.callExpressions,
		functionSignatures: result.functionSignatures,
		declValueHints: result.declValueHints,
		prefabClasses: result.prefabClasses,
		objectBindings: result.objectBindings,
	};
}

export function buildLuaSemanticModel(source: string, path: string, lines?: readonly string[], parsed?: ParsedLuaChunk): LuaSemanticModel {
	const data = buildLuaFileSemanticData(source, path, lines, parsed);
	return data.model;
}

type ModuleAliasResolution = {
	module: string;
	memberPath: string[];
};

export function collectModuleAliasEntriesFromChunk(path: LuaChunk): ModuleAliasEntry[] {
	const aliases = new Map<string, ModuleAliasEntry>();
	const statements = path.body;
	for (let index = 0; index < statements.length; index += 1) {
		const statement = statements[index];
		if (statement.kind === LuaSyntaxKind.LocalAssignmentStatement) {
			recordLocalRequireAliases(statement as LuaLocalAssignmentStatement, aliases);
			continue;
		}
		if (statement.kind === LuaSyntaxKind.AssignmentStatement) {
			recordGlobalRequireAliases(statement as LuaAssignmentStatement, aliases);
		}
	}
	return Array.from(aliases.values(), normalizeModuleAliasEntry);
}

function normalizeModuleAliasEntry(entry: ModuleAliasEntry): ModuleAliasEntry {
	return {
		alias: entry.alias,
		module: entry.module,
		memberPath: entry.memberPath ? entry.memberPath.slice() : [],
	};
}

function recordLocalRequireAliases(statement: LuaLocalAssignmentStatement, aliases: Map<string, ModuleAliasEntry>): void {
	if (statement.values.length === 0) {
		return;
	}
	for (let index = 0; index < statement.names.length; index += 1) {
		const identifier = statement.names[index];
		const valueIndex = index < statement.values.length ? index : statement.values.length - 1;
		const alias = tryResolveModuleAliasExpression(statement.values[valueIndex], aliases);
		if (alias) {
			aliases.set(identifier.name, {
				alias: identifier.name,
				module: alias.module,
				memberPath: alias.memberPath,
			});
		}
	}
}

function recordGlobalRequireAliases(statement: LuaAssignmentStatement, aliases: Map<string, ModuleAliasEntry>): void {
	if (statement.right.length === 0) {
		return;
	}
	for (let index = 0; index < statement.left.length; index += 1) {
		const target = statement.left[index];
		if (target.kind !== LuaSyntaxKind.IdentifierExpression) {
			continue;
		}
		const valueIndex = index < statement.right.length ? index : statement.right.length - 1;
		const alias = tryResolveModuleAliasExpression(statement.right[valueIndex], aliases);
		if (alias) {
			aliases.set((target as LuaIdentifierExpression).name, {
				alias: (target as LuaIdentifierExpression).name,
				module: alias.module,
				memberPath: alias.memberPath,
			});
		}
	}
}

function tryResolveModuleAliasExpression(expression: LuaExpression, aliases: ReadonlyMap<string, ModuleAliasEntry>): ModuleAliasResolution | null {
	const moduleName = tryExtractRequireModuleName(expression);
	if (moduleName) {
		return {
			module: moduleName,
			memberPath: [],
		};
	}
	if (expression.kind === LuaSyntaxKind.IdentifierExpression) {
		const alias = aliases.get(expression.name);
		if (!alias) {
			return null;
		}
		return {
			module: alias.module,
			memberPath: alias.memberPath ? alias.memberPath.slice() : [],
		};
	}
	if (expression.kind === LuaSyntaxKind.MemberExpression) {
		const base = tryResolveModuleAliasExpression(expression.base, aliases);
		if (!base) {
			return null;
		}
		base.memberPath.push(expression.identifier);
		return base;
	}
	if (expression.kind === LuaSyntaxKind.IndexExpression) {
		const base = tryResolveModuleAliasExpression(expression.base, aliases);
		if (!base) {
			return null;
		}
		const key = tryExtractStringLiteral(expression.index);
		if (!key) {
			return null;
		}
		base.memberPath.push(key);
		return base;
	}
	return null;
}

function tryExtractRequireModuleName(expression: LuaExpression): string {
	if (expression.kind !== LuaSyntaxKind.CallExpression) {
		return null;
	}
	const call = expression as LuaCallExpression;
	if (call.methodName) {
		return null;
	}
	const callee = call.callee;
	if (callee.kind !== LuaSyntaxKind.IdentifierExpression) {
		return null;
	}
	if ((callee as LuaIdentifierExpression).name.toLowerCase() !== 'require') {
		return null;
	}
	if (call.arguments.length === 0) {
		return null;
	}
	const firstArg = call.arguments[0];
	if (firstArg.kind !== LuaSyntaxKind.StringLiteralExpression) {
		return null;
	}
	const moduleName = (firstArg as LuaStringLiteralExpression).value.trim();
	return moduleName.length > 0 ? moduleName : null;
}

export class LuaProjectIndex {
	private readonly files: Map<string, FileRecord> = new Map();
	private readonly symbols: Map<SymbolID, Decl> = new Map();
	private readonly declByFileAndKey: Map<string, SymbolID> = new Map();
	private readonly globalsByKey: Map<string, SymbolID> = new Map();
	private readonly refsBySymbol: Map<SymbolID, Ref[]> = new Map();
	private readonly globalsSources: Map<string, Map<SymbolID, number>> = new Map();
	private readonly refsByGlobalKey: Map<string, Set<Ref>> = new Map();
	private readonly refsByReceiverSymbolKey: Map<string, Set<Ref>> = new Map();
	private readonly refsByReceiverHintKey: Map<string, Set<Ref>> = new Map();
	private readonly fileOrder: Map<string, number> = new Map();
	private declPathHints: Map<SymbolID, SemanticHintKey> = new Map();
	private prefabHintsById: Map<string, SemanticHintKey> = new Map();
	private objectHintsById: Map<string, SemanticHintKey> = new Map();
	private version = 0;
	private nextFileOrder = 1;

	public updateFile(file: string, source: string, lines?: readonly string[], parsed?: ParsedLuaChunk, version?: number): LuaSemanticModel {
		const data = buildLuaFileSemanticData(source, file, lines, parsed, version);
		return this.storeFileData(file, data);
	}

	public publishFileData(file: string, data: FileSemanticData): LuaSemanticModel {
		return this.storeFileData(file, data);
	}

	public applySerializedFileData(data: SerializedFileSemanticData): LuaSemanticModel {
		const hydrated = hydrateFileSemanticData(data);
		return this.storeFileData(data.file, hydrated);
	}

	public getFileModel(file: string): LuaSemanticModel {
		const record = this.files.get(file);
		return record ? record.data.model : null;
	}

	public getVersion(): number {
		return this.version;
	}

	public symbolAt(file: string, row: number, column: number): { id: SymbolID; decl: Decl } {
		const record = this.files.get(file);
		if (!record) {
			return null;
		}
		return this.findSymbolAt(record, row, column);
	}

	public getReferences(symbolId: SymbolID): readonly Ref[] {
		const refs = this.refsBySymbol.get(symbolId);
		return refs ? refs.slice() : [];
	}

	public getDecl(symbolId: SymbolID): Decl {
		const decl = this.symbols.get(symbolId);
		return decl ;
	}

	public getFileData(file: string): FileSemanticData {
		const record = this.files.get(file);
		return record ? record.data : null;
	}

	public listGlobalDecls(): Decl[] {
		const decls: Decl[] = [];
		for (const record of this.files.values()) {
			const fileDecls = record.data.decls;
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

	private registerReference(symbolId: SymbolID, ref: Ref): void {
		let bucket = this.refsBySymbol.get(symbolId);
		if (!bucket) {
			bucket = [];
			this.refsBySymbol.set(symbolId, bucket);
		}
		bucket.push(ref);
	}

	private unregisterReference(symbolId: SymbolID, ref: Ref): void {
		const bucket = this.refsBySymbol.get(symbolId);
		if (!bucket) {
			return;
		}
		for (let index = bucket.length - 1; index >= 0; index -= 1) {
			if (bucket[index] === ref) {
				bucket.splice(index, 1);
			}
		}
		if (bucket.length === 0) {
			this.refsBySymbol.delete(symbolId);
		}
	}

	private applyFileData(data: FileSemanticData): void {
		for (let i = 0; i < data.decls.length; i += 1) {
			const decl = data.decls[i];
			this.symbols.set(decl.id, decl);
			this.declByFileAndKey.set(fileSymbolKey(decl.file, decl.symbolKey), decl.id);
		}
		for (let i = 0; i < data.decls.length; i += 1) {
			const decl = data.decls[i];
			if (decl.isGlobal) {
				this.addGlobalDecl(decl);
			}
		}
		for (let i = 0; i < data.refs.length; i += 1) {
			this.addReference(data.refs[i]);
		}
	}

	private removeFileData(data: FileSemanticData): void {
		for (let i = 0; i < data.refs.length; i += 1) {
			this.removeReference(data.refs[i]);
		}
		for (let i = 0; i < data.decls.length; i += 1) {
			const decl = data.decls[i];
			this.symbols.delete(decl.id);
			this.declByFileAndKey.delete(fileSymbolKey(decl.file, decl.symbolKey));
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

	private getOrCreateGlobalRefSet(key: string): Set<Ref> {
		let bucket = this.refsByGlobalKey.get(key);
		if (!bucket) {
			bucket = new Set<Ref>();
			this.refsByGlobalKey.set(key, bucket);
		}
		return bucket;
	}

	private getOrCreateReceiverSymbolRefSet(key: string): Set<Ref> {
		let bucket = this.refsByReceiverSymbolKey.get(key);
		if (!bucket) {
			bucket = new Set<Ref>();
			this.refsByReceiverSymbolKey.set(key, bucket);
		}
		return bucket;
	}

	private getOrCreateReceiverHintRefSet(key: string): Set<Ref> {
		let bucket = this.refsByReceiverHintKey.get(key);
		if (!bucket) {
			bucket = new Set<Ref>();
			this.refsByReceiverHintKey.set(key, bucket);
		}
		return bucket;
	}

	private indexReferenceDependencies(ref: Ref): void {
		if (ref.receiverSymbolKey && ref.receiverSymbolKey.length > 0) {
			this.getOrCreateReceiverSymbolRefSet(ref.receiverSymbolKey).add(ref);
		}
		if (ref.receiverHintKey && ref.receiverHintKey.length > 0) {
			this.getOrCreateReceiverHintRefSet(ref.receiverHintKey).add(ref);
		}
	}

	private unindexReferenceDependencies(ref: Ref): void {
		if (ref.receiverSymbolKey && ref.receiverSymbolKey.length > 0) {
			const bucket = this.refsByReceiverSymbolKey.get(ref.receiverSymbolKey);
			if (bucket) {
				bucket.delete(ref);
				if (bucket.size === 0) {
					this.refsByReceiverSymbolKey.delete(ref.receiverSymbolKey);
				}
			}
		}
		if (ref.receiverHintKey && ref.receiverHintKey.length > 0) {
			const bucket = this.refsByReceiverHintKey.get(ref.receiverHintKey);
			if (bucket) {
				bucket.delete(ref);
				if (bucket.size === 0) {
					this.refsByReceiverHintKey.delete(ref.receiverHintKey);
				}
			}
		}
	}

	private addReference(ref: Ref): void {
		this.indexReferenceDependencies(ref);
		if (ref.symbolKey.length > 0) {
			this.getOrCreateGlobalRefSet(ref.symbolKey).add(ref);
		}
		if (ref.target) {
			this.registerReference(ref.target, ref);
		}
	}

	private removeReference(ref: Ref): void {
		if (ref.target) {
			this.unregisterReference(ref.target, ref);
		}
		this.unindexReferenceDependencies(ref);
		if (ref.symbolKey.length > 0) {
			const bucket = this.refsByGlobalKey.get(ref.symbolKey);
			if (bucket) {
				bucket.delete(ref);
				if (bucket.size === 0) {
					this.refsByGlobalKey.delete(ref.symbolKey);
				}
			}
		}
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

	private collectDirtySymbolKeysForFile(data: FileSemanticData, dirtyKeys: Set<string>): void {
		for (let index = 0; index < data.decls.length; index += 1) {
			const decl = data.decls[index];
			if (decl.isGlobal) {
				dirtyKeys.add(decl.symbolKey);
			}
		}
		const declsById = new Map<SymbolID, Decl>();
		for (let index = 0; index < data.decls.length; index += 1) {
			const decl = data.decls[index];
			declsById.set(decl.id, decl);
		}
		for (let index = 0; index < data.declValueHints.length; index += 1) {
			const entry = data.declValueHints[index];
			const decl = declsById.get(entry.declId);
			if (decl) {
				dirtyKeys.add(decl.symbolKey);
			}
		}
	}

	private collectFilesForGlobalKeys(keys: ReadonlySet<string>, files: Set<string>): void {
		for (const key of keys) {
			const bucket = this.refsByGlobalKey.get(key);
			if (!bucket) {
				continue;
			}
			for (const ref of bucket) {
				files.add(ref.file);
			}
		}
	}

	private collectFilesForReceiverSymbolKeys(keys: ReadonlySet<string>, files: Set<string>): void {
		for (const key of keys) {
			const bucket = this.refsByReceiverSymbolKey.get(key);
			if (!bucket) {
				continue;
			}
			for (const ref of bucket) {
				files.add(ref.file);
			}
		}
	}

	private collectFilesForReceiverHintKeys(keys: ReadonlySet<SemanticHintKey>, files: Set<string>): void {
		for (const key of keys) {
			const bucket = this.refsByReceiverHintKey.get(key);
			if (!bucket) {
				continue;
			}
			for (const ref of bucket) {
				files.add(ref.file);
			}
		}
	}

	private resolveReferenceTarget(file: string, ref: Ref): SymbolID {
		let targetId = ref.lexicalTarget ?? null;
		if (!targetId && ref.symbolKey.length > 0) {
			targetId = this.declByFileAndKey.get(fileSymbolKey(file, ref.symbolKey))
				?? this.globalsByKey.get(ref.symbolKey)
				?? null;
		}
		if (targetId) {
			return targetId;
		}
		const receiverPathHintKey = resolveReferenceReceiverPathHintKey(
			ref,
			file,
			this.declByFileAndKey,
			this.declPathHints,
			this.prefabHintsById,
			this.objectHintsById,
			this.globalsByKey,
		);
		if (!receiverPathHintKey) {
			return null;
		}
		const targetKey = appendSymbolKey(getPathHintSymbolKey(receiverPathHintKey), ref.name);
		return this.declByFileAndKey.get(fileSymbolKey(getPathHintFile(receiverPathHintKey), targetKey)) ?? null;
	}

	private refreshResolvedHintMaps(
		dirtyReceiverSymbolKeys: Set<string>,
		dirtyReceiverHintKeys: Set<SemanticHintKey>,
	): void {
		const previousPrefabHintsById = this.prefabHintsById;
		const previousObjectHintsById = this.objectHintsById;
		const previousDeclPathHints = this.declPathHints;
		const orderedFiles = this.listFiles();
		orderedFiles.sort((left, right) => this.fileOrder.get(left)! - this.fileOrder.get(right)!);

		const nextPrefabHintsById = new Map<string, SemanticHintKey>();
		for (let fileIndex = 0; fileIndex < orderedFiles.length; fileIndex += 1) {
			const data = this.files.get(orderedFiles[fileIndex])!.data;
			for (let entryIndex = 0; entryIndex < data.prefabClasses.length; entryIndex += 1) {
				const entry = data.prefabClasses[entryIndex];
				if (!nextPrefabHintsById.has(entry.defId)) {
					nextPrefabHintsById.set(entry.defId, entry.classHintKey);
				}
			}
		}

		const nextObjectHintsById = new Map<string, SemanticHintKey>();
		for (let fileIndex = 0; fileIndex < orderedFiles.length; fileIndex += 1) {
			const data = this.files.get(orderedFiles[fileIndex])!.data;
			for (let entryIndex = 0; entryIndex < data.objectBindings.length; entryIndex += 1) {
				const entry = data.objectBindings[entryIndex];
				if (nextObjectHintsById.has(entry.objectId)) {
					continue;
				}
				const classHintKey = nextPrefabHintsById.get(entry.prefabId);
				if (classHintKey) {
					nextObjectHintsById.set(entry.objectId, classHintKey);
				}
			}
		}

		const nextDeclPathHints = new Map<SymbolID, SemanticHintKey>();
		for (let fileIndex = 0; fileIndex < orderedFiles.length; fileIndex += 1) {
			const data = this.files.get(orderedFiles[fileIndex])!.data;
			for (let entryIndex = 0; entryIndex < data.declValueHints.length; entryIndex += 1) {
				const entry = data.declValueHints[entryIndex];
				const pathHintKey = resolveHintKeyToPathHintKey(entry.hintKey, nextPrefabHintsById, nextObjectHintsById);
				if (pathHintKey) {
					nextDeclPathHints.set(entry.declId, pathHintKey);
				}
			}
		}

		this.collectDirtyHintKeys(previousPrefabHintsById, nextPrefabHintsById, buildPrefabHintKey, dirtyReceiverHintKeys);
		this.collectDirtyHintKeys(previousObjectHintsById, nextObjectHintsById, buildObjectHintKey, dirtyReceiverHintKeys);
		this.collectDirtyDeclHintSymbolKeys(previousDeclPathHints, nextDeclPathHints, dirtyReceiverSymbolKeys);
		this.prefabHintsById = nextPrefabHintsById;
		this.objectHintsById = nextObjectHintsById;
		this.declPathHints = nextDeclPathHints;
	}

	private collectDirtyHintKeys(
		previous: ReadonlyMap<string, SemanticHintKey>,
		next: ReadonlyMap<string, SemanticHintKey>,
		buildHintKey: (key: string) => SemanticHintKey,
		dirtyKeys: Set<SemanticHintKey>,
	): void {
		for (const [key, value] of previous) {
			if (next.get(key) !== value) {
				dirtyKeys.add(buildHintKey(key));
			}
		}
		for (const [key, value] of next) {
			if (previous.get(key) !== value) {
				dirtyKeys.add(buildHintKey(key));
			}
		}
	}

	private collectDirtyDeclHintSymbolKeys(
		previous: ReadonlyMap<SymbolID, SemanticHintKey>,
		next: ReadonlyMap<SymbolID, SemanticHintKey>,
		dirtyKeys: Set<string>,
	): void {
		for (const [symbolId, value] of previous) {
			if (next.get(symbolId) === value) {
				continue;
			}
			const decl = this.symbols.get(symbolId);
			if (decl) {
				dirtyKeys.add(decl.symbolKey);
			}
		}
		for (const [symbolId, value] of next) {
			if (previous.get(symbolId) === value) {
				continue;
			}
			const decl = this.symbols.get(symbolId);
			if (decl) {
				dirtyKeys.add(decl.symbolKey);
			}
		}
	}

	private rebuildFileTargets(data: FileSemanticData): FileSemanticData {
		let nextRefs: Ref[] = null;
		for (let index = 0; index < data.refs.length; index += 1) {
			const ref = data.refs[index];
			const nextTarget = this.resolveReferenceTarget(data.model.file, ref);
			if (nextTarget === ref.target) {
				if (nextRefs) {
					nextRefs.push(ref);
				}
				continue;
			}
			if (!nextRefs) {
				nextRefs = data.refs.slice(0, index);
			}
			nextRefs.push({
				...ref,
				target: nextTarget,
			});
		}
		return nextRefs ? replaceFileSemanticDataRefs(data, nextRefs) : data;
	}

	private rebindAffectedFiles(files: ReadonlySet<string>): void {
		const replacements = new Map<string, FileSemanticData>();
		for (const file of files) {
			const record = this.files.get(file);
			if (!record) {
				continue;
			}
			const nextData = this.rebuildFileTargets(record.data);
			if (nextData !== record.data) {
				replacements.set(file, nextData);
			}
		}
		if (replacements.size === 0) {
			return;
		}
		// Older semantic frontends may still hold the previous FileSemanticData snapshot.
		// Re-publish affected files instead of mutating stored Ref objects in place.
		for (const [file, nextData] of replacements) {
			const current = this.files.get(file)!;
			this.removeFileData(current.data);
			this.files.set(file, {
				source: nextData.source,
				data: nextData,
			});
		}
		for (const nextData of replacements.values()) {
			this.applyFileData(nextData);
		}
	}

	private storeFileData(file: string, data: FileSemanticData): LuaSemanticModel {
		const current = this.files.get(file);
		if (current && current.source === data.source) {
			return current.data.model;
		}
		const dirtySymbolKeys = new Set<string>();
		if (current) {
			this.collectDirtySymbolKeysForFile(current.data, dirtySymbolKeys);
			this.removeFileData(current.data);
		}
		this.files.set(file, {
			source: data.source,
			data,
		});
		this.ensureFileOrder(file);
		this.collectDirtySymbolKeysForFile(data, dirtySymbolKeys);
		this.applyFileData(data);
		const dirtyReceiverHintKeys = new Set<SemanticHintKey>();
		this.refreshResolvedHintMaps(dirtySymbolKeys, dirtyReceiverHintKeys);
		const filesToRebind = new Set<string>([file]);
		this.collectFilesForGlobalKeys(dirtySymbolKeys, filesToRebind);
		this.collectFilesForReceiverSymbolKeys(dirtySymbolKeys, filesToRebind);
		this.collectFilesForReceiverHintKeys(dirtyReceiverHintKeys, filesToRebind);
		this.rebindAffectedFiles(filesToRebind);
		this.version += 1;
		return this.files.get(file)!.data.model;
	}

	private findSymbolAt(record: FileRecord, row: number, column: number): { id: SymbolID; decl: Decl } {
		const data = record.data;
		for (let declIndex = 0; declIndex < data.decls.length; declIndex += 1) {
			const decl = data.decls[declIndex]!;
			if (!luaPositionInRange(row, column, decl.range)) {
				continue;
			}
			const stored = this.symbols.get(decl.id) ?? decl;
			return { id: decl.id, decl: stored };
		}
		for (let refIndex = 0; refIndex < data.refs.length; refIndex += 1) {
			const ref = data.refs[refIndex]!;
			if (!luaPositionInRange(row, column, ref.range)) {
				continue;
			}
			const targetId = ref.target ?? (ref.symbolKey.length > 0 ? this.globalsByKey.get(ref.symbolKey)  : null);
			if (!targetId) {
				continue;
			}
			const decl = this.symbols.get(targetId);
			if (!decl) {
				continue;
			}
			return { id: targetId, decl };
		}
		return null;
	}
}

type FileRecord = {
	source: string;
	data: FileSemanticData;
};

function replaceFileSemanticDataRefs(data: FileSemanticData, refs: readonly Ref[]): FileSemanticData {
	const model = createSemanticModel({
		file: data.model.file,
		decls: data.decls,
		definitions: data.model.definitions,
		refs,
		annotations: data.annotations,
		callExpressions: data.callExpressions,
		functionSignatures: data.functionSignatures,
	});
	return {
		...data,
		model,
		refs,
	};
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
		callExpressions: callExpressions ?? [],
		functionSignatures: functionSignatures ?? new Map(),
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
		if (luaPositionInRange(row, column, decl.range)) {
			if (namePath && !luaNamePathMatches(decl.namePath, namePath)) {
				continue;
			}
			return { id: decl.id, decl };
		}
	}
	for (let index = 0; index < refs.length; index += 1) {
		const ref = refs[index];
		if (!luaPositionInRange(row, column, ref.range)) {
			continue;
		}
		if (namePath && !luaNamePathMatches(ref.namePath, namePath)) {
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

class SemanticBuilder {
	private readonly chunk: LuaChunk;
	private readonly path: string;
	private readonly tokens: readonly LuaToken[];
	private readonly annotations: SemanticAnnotations;
	private readonly tokenMap: Map<string, TokenInfo>;
	private readonly scopeStack: Scope[] = [];
	private readonly tableFields: Map<string, InternalDecl> = new Map();
	private readonly globalsByKey: Map<string, InternalDecl> = new Map();
	private readonly decls: InternalDecl[] = [];
	private readonly declById: Map<SymbolID, InternalDecl> = new Map();
	private readonly refs: Ref[] = [];
	private readonly callExpressions: LuaCallExpression[] = [];
	private readonly functionSignatures: Map<string, FunctionSignatureInfo> = new Map();
	private readonly methodSelfPathStack: (readonly string[] | null)[] = [];
	private readonly declValueHints: Map<SymbolID, SemanticHintKey> = new Map();
	private readonly prefabClasses: PrefabClassEntry[] = [];
	private readonly objectBindings: ObjectBindingEntry[] = [];
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
			declValueHints: Array.from(this.declValueHints.entries(), ([declId, hintKey]) => ({ declId, hintKey })),
			prefabClasses: this.prefabClasses,
			objectBindings: this.objectBindings,
		};
	}

	private visitStatement(statement: LuaStatement): void {
		switch (statement.kind) {
			case LuaSyntaxKind.LocalAssignmentStatement: {
				const localAssignment = statement;
				const pending: InternalDecl[] = [];
				for (let index = 0; index < localAssignment.names.length; index += 1) {
					const name = localAssignment.names[index];
					const kind = localAssignment.attributes[index] === 'const' ? 'constant' : 'local';
					const decl = this.declareLocal(name, kind, false);
					pending.push(decl);
				}
				const valueLimit = localAssignment.values.length;
				for (let index = 0; index < valueLimit; index += 1) {
					const valueExpression = localAssignment.values[index];
					const targetDecl = index < pending.length ? pending[index] : pending[pending.length - 1] ;
					if (valueExpression.kind === LuaSyntaxKind.FunctionExpression) {
						const nameIndex = index < localAssignment.names.length ? index : localAssignment.names.length - 1;
						const binding = localAssignment.names[nameIndex];
						const bindingName = binding ? binding.name : null;
						if (bindingName) {
							this.recordFunctionSignature(bindingName, valueExpression as LuaFunctionExpression, 'function');
						}
					}
					const context: ExpressionContext = {
						tableBaseDecl: targetDecl,
						tableBasePath: targetDecl ? targetDecl.namePath : null,
					};
					const valueInfo = this.visitExpression(valueExpression, context);
					if (targetDecl && valueInfo?.hintKey) {
						this.setDeclValueHint(targetDecl, valueInfo.hintKey);
					}
				}
				for (let index = 0; index < pending.length; index += 1) {
					this.activateDecl(pending[index]);
				}
				break;
			}
			case LuaSyntaxKind.LocalFunctionStatement: {
				const localFunction = statement;
				this.declareLocal(localFunction.name, 'function', true);
				this.recordFunctionSignature(localFunction.name.name, localFunction.functionExpression, 'function');
				this.visitFunctionExpression(localFunction.functionExpression);
				break;
			}
			case LuaSyntaxKind.FunctionDeclarationStatement: {
				const functionDeclaration = statement;
				const namePath = buildFunctionNamePath(functionDeclaration.name);
				const symbolKey = joinNamePath(namePath);
				const scope = this.currentScope();
				let decl = this.tableFields.get(symbolKey);
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
					this.tableFields.set(symbolKey, decl);
					if (isGlobal) {
						this.globalsByKey.set(symbolKey, decl);
					}
				}
				this.recordFunctionNameReferences(functionDeclaration);
				this.recordFunctionDeclarationWriteReference(functionDeclaration, decl);
				const basePath = functionDeclaration.name.identifiers.join('.');
				const methodName = functionDeclaration.name.methodName;
				const declarationPath = methodName
					? (basePath.length > 0 ? `${basePath}:${methodName}` : methodName)
					: basePath;
				this.recordFunctionSignature(declarationPath, functionDeclaration.functionExpression, methodName ? 'method' : 'function');
				const methodSelfPath = methodName ? functionDeclaration.name.identifiers.slice() : null;
				this.visitFunctionExpression(functionDeclaration.functionExpression, methodSelfPath);
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
					const valueExpression = assignment.right[index];
					if (valueExpression.kind === LuaSyntaxKind.FunctionExpression && targetInfo && targetInfo.path) {
						this.recordFunctionSignature(targetInfo.path, valueExpression as LuaFunctionExpression, 'function');
					}
					const valueInfo = this.visitExpression(valueExpression, context);
					if (targetInfo?.decl && valueInfo?.hintKey) {
						this.setDeclValueHint(targetInfo.decl, valueInfo.hintKey);
					}
				}
				break;
			}
			case LuaSyntaxKind.ReturnStatement: {
				const returnStatement = statement;
				for (let index = 0; index < returnStatement.expressions.length; index += 1) {
					this.visitExpression(returnStatement.expressions[index], { tableBaseDecl: null, tableBasePath: null });
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
				this.enterScope(forGeneric.block.range, 'loop');
				for (let index = 0; index < forGeneric.variables.length; index += 1) {
					this.declareLocal(forGeneric.variables[index], 'local', true);
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
				const calleeInfo = this.visitExpression(callExpression.callee, context);
				if (callExpression.methodName) {
					this.recordMethodReference(callExpression, calleeInfo);
				}
				for (let index = 0; index < callExpression.arguments.length; index += 1) {
					this.visitExpression(callExpression.arguments[index], { tableBaseDecl: null, tableBasePath: null });
				}
				this.recordBuiltinCallMetadata(callExpression);
				this.callExpressions.push(callExpression);
				const hintKey = this.resolveCallHintKey(callExpression);
				return hintKey
					? { namePath: null, decl: null, hintKey }
					: null;
			}
			case LuaSyntaxKind.FunctionExpression: {
				this.visitFunctionExpression(expression);
				return null;
			}
			case LuaSyntaxKind.TableConstructorExpression: {
				this.visitTableConstructorExpression(expression, context);
				return null;
			}
			case LuaSyntaxKind.BinaryExpression: {
				this.visitExpression(expression.left, context);
				this.visitExpression(expression.right, context);
				return null;
			}
			case LuaSyntaxKind.UnaryExpression: {
				this.visitExpression(expression.operand, context);
				return null;
			}
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
				case LuaTableFieldKind.Array:
					this.visitExpression(field.value, { tableBaseDecl: null, tableBasePath: null });
					break;
				case LuaTableFieldKind.IdentifierKey: {
					const baseDecl = context.tableBaseDecl;
					const basePath = context.tableBasePath;
					const namePath = basePath ? appendToNamePath(basePath, field.name) : [field.name];
					const decl = this.ensureTableField(namePath, field.range.start, field.name.length, baseDecl);
					const valueContext: ExpressionContext = {
						tableBaseDecl: decl,
						tableBasePath: decl.namePath,
					};
					this.visitExpression(field.value, valueContext);
					break;
				}
				case LuaTableFieldKind.ExpressionKey: {
					this.visitExpression(field.key, { tableBaseDecl: null, tableBasePath: null });
					this.visitExpression(field.value, { tableBaseDecl: null, tableBasePath: null });
					break;
				}
				default:
					break;
			}
		}
	}

	private visitFunctionExpression(expression: LuaFunctionExpression, methodSelfPath: readonly string[] = null): void {
		const block = expression.body;
		const scopeRange = block.range;
		this.enterScope(scopeRange, 'function');
		const inheritedMethodSelfPath = this.currentMethodSelfPath();
		const effectiveMethodSelfPath = methodSelfPath ?? inheritedMethodSelfPath;
		this.methodSelfPathStack.push(effectiveMethodSelfPath ? effectiveMethodSelfPath.slice() : null);
		for (let index = 0; index < expression.parameters.length; index += 1) {
			this.declareParameter(expression.parameters[index], expression.range);
		}
		this.visitBlock(block);
		this.methodSelfPathStack.pop();
		this.leaveScope();
	}

	private currentMethodSelfPath(): readonly string[] {
		if (this.methodSelfPathStack.length === 0) {
			return null;
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
		const baseDecl = baseInfo ? baseInfo.decl : null;
		const namePath = basePath ? appendToNamePath(basePath, member.identifier) : [member.identifier];
		const range = buildPropertyRange(member, this.tokenMap, this.path);
		const decl = this.ensureTableField(namePath, range.start, member.identifier.length, baseDecl);
		this.recordReference({
			namePath,
			name: member.identifier,
			range,
			target: decl.id,
			isWrite: true,
			referenceKind: 'member',
		});
		return { decl, namePath, path: joinNamePath(namePath) };
	}

	private assignIndex(indexExpression: LuaIndexExpression): AssignmentTargetInfo {
		const baseInfo = this.visitExpression(indexExpression.base, { tableBaseDecl: null, tableBasePath: null });
		this.visitExpression(indexExpression.index, { tableBaseDecl: null, tableBasePath: null });
		const namePath = resolveReferencedBasePath(baseInfo, indexExpression.base);
		return {
			decl: baseInfo ? baseInfo.decl : null,
			namePath,
			path: namePath ? joinNamePath(namePath) : null,
		};
	}

	private recordMethodReference(callExpression: LuaCallExpression, calleeInfo: ResolvedNamePath): void {
		let basePath = resolveReferencedBasePath(calleeInfo, callExpression.callee);
		if (basePath
			&& basePath.length === 1
			&& basePath[0] === 'self'
			&& (!calleeInfo || (!calleeInfo.decl && !calleeInfo.hintKey))) {
			const methodSelfPath = this.currentMethodSelfPath();
			if (methodSelfPath && methodSelfPath.length > 0) {
				basePath = methodSelfPath.slice();
			}
		}
		const receiverSymbolKey = calleeInfo?.decl
			? calleeInfo.decl.symbolKey
			: (calleeInfo?.namePath ? joinNamePath(calleeInfo.namePath) : null);
		const receiverHintKey = calleeInfo ? calleeInfo.hintKey : null;
		const namePath = basePath ? appendToNamePath(basePath, callExpression.methodName!) : [callExpression.methodName!];
		const tokenInfo = findMethodToken(callExpression, this.tokens, this.tokenMap);
		const range = tokenInfo ? buildRangeFromToken(tokenInfo, this.path) : callExpression.range;
		const key = joinNamePath(namePath);
		const decl = receiverHintKey && isPathHintKey(receiverHintKey) && getPathHintFile(receiverHintKey) !== this.path
			? null
			: this.tableFields.get(key);
		const targetId = decl ? decl.id : null;
		this.recordReference({
			namePath,
			name: callExpression.methodName!,
			range,
			target: targetId,
			isWrite: false,
			referenceKind: 'method',
			receiverSymbolKey,
			receiverHintKey,
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
		if (!resolved && identifier.name === 'self') {
			const methodSelfPath = this.currentMethodSelfPath();
			if (methodSelfPath && methodSelfPath.length > 0) {
				this.recordReference({
					namePath,
					name: identifier.name,
					range,
					target: null,
					isWrite,
					referenceKind: 'identifier',
				});
				return { namePath, decl: null, hintKey: buildPathHintKey(this.path, joinNamePath(methodSelfPath)) };
			}
		}
		const targetId = resolved ? resolved.id : null;
		if (resolved) {
			this.recordReference({
				namePath,
				name: identifier.name,
				range,
				target: targetId,
				isWrite,
				referenceKind: 'identifier',
			});
			return { namePath, decl: resolved, hintKey: this.getDeclValueHint(resolved) };
		}
		const globalDecl = this.globalsByKey.get(identifier.name);
		const target = globalDecl ? globalDecl.id : null;
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
				target: null,
				isWrite,
				referenceKind: 'identifier',
			});
		}
		return { namePath, decl: globalDecl, hintKey: globalDecl ? this.getDeclValueHint(globalDecl) : null };
	}

	private handleMemberExpression(member: LuaMemberExpression, context: ExpressionContext, isWrite: boolean): ResolvedNamePath {
		const baseInfo = this.visitExpression(member.base, context);
		const basePath = resolveReferencedBasePath(baseInfo, member.base);
		const namePath = basePath ? appendToNamePath(basePath, member.identifier) : [member.identifier];
		const range = buildPropertyRange(member, this.tokenMap, this.path);
		const key = joinNamePath(namePath);
		const decl = baseInfo?.hintKey && isPathHintKey(baseInfo.hintKey) && getPathHintFile(baseInfo.hintKey) !== this.path
			? null
			: this.tableFields.get(key);
		const targetId = decl ? decl.id : null;
		this.recordReference({
			namePath,
			name: member.identifier,
			range,
			target: targetId,
			isWrite,
			referenceKind: 'member',
			receiverSymbolKey: baseInfo?.decl ? baseInfo.decl.symbolKey : (baseInfo?.namePath ? joinNamePath(baseInfo.namePath) : null),
			receiverHintKey: baseInfo ? baseInfo.hintKey : null,
		});
		return { namePath, decl, hintKey: decl ? this.getDeclValueHint(decl) : null };
	}

	private handleIndexExpression(indexExpression: LuaIndexExpression, context: ExpressionContext): ResolvedNamePath {
		this.visitExpression(indexExpression.base, context);
		this.visitExpression(indexExpression.index, { tableBaseDecl: null, tableBasePath: null });
		return null;
	}

	private declareLocal(name: LuaIdentifierExpression, kind: SymbolKind, activate: boolean): InternalDecl {
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

	private ensureTableField(namePath: readonly string[], start: Position, length: number, baseDecl: InternalDecl): InternalDecl {
		const key = joinNamePath(namePath);
		const existing = this.tableFields.get(key);
		if (existing) {
			return existing;
		}
		const scope = baseDecl ? baseDecl.scopeRef : this.currentScope();
		const scopeRange = baseDecl ? baseDecl.scope : scope.range;
		const range = buildRangeFromPosition(start, length, this.path);
		const decl = this.createDecl({
			namePath: namePath,
			name: namePath[namePath.length - 1],
			kind: 'tableField',
			range,
			scopeRange,
			scopeRef: scope,
			isGlobal: baseDecl ? baseDecl.isGlobal : scope.kind === 'path',
			active: true,
		});
		this.tableFields.set(key, decl);
		if (decl.isGlobal) {
			this.globalsByKey.set(key, decl);
		}
		this.recordDefinitionAnnotation(decl);
		return decl;
	}

	private createDecl(options: {
		namePath: readonly string[];
		name: string;
		kind: SymbolKind;
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
		target: SymbolID;
		isWrite: boolean;
		referenceKind: 'identifier' | 'member' | 'method';
		receiverSymbolKey?: string;
		receiverHintKey?: SemanticHintKey;
	}): void {
		const targetDecl = options.target ? this.declById.get(options.target) : null;
		const ref: Ref = {
			file: this.path,
			name: options.name,
			namePath: options.namePath.slice(),
			symbolKey: joinNamePath(options.namePath),
			range: options.range,
			target: options.target,
			lexicalTarget: targetDecl && !targetDecl.isGlobal ? targetDecl.id : null,
			isWrite: options.isWrite,
			referenceKind: options.referenceKind,
			receiverSymbolKey: options.receiverSymbolKey,
			receiverHintKey: options.receiverHintKey,
		};
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
				targetDecl = this.tableFields.get(joinNamePath(namePath));
			}
			this.recordReference({
				namePath,
				name: identifier,
				range,
				target: targetDecl ? targetDecl.id : null,
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
			target: targetDecl ? targetDecl.id : null,
			isWrite: true,
			referenceKind: statement.name.methodName ? 'method' : (decl.namePath.length === 1 ? 'identifier' : 'member'),
		});
	}

	private setDeclValueHint(decl: InternalDecl, hintKey: SemanticHintKey): void {
		this.declValueHints.set(decl.id, hintKey);
	}

	private getDeclValueHint(decl: InternalDecl): SemanticHintKey {
		const hintKey = this.declValueHints.get(decl.id);
		return hintKey ? hintKey : null;
	}

	private resolveCallHintKey(callExpression: LuaCallExpression): SemanticHintKey {
		if (callExpression.methodName) {
			return null;
		}
		const calleeName = resolveDirectCallName(callExpression.callee);
		if (calleeName === 'oget' || calleeName === 'rget') {
			const objectId = tryExtractStringLiteral(callExpression.arguments[0]);
			return objectId ? buildObjectHintKey(objectId) : null;
		}
		if (calleeName === 'inst') {
			const prefabId = tryExtractStringLiteral(callExpression.arguments[0]);
			if (!prefabId) {
				return null;
			}
			const objectId = tryExtractObjectBindingId(callExpression);
			if (objectId) {
				return buildObjectHintKey(objectId);
			}
			return buildPrefabHintKey(prefabId);
		}
		return null;
	}

	private recordBuiltinCallMetadata(callExpression: LuaCallExpression): void {
		if (callExpression.methodName) {
			return;
		}
		const calleeName = resolveDirectCallName(callExpression.callee);
		if (calleeName === 'define_prefab') {
			const prefabClass = tryExtractPrefabClassEntry(callExpression, this.path);
			if (prefabClass) {
				this.prefabClasses.push(prefabClass);
			}
			return;
		}
		if (calleeName === 'inst') {
			const prefabId = tryExtractStringLiteral(callExpression.arguments[0]);
			const objectId = tryExtractObjectBindingId(callExpression);
			if (prefabId && objectId) {
				this.objectBindings.push({ objectId, prefabId });
			}
		}
	}

	private annotate(range: LuaSourceRange, length: number, kind: SymbolKind, role: SemanticRole): void {
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

function inferReferenceKind(ref: Ref): SymbolKind {
	if (ref.symbolKey.includes('.')) {
		return 'tableField';
	}
	return 'global';
}

function buildIdentifierRange(identifier: LuaIdentifierExpression, tokenMap: Map<string, TokenInfo>, path: string): LuaSourceRange {
	const info = tokenMap.get(tokenKey(identifier.range.start.line, identifier.range.start.column));
	const length = info ? info.token.lexeme.length : identifier.name.length;
	return buildRangeFromPosition(identifier.range.start, length, path);
}

function buildPropertyRange(member: LuaMemberExpression, tokenMap: Map<string, TokenInfo>, path: string): LuaSourceRange {
	const start = member.range.end;
	const info = tokenMap.get(tokenKey(start.line, start.column));
	const length = info ? info.token.lexeme.length : member.identifier.length;
	return buildRangeFromPosition(start, length, path);
}

function buildRangeFromToken(tokenInfo: TokenInfo, path: string): LuaSourceRange {
	const token = tokenInfo.token;
	return buildRangeFromPosition({ line: token.line, column: token.column }, token.lexeme.length, path);
}

function buildRangeFromPosition(position: Position, length: number, path: string): LuaSourceRange {
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

function symbolKindToDefinitionKind(kind: SymbolKind): LuaDefinitionInfo['kind'] {
	switch (kind) {
		case 'parameter':
			return 'parameter';
		case 'function':
			return 'function';
		case 'tableField':
			return 'table_field';
		case 'constant':
			return 'constant';
		case 'global':
		case 'local':
		default:
			return 'variable';
	}
}

function createSymbolId(file: string, range: LuaSourceRange, kind: SymbolKind, namePath: readonly string[]): SymbolID {
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

const PATH_HINT_PREFIX = 'p:';
const PREFAB_HINT_PREFIX = 'f:';
const OBJECT_HINT_PREFIX = 'o:';

function buildPathHintKey(file: string, symbolKey: string): SemanticHintKey {
	return `${PATH_HINT_PREFIX}${file}|${symbolKey}`;
}

function buildPrefabHintKey(defId: string): SemanticHintKey {
	return `${PREFAB_HINT_PREFIX}${defId}`;
}

function buildObjectHintKey(objectId: string): SemanticHintKey {
	return `${OBJECT_HINT_PREFIX}${objectId}`;
}

function isPathHintKey(hintKey: SemanticHintKey): boolean {
	return hintKey.startsWith(PATH_HINT_PREFIX);
}

function isPrefabHintKey(hintKey: SemanticHintKey): boolean {
	return hintKey.startsWith(PREFAB_HINT_PREFIX);
}

function isObjectHintKey(hintKey: SemanticHintKey): boolean {
	return hintKey.startsWith(OBJECT_HINT_PREFIX);
}

function getHintPayload(hintKey: SemanticHintKey): string {
	return hintKey.slice(2);
}

function getPathHintSeparatorIndex(hintKey: SemanticHintKey): number {
	return hintKey.indexOf('|', 2);
}

function getPathHintFile(hintKey: SemanticHintKey): string {
	return hintKey.slice(2, getPathHintSeparatorIndex(hintKey));
}

function getPathHintSymbolKey(hintKey: SemanticHintKey): string {
	return hintKey.slice(getPathHintSeparatorIndex(hintKey) + 1);
}

function getPathHintSymbolKeyParts(hintKey: SemanticHintKey): string[] {
	return getPathHintSymbolKey(hintKey).split('.');
}

function appendSymbolKey(baseSymbolKey: string, member: string): string {
	return baseSymbolKey.length > 0 ? `${baseSymbolKey}.${member}` : member;
}

function resolveHintKeyToPathHintKey(
	hintKey: SemanticHintKey,
	prefabClasses: ReadonlyMap<string, SemanticHintKey>,
	objectClasses: ReadonlyMap<string, SemanticHintKey>,
): SemanticHintKey {
	if (isPathHintKey(hintKey)) {
		return hintKey;
	}
	if (isPrefabHintKey(hintKey)) {
		const pathHintKey = prefabClasses.get(getHintPayload(hintKey));
		return pathHintKey ? pathHintKey : null;
	}
	if (isObjectHintKey(hintKey)) {
		const pathHintKey = objectClasses.get(getHintPayload(hintKey));
		return pathHintKey ? pathHintKey : null;
	}
	return null;
}

function resolveReferenceReceiverPathHintKey(
	ref: Ref,
	file: string,
	declByFileAndKey: ReadonlyMap<string, SymbolID>,
	declHints: ReadonlyMap<SymbolID, SemanticHintKey>,
	prefabClasses: ReadonlyMap<string, SemanticHintKey>,
	objectClasses: ReadonlyMap<string, SemanticHintKey>,
	globalsByKey: ReadonlyMap<string, SymbolID>,
): SemanticHintKey {
	if (ref.receiverHintKey) {
		const resolved = resolveHintKeyToPathHintKey(ref.receiverHintKey, prefabClasses, objectClasses);
		if (resolved) {
			return resolved;
		}
	}
	if (!ref.receiverSymbolKey || ref.receiverSymbolKey.length === 0) {
		return null;
	}
	const localDeclId = declByFileAndKey.get(fileSymbolKey(file, ref.receiverSymbolKey));
	if (localDeclId) {
		const resolved = declHints.get(localDeclId);
		if (resolved) {
			return resolved;
		}
	}
	const globalDeclId = globalsByKey.get(ref.receiverSymbolKey);
	if (!globalDeclId) {
		return null;
	}
	const hintKey = declHints.get(globalDeclId);
	return hintKey ? hintKey : null;
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
	if (baseInfo?.hintKey && isPathHintKey(baseInfo.hintKey)) {
		return getPathHintSymbolKeyParts(baseInfo.hintKey);
	}
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

function tryExtractStringLiteral(expression: LuaExpression): string {
	if (!expression || expression.kind !== LuaSyntaxKind.StringLiteralExpression) {
		return null;
	}
	return expression.value;
}

function tryExtractObjectBindingId(callExpression: LuaCallExpression): string {
	if (callExpression.arguments.length < 2) {
		return null;
	}
	const options = callExpression.arguments[1];
	if (!options || options.kind !== LuaSyntaxKind.TableConstructorExpression) {
		return null;
	}
	for (let index = 0; index < options.fields.length; index += 1) {
		const field = options.fields[index];
		if (field.kind !== LuaTableFieldKind.IdentifierKey || field.name !== 'id') {
			continue;
		}
		return tryExtractStringLiteral(field.value);
	}
	return null;
}

function tryExtractPrefabClassEntry(callExpression: LuaCallExpression, file: string): PrefabClassEntry {
	if (callExpression.arguments.length === 0) {
		return null;
	}
	const descriptor = callExpression.arguments[0];
	if (!descriptor || descriptor.kind !== LuaSyntaxKind.TableConstructorExpression) {
		return null;
	}
	let defId: string = null;
	let classPath: string[] = null;
	for (let index = 0; index < descriptor.fields.length; index += 1) {
		const field = descriptor.fields[index];
		if (field.kind !== LuaTableFieldKind.IdentifierKey) {
			continue;
		}
		if (field.name === 'def_id') {
			defId = tryExtractStringLiteral(field.value);
			continue;
		}
		if (field.name === 'class') {
			classPath = extractNamePath(field.value);
		}
	}
	if (!defId || !classPath || classPath.length === 0) {
		return null;
	}
	return {
		defId,
		classHintKey: buildPathHintKey(file, joinNamePath(classPath)),
	};
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
					return expressionHasUnsafeParameterUse(expression.left, parameterName, signatures, false)
						|| expressionHasUnsafeParameterUse(expression.right, parameterName, signatures, false);
				case LuaBinaryOperator.Or:
					if (expressionContainsParameter(expression.left, parameterName)
						&& !expressionHasUnsafeParameterUse(expression.left, parameterName, signatures, false)) {
						return expressionHasUnsafeParameterUse(expression.right, parameterName, signatures, false);
					}
					return expressionHasUnsafeParameterUse(expression.left, parameterName, signatures, false)
						|| expressionHasUnsafeParameterUse(expression.right, parameterName, signatures, false);
				case LuaBinaryOperator.Equal:
				case LuaBinaryOperator.NotEqual:
					return expressionHasUnsafeParameterUse(expression.left, parameterName, signatures, false)
						|| expressionHasUnsafeParameterUse(expression.right, parameterName, signatures, false);
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

	public updateFile(file: string, source: string, lines?: readonly string[], parsed?: ParsedLuaChunk, version?: number): LuaSemanticModel {
		const model = this.index.updateFile(file, source, lines, parsed, version);
		this.snapshot = null;
		return model;
	}

	public publishFileData(file: string, data: FileSemanticData): LuaSemanticModel {
		const model = this.index.publishFileData(file, data);
		this.snapshot = null;
		return model;
	}

	public getModel(file: string): LuaSemanticModel {
		return this.index.getFileModel(file);
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
