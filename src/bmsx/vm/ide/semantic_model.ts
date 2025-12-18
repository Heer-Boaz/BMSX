import {
	LuaSyntaxKind,
	LuaTableFieldKind,
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
} from '../../lua/lua_ast';
import type { LuaToken } from '../../lua/luatoken';
import { LuaTokenType } from '../../lua/luatoken';
import { ide_state } from './ide_state';
import type { VMLuaSymbolEntry } from '../types';
import { computeSourceLabel } from './code_reference';
import { symbolCatalogDedupKey } from './vm_cart_editor';
import type { ParsedLuaChunk } from './lua_parse';
import { getCachedLuaParse } from './lua_analysis_cache';
import * as constants from './constants';
import { getActiveCodeTabContext } from './editor_tabs';
import { listGlobalLuaSymbols, listLuaSymbols } from './intellisense';
import { extractErrorMessage } from '../../lua/luavalue';

export type SymbolKind = 'parameter' | 'local' | 'function' | 'global' | 'tableField' | 'module' | 'type' | 'label' | 'keyword';

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
	declarationStyle: 'function' | 'method';
};

export type ModuleAliasEntry = {
	alias: string;
	module: string;
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
	isWrite: boolean;
};

export type FileSemanticData = {
	model: LuaSemanticModel;
	source: string;
	lines: readonly string[];
	annotations: SemanticAnnotations;
	decls: readonly Decl[];
	refs: readonly Ref[];
	moduleAliases: readonly ModuleAliasEntry[];
	callExpressions: readonly LuaCallExpression[];
	functionSignatures: ReadonlyMap<string, FunctionSignatureInfo>;
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
};

export function hydrateFileSemanticData(data: SerializedFileSemanticData): FileSemanticData {
	const signatureEntries = data.functionSignatures
		? new Map<string, FunctionSignatureInfo>(data.functionSignatures)
		: new Map<string, FunctionSignatureInfo>();
	const model = createSemanticModel({
		file: data.file,
		decls: data.decls,
		definitions: data.definitions,
		refs: data.refs,
		annotations: data.annotations,
		callExpressions: data.callExpressions ?? [],
		functionSignatures: signatureEntries,
	});
	return {
		model,
		source: data.source,
		lines: data.lines,
		annotations: data.annotations,
		decls: data.decls,
		refs: data.refs,
		moduleAliases: data.moduleAliases,
		callExpressions: data.callExpressions ?? [],
		functionSignatures: signatureEntries,
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
	namePath: string[];
	decl: InternalDecl;
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
	const moduleAliasEntries = collectModuleAliasesFromChunk(chunk);
	const moduleAliases: ModuleAliasEntry[] = [];
	for (const [alias, moduleName] of moduleAliasEntries) {
		moduleAliases.push({ alias, module: moduleName });
	}
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
		annotations,
		decls,
		refs,
		moduleAliases,
		callExpressions: result.callExpressions,
		functionSignatures: result.functionSignatures,
	};
}

export function buildLuaSemanticModel(source: string, path: string, lines?: readonly string[], parsed?: ParsedLuaChunk): LuaSemanticModel {
	const data = buildLuaFileSemanticData(source, path, lines, parsed);
	return data.model;
}

function collectModuleAliasesFromChunk(path: LuaChunk): Map<string, string> {
	const aliases = new Map<string, string>();
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
	return aliases;
}

function recordLocalRequireAliases(statement: LuaLocalAssignmentStatement, aliases: Map<string, string>): void {
	if (statement.values.length === 0) {
		return;
	}
	for (let index = 0; index < statement.names.length; index += 1) {
		const identifier = statement.names[index];
		const valueIndex = index < statement.values.length ? index : statement.values.length - 1;
		const moduleName = tryExtractRequireModuleName(statement.values[valueIndex]);
		if (moduleName) {
			aliases.set(identifier.name, moduleName);
		}
	}
}

