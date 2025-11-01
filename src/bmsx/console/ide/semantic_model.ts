import { LuaLexer } from '../../lua/lexer.ts';
import { LuaParser } from '../../lua/parser.ts';
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
	type LuaFunctionDeclarationStatement,
	type LuaDefinitionInfo,
	type LuaSourceRange,
} from '../../lua/ast.ts';
import type { LuaToken } from '../../lua/token.ts';
import { LuaTokenType } from '../../lua/token.ts';

export type SymbolKind = 'parameter' | 'local' | 'function' | 'global' | 'tableField';

export type SymbolID = string;

export type SemanticRole = 'definition' | 'usage';

export type TokenAnnotation = {
	start: number;
	end: number;
	kind: SymbolKind;
	role: SemanticRole;
};

export type SemanticAnnotations = Array<TokenAnnotation[] | undefined>;

export type LuaReferenceLookupResult = {
	definition: LuaDefinitionInfo | null;
	references: LuaSourceRange[];
};

export type LuaSemanticModel = {
	file: string;
	annotations: SemanticAnnotations;
	decls: readonly Decl[];
	refs: readonly Ref[];
	definitions: readonly LuaDefinitionInfo[];
	lookupIdentifier(row: number, column: number | null, namePath: readonly string[]): LuaDefinitionInfo | null;
	lookupReferences(row: number, column: number | null, namePath: readonly string[]): LuaReferenceLookupResult;
	getDefinitionReferences(definition: LuaDefinitionInfo): LuaSourceRange[];
	symbolAt(row: number, column: number): { id: SymbolID; decl: Decl } | null;
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
	target: SymbolID | null;
	isWrite: boolean;
};

export type FileSemanticData = {
	model: LuaSemanticModel;
	source: string;
	lines: readonly string[];
	annotations: SemanticAnnotations;
	decls: readonly Decl[];
	refs: readonly Ref[];
};

type ScopeKind = 'chunk' | 'function' | 'block' | 'loop';

type Scope = {
	id: number;
	kind: ScopeKind;
	range: LuaSourceRange;
	parent: Scope | null;
	bindings: Map<string, InternalDecl[]>;
};

type InternalDecl = Decl & {
	scopeRef: Scope;
	active: boolean;
};

type ResolvedNamePath = {
	namePath: string[];
	decl: InternalDecl | null;
};

type ExpressionContext = {
	tableBaseDecl: InternalDecl | null;
	tableBasePath: readonly string[] | null;
};

type AssignmentTargetInfo = {
	decl: InternalDecl | null;
	namePath: readonly string[] | null;
};

type SemanticBuildResult = {
	decls: InternalDecl[];
	refs: Ref[];
	annotations: SemanticAnnotations;
};

type Position = {
	line: number;
	column: number;
};

type TokenInfo = {
	token: LuaToken;
	index: number;
};

export function buildLuaFileSemanticData(source: string, chunkName: string): FileSemanticData {
	const normalized = normalizeSource(source);
	const lines = normalized.split('\n');
	const lexer = new LuaLexer(normalized, chunkName);
	const tokens = lexer.scanTokens();
	const parser = new LuaParser(tokens, chunkName, normalized);
	const chunk = parser.parseChunk();
	const builder = new SemanticBuilder({
		chunk,
		chunkName,
		tokens,
		lines,
	});
	const result = builder.build();
	const decls = result.decls.map(toDecl);
	const definitions = decls.map(decl => declToDefinitionInfo(decl));
	definitions.sort(compareDefinitionInfo);
	const refs = result.refs.slice();
	const annotations = finalizeAnnotations(result.annotations);
	const model: LuaSemanticModel = createSemanticModel({
		file: chunkName,
		decls,
		definitions,
		refs,
		annotations,
	});
	return {
		model,
		source: normalized,
		lines,
		annotations,
		decls,
		refs,
	};
}