function recordGlobalRequireAliases(statement: LuaAssignmentStatement, aliases: Map<string, string>): void {
	if (statement.right.length === 0) {
		return;
	}
	for (let index = 0; index < statement.left.length; index += 1) {
		const target = statement.left[index];
		if (target.kind !== LuaSyntaxKind.IdentifierExpression) {
			continue;
		}
		const valueIndex = index < statement.right.length ? index : statement.right.length - 1;
		const moduleName = tryExtractRequireModuleName(statement.right[valueIndex]);
		if (moduleName) {
			aliases.set((target as LuaIdentifierExpression).name, moduleName);
		}
	}
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
	private readonly globalsByKey: Map<string, SymbolID> = new Map();
	private readonly refsBySymbol: Map<SymbolID, Ref[]> = new Map();
	private readonly globalsSources: Map<string, Map<SymbolID, number>> = new Map();
	private readonly refsByGlobalKey: Map<string, Set<Ref>> = new Map();
	private readonly fileOrder: Map<string, number> = new Map();
	private version = 0;
	private nextFileOrder = 1;

	public updateFile(file: string, source: string, lines?: readonly string[], parsed?: ParsedLuaChunk, version?: number): LuaSemanticModel {
		const data = buildLuaFileSemanticData(source, file, lines, parsed, version);
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

	public symbolAt(file: string, position: Position): { id: SymbolID; decl: Decl } {
		const record = this.files.get(file);
		if (!record) {
			return null;
		}
		return this.findSymbolAt(record, position);
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
			this.retargetGlobalReferences(key, selected);
		}
	}

	private removeGlobalDecl(decl: Decl): void {
		const key = decl.symbolKey;
		const bucket = this.globalsSources.get(key);
		if (!bucket) {
			if (this.globalsByKey.get(key) === decl.id) {
				this.globalsByKey.delete(key);
				this.retargetGlobalReferences(key, null);
			}
			return;
		}
		bucket.delete(decl.id);
		if (bucket.size === 0) {
			this.globalsSources.delete(key);
			if (this.globalsByKey.get(key) === decl.id) {
				this.globalsByKey.delete(key);
				this.retargetGlobalReferences(key, null);
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
			this.retargetGlobalReferences(key, selected);
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

	private retargetGlobalReferences(key: string, symbolId: SymbolID): void {
		const bucket = this.refsByGlobalKey.get(key);
		if (!bucket || bucket.size === 0) {
			return;
		}
		for (const ref of bucket) {
			if (ref.target) {
				this.unregisterReference(ref.target, ref);
			}
			if (symbolId) {
				ref.target = symbolId;
				this.registerReference(symbolId, ref);
			} else {
				ref.target = null;
			}
		}
	}

	private getOrCreateGlobalRefSet(key: string): Set<Ref> {
		let bucket = this.refsByGlobalKey.get(key);
		if (!bucket) {
			bucket = new Set<Ref>();
			this.refsByGlobalKey.set(key, bucket);
		}
		return bucket;
	}

	private addReference(ref: Ref): void {
		if (ref.symbolKey.length > 0) {
			this.getOrCreateGlobalRefSet(ref.symbolKey).add(ref);
		}
		if (ref.target) {
			this.registerReference(ref.target, ref);
			return;
		}
		if (ref.symbolKey.length === 0) {
			return;
		}
		const target = this.globalsByKey.get(ref.symbolKey);
		if (!target) {
			return;
		}
		ref.target = target;
		this.registerReference(target, ref);
	}

	private removeReference(ref: Ref): void {
		if (ref.target) {
			this.unregisterReference(ref.target, ref);
		}
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

	private storeFileData(file: string, data: FileSemanticData): LuaSemanticModel {
		const current = this.files.get(file);
		if (current && current.source === data.source) {
			return current.data.model;
		}
		if (current) {
			this.removeFileData(current.data);
		}
		this.files.set(file, {
			source: data.source,
			data,
		});
		this.ensureFileOrder(file);
		this.applyFileData(data);
		this.version += 1;
		return data.model;
	}

	private findSymbolAt(record: FileRecord, position: Position): { id: SymbolID; decl: Decl } {
		const data = record.data;
		for (let declIndex = 0; declIndex < data.decls.length; declIndex += 1) {
			const decl = data.decls[declIndex]!;
			if (!positionInRange(position.line, position.column, decl.range)) {
				continue;
			}
			const stored = this.symbols.get(decl.id) ?? decl;
			return { id: decl.id, decl: stored };
		}
		for (let refIndex = 0; refIndex < data.refs.length; refIndex += 1) {
			const ref = data.refs[refIndex]!;
			if (!positionInRange(position.line, position.column, ref.range)) {
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
		if (positionInRange(row, column, decl.range)) {
			if (namePath && !namePathMatches(decl.namePath, namePath)) {
				continue;
			}
			return { id: decl.id, decl };
		}
	}
	for (let index = 0; index < refs.length; index += 1) {
		const ref = refs[index];
		if (!positionInRange(row, column, ref.range)) {
			continue;
		}
		if (namePath && !namePathMatches(ref.namePath, namePath)) {
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
		};
	}

	private visitStatement(statement: LuaStatement): void {
		switch (statement.kind) {
			case LuaSyntaxKind.LocalAssignmentStatement: {
				const localAssignment = statement;
				const pending: InternalDecl[] = [];
				for (let index = 0; index < localAssignment.names.length; index += 1) {
					const name = localAssignment.names[index];
					const decl = this.declareLocal(name, 'local', false);
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
					this.visitExpression(valueExpression, context);
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
				const basePath = functionDeclaration.name.identifiers.join('.');
				const methodName = functionDeclaration.name.methodName;
				const declarationPath = methodName
					? (basePath.length > 0 ? `${basePath}:${methodName}` : methodName)
					: basePath;
				this.recordFunctionSignature(declarationPath, functionDeclaration.functionExpression, methodName ? 'method' : 'function');
				this.visitFunctionExpression(functionDeclaration.functionExpression);
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
					this.visitExpression(valueExpression, context);
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
				this.callExpressions.push(callExpression);
				return null;
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

	private visitFunctionExpression(expression: LuaFunctionExpression): void {
		const block = expression.body;
		const scopeRange = block.range;
		this.enterScope(scopeRange, 'function');
		for (let index = 0; index < expression.parameters.length; index += 1) {
			this.declareParameter(expression.parameters[index]);
		}
		this.visitBlock(block);
		this.leaveScope();
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
			});
			return { decl: existing, namePath: existing.namePath, path: identifier.name };
		}
		const scope = this.currentScope();
		if (scope.kind === 'path') {
			const decl = this.declareGlobal(identifier, range);
			return { decl, namePath: decl.namePath, path: identifier.name };
		}
		this.recordReference({
			namePath: [identifier.name],
			name: identifier.name,
			range,
			target: null,
			isWrite: true,
		});
		return { decl: null, namePath: [identifier.name], path: identifier.name };
	}

	private assignMember(member: LuaMemberExpression): AssignmentTargetInfo {
		const baseInfo = this.visitExpression(member.base, { tableBaseDecl: null, tableBasePath: null });
		const basePath = baseInfo ? baseInfo.namePath : extractNamePath(member.base);
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
		});
		return { decl, namePath, path: joinNamePath(namePath) };
	}

	private assignIndex(indexExpression: LuaIndexExpression): AssignmentTargetInfo {
		const baseInfo = this.visitExpression(indexExpression.base, { tableBaseDecl: null, tableBasePath: null });
		this.visitExpression(indexExpression.index, { tableBaseDecl: null, tableBasePath: null });
		const namePath = baseInfo ? baseInfo.namePath : extractNamePath(indexExpression.base);
		return {
			decl: baseInfo ? baseInfo.decl : null,
			namePath,
			path: namePath ? joinNamePath(namePath) : null,
		};
	}

	private recordMethodReference(callExpression: LuaCallExpression, calleeInfo: ResolvedNamePath): void {
		const basePath = calleeInfo ? calleeInfo.namePath : extractNamePath(callExpression.callee);
		if (!basePath) {
			return;
		}
		const namePath = appendToNamePath(basePath, callExpression.methodName!);
		const tokenInfo = findMethodToken(callExpression, this.tokens, this.tokenMap);
		const range = tokenInfo ? buildRangeFromToken(tokenInfo, this.path) : callExpression.range;
		const key = joinNamePath(namePath);
		const decl = this.tableFields.get(key);
		const targetId = decl ? decl.id : null;
		this.recordReference({
			namePath,
			name: callExpression.methodName!,
			range,
			target: targetId,
			isWrite: false,
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
		const targetId = resolved ? resolved.id : null;
		if (resolved) {
			this.recordReference({
				namePath,
				name: identifier.name,
				range,
				target: targetId,
				isWrite,
			});
			return { namePath, decl: resolved };
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
			});
		} else {
			this.recordReference({
				namePath,
				name: identifier.name,
				range,
				target: null,
				isWrite,
			});
		}
		return { namePath, decl: globalDecl  };
	}

	private handleMemberExpression(member: LuaMemberExpression, context: ExpressionContext, isWrite: boolean): ResolvedNamePath {
		const baseInfo = this.visitExpression(member.base, context);
		const basePath = baseInfo ? baseInfo.namePath : extractNamePath(member.base);
		const namePath = basePath ? appendToNamePath(basePath, member.identifier) : [member.identifier];
		const range = buildPropertyRange(member, this.tokenMap, this.path);
		const key = joinNamePath(namePath);
		const decl = this.tableFields.get(key) ;
		const targetId = decl ? decl.id : null;
		this.recordReference({
			namePath,
			name: member.identifier,
			range,
			target: targetId,
			isWrite,
		});
		return { namePath, decl };
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

	private declareParameter(name: LuaIdentifierExpression): InternalDecl {
		const scope = this.currentScope();
		const range = buildIdentifierRange(name, this.tokenMap, this.path);
		const decl = this.createDecl({
			namePath: [name.name],
			name: name.name,
			kind: 'parameter',
			range,
			scopeRange: scope.range,
			scopeRef: scope,
			isGlobal: false,
			active: true,
		});
		this.addBinding(scope, decl);
		this.recordDefinitionAnnotation(decl);
		return decl;
	}

	private declareGlobal(identifier: LuaIdentifierExpression, range: LuaSourceRange): InternalDecl {
		const scope = this.currentScope();
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
	}): void {
		const ref: Ref = {
			file: this.path,
			name: options.name,
			namePath: options.namePath.slice(),
			symbolKey: joinNamePath(options.namePath),
			range: options.range,
			target: options.target,
			isWrite: options.isWrite,
		};
		this.refs.push(ref);
		const targetDecl = options.target ? this.declById.get(options.target)  : null;
		const kind = targetDecl ? targetDecl.kind : inferReferenceKind(ref);
		this.annotate(ref.range, ref.name.length, kind, 'usage');
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

function positionInRange(row: number, column: number, range: LuaSourceRange): boolean {
	if (row < range.start.line || row > range.end.line) {
		return false;
	}
	if (row === range.start.line && column !== null && column < range.start.column) {
		return false;
	}
	if (row === range.end.line && column !== null && column > range.end.column) {
		return false;
	}
	return true;
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

function buildFunctionNamePath(name: { identifiers: readonly string[]; methodName: string }): string[] {
	const identifiers = name.identifiers.slice();
	if (name.methodName) {
		identifiers.push(name.methodName);
	}
	return identifiers;
}

function convertMethodPathToProperty(path: string): string {
	const index = path.lastIndexOf(':');
	if (index === -1) {
		return null;
	}
	const prefix = path.slice(0, index);
	const suffix = path.slice(index + 1);
	return prefix.length > 0 ? `${prefix}.${suffix}` : suffix;
}

function registerFunctionSignatureExplicit(
	signatures: Map<string, FunctionSignatureInfo>,
	path: string,
	params: string[],
	hasVararg: boolean,
	declarationStyle: 'function' | 'method',
): void {
	if (!path || path.length === 0) {
		return;
	}
	signatures.set(path, { params, hasVararg, declarationStyle });
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
	registerFunctionSignatureExplicit(signatures, path, params, expression.hasVararg, declarationStyle);
	if (declarationStyle === 'method') {
		const dotPath = convertMethodPathToProperty(path);
		if (dotPath) {
			const extended = ['self', ...params];
			registerFunctionSignatureExplicit(signatures, dotPath, extended, expression.hasVararg, 'function');
		}
	}
}

function findFunctionNameToken(statement: LuaFunctionDeclarationStatement, tokens: readonly LuaToken[], tokenMap: Map<string, TokenInfo>): TokenInfo {
	const identifiers = statement.name.identifiers;
	const target = identifiers.length > 0 ? identifiers[identifiers.length - 1] : statement.name.methodName;
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
	constructor() {
		this.index = new LuaProjectIndex();
	}

	public get version(): number {
		return this.index.getVersion();
	}

	public updateFile(file: string, source: string, lines?: readonly string[], parsed?: ParsedLuaChunk, version?: number): LuaSemanticModel {
		return this.index.updateFile(file, source, lines, parsed, version);
	}

	public getModel(file: string): LuaSemanticModel {
		return this.index.getFileModel(file);
	}

	public symbolAt(file: string, row: number, column: number): { id: SymbolID; decl: Decl; } {
		return this.index.symbolAt(file, { line: row, column });
	}

	public findReferencesByPosition(file: string, row: number, column: number): { id: SymbolID; decl: Decl; references: readonly Ref[]; } {
		const symbol = this.symbolAt(file, row, column);
		if (!symbol) {
			return null;
		}
		const references = this.index.getReferences(symbol.id);
		return { id: symbol.id, decl: symbol.decl, references };
	}

	public getReferences(symbolId: SymbolID): readonly Ref[] {
		return this.index.getReferences(symbolId);
	}

	public getDecl(symbolId: SymbolID): Decl {
		return this.index.getDecl(symbolId);
	}

	public getFileData(file: string): FileSemanticData {
		return this.index.getFileData(file);
	}

	public listGlobalDecls(): readonly Decl[] {
		return this.index.listGlobalDecls();
	}

	public listFiles(): string[] {
		return this.index.listFiles();
	}
}

export function symbolPriority(kind: VMLuaSymbolEntry['kind']): number {
	switch (kind) {
		case 'table_field':
			return 5;
		case 'function':
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

export function symbolKindLabel(kind: VMLuaSymbolEntry['kind']): string {
	switch (kind) {
		case 'function':
			return 'FUNC';
		case 'table_field':
			return 'FIELD';
		case 'parameter':
			return 'PARAM';
		case 'variable':
			return 'VAR';
		case 'assignment':
		default:
			return 'SET';
	}
}

export function symbolSourceLabel(entry: VMLuaSymbolEntry): string {
	const path = entry.location.path;
	if (!path) {
		return null;
	}
	return computeSourceLabel(path, entry.location.path ?? '<anynomous>');
}

export function refreshSymbolCatalog(force: boolean): void {
	const scope: 'local' | 'global' = ide_state.symbolSearchGlobal ? 'global' : 'local';
	let path: string = null;
	if (scope === 'local') {
		const context = getActiveCodeTabContext();
		path = context.descriptor?.path;
	}
	const existing = ide_state.symbolCatalogContext;
	const unchanged = existing !== null
		&& existing.scope === scope
		&& (scope === 'global'
			|| existing.path === path);
	if (!force && unchanged) {
		return;
	}
	let entries: VMLuaSymbolEntry[] = [];
	try {
		if (scope === 'global') {
			entries = listGlobalLuaSymbols();
		} else {
			entries = listLuaSymbols(path);
		}
	} catch (error) {
		const message = extractErrorMessage(error);
		ide_state.symbolCatalog = [];
		ide_state.symbolSearchMatches = [];
		ide_state.symbolSearchSelectionIndex = -1;
		ide_state.symbolSearchDisplayOffset = 0;
		ide_state.symbolSearchHoverIndex = -1;
		ide_state.showMessage(`Failed to list symbols: ${message}`, constants.COLOR_STATUS_ERROR, 3.0);
		return;
	}
	ide_state.symbolCatalogContext = { scope, path };
	const deduped: VMLuaSymbolEntry[] = [];
	const seen = new Set<string>();
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		const key = symbolCatalogDedupKey(entry);
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		deduped.push(entry);
	}
	entries = deduped;
	const catalogEntries = entries.map((entry) => {
		const display = entry.path && entry.path.length > 0 ? entry.path : entry.name;
		const sourceLabel = scope === 'global' ? symbolSourceLabel(entry) : null;
		const combinedKey = sourceLabel
			? `${display} ${sourceLabel}`.toLowerCase()
			: display.toLowerCase();
		return {
			symbol: entry,
			displayName: display,
			searchKey: combinedKey,
			line: entry.location.range.startLine,
			kindLabel: symbolKindLabel(entry.kind),
			sourceLabel,
		};
	}).sort((a, b) => {
		if (a.line !== b.line) {
			return a.line - b.line;
		}
		if (a.displayName !== b.displayName) {
			return a.displayName.localeCompare(b.displayName);
		}
		const aSource = a.sourceLabel ?? '';
		const bSource = b.sourceLabel ?? '';
		return aSource.localeCompare(bSource);
	});
	ide_state.symbolCatalog = catalogEntries;
}