export function buildLuaSemanticModel(source: string, chunkName: string): LuaSemanticModel {
	const data = buildLuaFileSemanticData(source, chunkName);
	return data.model;
}

export class LuaProjectIndex {
	private readonly files: Map<string, FileRecord> = new Map();
	private readonly symbols: Map<SymbolID, Decl> = new Map();
	private readonly globalsByKey: Map<string, SymbolID> = new Map();
	private readonly refsBySymbol: Map<SymbolID, Ref[]> = new Map();
	private globalsDirty = false;

	public updateFile(file: string, source: string): LuaSemanticModel {
		const data = buildLuaFileSemanticData(source, file);
		this.files.set(file, {
			source,
			data,
		});
		this.globalsDirty = true;
		return data.model;
	}

	public removeFile(file: string): void {
		this.files.delete(file);
		this.globalsDirty = true;
	}

	public getFileModel(file: string): LuaSemanticModel | null {
		const record = this.files.get(file);
		return record ? record.data.model : null;
	}

	public getDefinitionAt(file: string, position: Position): Decl | null {
		this.ensureGlobals();
		const record = this.files.get(file);
		if (!record) {
			return null;
		}
		const result = this.findSymbolAt(record, position);
		return result ? result.decl : null;
	}

	public symbolAt(file: string, position: Position): { id: SymbolID; decl: Decl } | null {
		this.ensureGlobals();
		const record = this.files.get(file);
		if (!record) {
			return null;
		}
		return this.findSymbolAt(record, position);
	}

	public getReferences(symbolId: SymbolID): readonly Ref[] {
		this.ensureGlobals();
		const refs = this.refsBySymbol.get(symbolId);
		return refs ? refs.slice() : [];
	}

	public getDecl(symbolId: SymbolID): Decl | null {
		this.ensureGlobals();
		const decl = this.symbols.get(symbolId);
		return decl ?? null;
	}

	public listFileDecls(file: string): readonly Decl[] {
		const record = this.files.get(file);
		if (!record) {
			return [];
		}
		return record.data.decls;
	}

	public getFileData(file: string): FileSemanticData | null {
		this.ensureGlobals();
		const record = this.files.get(file);
		return record ? record.data : null;
	}

	public listFiles(): string[] {
		return Array.from(this.files.keys());
	}

	private ensureGlobals(): void {
		if (!this.globalsDirty) {
			return;
		}
		this.rebuild();
		this.globalsDirty = false;
	}

	private rebuild(): void {
		this.symbols.clear();
		this.globalsByKey.clear();
		this.refsBySymbol.clear();

		const records = Array.from(this.files.values());
		for (let recordIndex = 0; recordIndex < records.length; recordIndex += 1) {
			const data = records[recordIndex]!.data;
			for (let declIndex = 0; declIndex < data.decls.length; declIndex += 1) {
				const decl = data.decls[declIndex]!;
				this.symbols.set(decl.id, decl);
				if (decl.isGlobal && !this.globalsByKey.has(decl.symbolKey)) {
					this.globalsByKey.set(decl.symbolKey, decl.id);
				}
			}
		}
		for (let recordIndex = 0; recordIndex < records.length; recordIndex += 1) {
			const data = records[recordIndex]!.data;
			for (let refIndex = 0; refIndex < data.refs.length; refIndex += 1) {
				const ref = data.refs[refIndex]!;
				if (ref.target) {
					this.registerReference(ref.target, ref);
					continue;
				}
				if (ref.symbolKey.length === 0) {
					continue;
				}
				const targetId = this.globalsByKey.get(ref.symbolKey);
				if (!targetId) {
					continue;
				}
				ref.target = targetId;
				this.registerReference(targetId, ref);
			}
		}
	}

	private registerReference(symbolId: SymbolID, ref: Ref): void {
		let bucket = this.refsBySymbol.get(symbolId);
		if (!bucket) {
			bucket = [];
			this.refsBySymbol.set(symbolId, bucket);
		}
		bucket.push(ref);
	}

	private findSymbolAt(record: FileRecord, position: Position): { id: SymbolID; decl: Decl } | null {
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
			const targetId = ref.target ?? (ref.symbolKey.length > 0 ? this.globalsByKey.get(ref.symbolKey) ?? null : null);
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
}): LuaSemanticModel {
	const { file, decls, definitions, refs, annotations } = options;
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
	const lookupDefinition = (row: number, column: number | null, namePath: readonly string[]): LuaDefinitionInfo | null => {
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
		return info ?? null;
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
		lookupIdentifier(row: number, column: number | null, namePath: readonly string[]): LuaDefinitionInfo | null {
			return lookupDefinition(row, column, namePath);
		},
		lookupReferences(row: number, column: number | null, namePath: readonly string[]): LuaReferenceLookupResult {
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
		symbolAt(row: number, column: number): { id: SymbolID; decl: Decl } | null {
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
	column: number | null;
	namePath: readonly string[] | null;
	decls: readonly Decl[];
	refs: readonly Ref[];
	declById: Map<SymbolID, Decl>;
}): { id: SymbolID; decl: Decl } | null {
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
	private readonly chunkName: string;
	private readonly tokens: readonly LuaToken[];
	private readonly annotations: SemanticAnnotations;
	private readonly tokenMap: Map<string, TokenInfo>;
	private readonly scopeStack: Scope[] = [];
	private readonly tableFields: Map<string, InternalDecl> = new Map();
	private readonly globalsByKey: Map<string, InternalDecl> = new Map();
	private readonly decls: InternalDecl[] = [];
	private readonly declById: Map<SymbolID, InternalDecl> = new Map();
	private readonly refs: Ref[] = [];
	private nextScopeId = 1;

	constructor(options: {
		chunk: LuaChunk;
		chunkName: string;
		tokens: readonly LuaToken[];
		lines: readonly string[];
	}) {
		this.chunk = options.chunk;
		this.chunkName = options.chunkName;
		this.tokens = options.tokens;
		this.annotations = new Array(options.lines.length);
		this.tokenMap = buildTokenMap(options.tokens);
	}

	public build(): SemanticBuildResult {
		this.enterScope(this.chunk.range, 'chunk');
		for (let index = 0; index < this.chunk.body.length; index += 1) {
			this.visitStatement(this.chunk.body[index]);
		}
		this.leaveScope();
		return {
			decls: this.decls,
			refs: this.refs,
			annotations: this.annotations,
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
					const targetDecl = index < pending.length ? pending[index] : pending[pending.length - 1] ?? null;
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
			const isGlobal = scope.kind === 'chunk';
			const tokenInfo = findFunctionNameToken(functionDeclaration, this.tokens, this.tokenMap);
			const range = tokenInfo
				? buildRangeFromToken(tokenInfo, this.chunkName)
				: buildRangeFromPosition(functionDeclaration.range.start, namePath[namePath.length - 1].length, this.chunkName);
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
					const targetInfo = index < targets.length ? targets[index] : targets[targets.length - 1] ?? null;
					const context: ExpressionContext = targetInfo
						? {
								tableBaseDecl: targetInfo.decl,
								tableBasePath: targetInfo.decl ? targetInfo.decl.namePath : targetInfo.namePath,
							}
						: { tableBaseDecl: null, tableBasePath: null };
					this.visitExpression(assignment.right[index], context);
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

	private visitExpression(expression: LuaExpression, context: ExpressionContext): ResolvedNamePath | null {
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
				return { decl: null, namePath: null };
		}
	}

	private assignIdentifier(identifier: LuaIdentifierExpression): AssignmentTargetInfo {
		const existing = this.resolveName(identifier.name);
		const range = buildIdentifierRange(identifier, this.tokenMap, this.chunkName);
		if (existing) {
			this.recordReference({
				namePath: existing.namePath,
				name: identifier.name,
				range,
				target: existing.id,
				isWrite: true,
			});
			return { decl: existing, namePath: existing.namePath };
		}
		const scope = this.currentScope();
		if (scope.kind === 'chunk') {
			const decl = this.declareGlobal(identifier, range);
			return { decl, namePath: decl.namePath };
		}
		this.recordReference({
			namePath: [identifier.name],
			name: identifier.name,
			range,
			target: null,
			isWrite: true,
		});
		return { decl: null, namePath: [identifier.name] };
	}

	private assignMember(member: LuaMemberExpression): AssignmentTargetInfo {
		const baseInfo = this.visitExpression(member.base, { tableBaseDecl: null, tableBasePath: null });
		const basePath = baseInfo ? baseInfo.namePath : extractNamePath(member.base);
		const baseDecl = baseInfo ? baseInfo.decl : null;
		const namePath = basePath ? appendToNamePath(basePath, member.identifier) : [member.identifier];
		const range = buildPropertyRange(member, this.tokenMap, this.chunkName);
		const decl = this.ensureTableField(namePath, range.start, member.identifier.length, baseDecl);
		this.recordReference({
			namePath,
			name: member.identifier,
			range,
			target: decl.id,
			isWrite: true,
		});
		return { decl, namePath };
	}

	private assignIndex(indexExpression: LuaIndexExpression): AssignmentTargetInfo {
		const baseInfo = this.visitExpression(indexExpression.base, { tableBaseDecl: null, tableBasePath: null });
		const namePath = baseInfo ? baseInfo.namePath : extractNamePath(indexExpression.base);
		return {
			decl: baseInfo ? baseInfo.decl : null,
			namePath,
		};
	}

	private recordMethodReference(callExpression: LuaCallExpression, calleeInfo: ResolvedNamePath | null): void {
		const basePath = calleeInfo ? calleeInfo.namePath : extractNamePath(callExpression.callee);
		if (!basePath) {
			return;
		}
		const namePath = appendToNamePath(basePath, callExpression.methodName!);
		const tokenInfo = findMethodToken(callExpression, this.tokens, this.tokenMap);
		const range = tokenInfo ? buildRangeFromToken(tokenInfo, this.chunkName) : callExpression.range;
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

	private handleIdentifierExpression(identifier: LuaIdentifierExpression, isWrite: boolean): ResolvedNamePath | null {
		const range = buildIdentifierRange(identifier, this.tokenMap, this.chunkName);
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
		return { namePath, decl: globalDecl ?? null };
	}

	private handleMemberExpression(member: LuaMemberExpression, context: ExpressionContext, isWrite: boolean): ResolvedNamePath | null {
		const baseInfo = this.visitExpression(member.base, context);
		const basePath = baseInfo ? baseInfo.namePath : extractNamePath(member.base);
		const namePath = basePath ? appendToNamePath(basePath, member.identifier) : [member.identifier];
		const range = buildPropertyRange(member, this.tokenMap, this.chunkName);
		const key = joinNamePath(namePath);
		const decl = this.tableFields.get(key) ?? null;
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

	private handleIndexExpression(indexExpression: LuaIndexExpression, context: ExpressionContext): ResolvedNamePath | null {
		this.visitExpression(indexExpression.base, context);
		return null;
	}

	private declareLocal(name: LuaIdentifierExpression, kind: SymbolKind, activate: boolean): InternalDecl {
		const scope = this.currentScope();
		const range = buildIdentifierRange(name, this.tokenMap, this.chunkName);
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
		const range = buildIdentifierRange(name, this.tokenMap, this.chunkName);
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

	private ensureTableField(namePath: readonly string[], start: Position, length: number, baseDecl: InternalDecl | null): InternalDecl {
		const key = joinNamePath(namePath);
		const existing = this.tableFields.get(key);
		if (existing) {
			return existing;
		}
		const scope = baseDecl ? baseDecl.scopeRef : this.currentScope();
		const scopeRange = baseDecl ? baseDecl.scope : scope.range;
		const range = buildRangeFromPosition(start, length, this.chunkName);
		const decl = this.createDecl({
			namePath: namePath,
			name: namePath[namePath.length - 1],
			kind: 'tableField',
			range,
			scopeRange,
			scopeRef: scope,
			isGlobal: baseDecl ? baseDecl.isGlobal : scope.kind === 'chunk',
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
		const id = createSymbolId(this.chunkName, range, kind, namePath);
	const decl: InternalDecl = {
		id,
		file: this.chunkName,
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
		target: SymbolID | null;
		isWrite: boolean;
	}): void {
	const ref: Ref = {
		file: this.chunkName,
		name: options.name,
		namePath: options.namePath.slice(),
		symbolKey: joinNamePath(options.namePath),
		range: options.range,
		target: options.target,
		isWrite: options.isWrite,
	};
	this.refs.push(ref);
	const targetDecl = options.target ? this.declById.get(options.target) ?? null : null;
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

	private resolveName(name: string): InternalDecl | null {
		let scope: Scope | null = this.currentScope();
		while (scope) {
			const bucket = scope.bindings.get(name);
			if (bucket && bucket.length > 0) {
				return bucket[bucket.length - 1] ?? null;
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

function buildIdentifierRange(identifier: LuaIdentifierExpression, tokenMap: Map<string, TokenInfo>, chunkName: string): LuaSourceRange {
	const info = tokenMap.get(tokenKey(identifier.range.start.line, identifier.range.start.column));
	const length = info ? info.token.lexeme.length : identifier.name.length;
	return buildRangeFromPosition(identifier.range.start, length, chunkName);
}

function buildPropertyRange(member: LuaMemberExpression, tokenMap: Map<string, TokenInfo>, chunkName: string): LuaSourceRange {
	const start = member.range.end;
	const info = tokenMap.get(tokenKey(start.line, start.column));
	const length = info ? info.token.lexeme.length : member.identifier.length;
	return buildRangeFromPosition(start, length, chunkName);
}

function buildRangeFromToken(tokenInfo: TokenInfo, chunkName: string): LuaSourceRange {
	const token = tokenInfo.token;
	return buildRangeFromPosition({ line: token.line, column: token.column }, token.lexeme.length, chunkName);
}

function buildRangeFromPosition(position: Position, length: number, chunkName: string): LuaSourceRange {
	const endColumn = position.column + Math.max(length, 1) - 1;
	return {
		chunkName,
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
		chunkName: range.chunkName,
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
	return `${range.chunkName}|${range.start.line}|${range.start.column}|${joinNamePath(namePath)}`;
}

function appendToNamePath(base: readonly string[], segment: string): string[] {
	const result = base.slice();
	result.push(segment);
	return result;
}

function normalizeSource(source: string): string {
	return source.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
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

function positionInRange(row: number, column: number | null, range: LuaSourceRange): boolean {
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

function extractNamePath(expression: LuaExpression): string[] | null {
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

function buildFunctionNamePath(name: { identifiers: readonly string[]; methodName: string | null }): string[] {
	const identifiers = name.identifiers.slice();
	if (name.methodName) {
		identifiers.push(name.methodName);
	}
	return identifiers;
}

function findFunctionNameToken(statement: LuaFunctionDeclarationStatement, tokens: readonly LuaToken[], tokenMap: Map<string, TokenInfo>): TokenInfo | null {
	const identifiers = statement.name.identifiers;
	const target = identifiers.length > 0 ? identifiers[identifiers.length - 1] : statement.name.methodName;
	if (!target) {
		return null;
	}
	const startLine = statement.range.start.line;
	const endLine = statement.functionExpression.range.start.line;
	let candidate: TokenInfo | null = null;
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

function findMethodToken(callExpression: LuaCallExpression, tokens: readonly LuaToken[], tokenMap: Map<string, TokenInfo>): TokenInfo | null {
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
