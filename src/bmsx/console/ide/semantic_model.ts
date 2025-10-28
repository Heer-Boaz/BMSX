import { LuaLexer } from '../../lua/lexer.ts';
import { LuaParser } from '../../lua/parser.ts';
import type {
	LuaDefinitionInfo,
	LuaDefinitionKind,
	LuaSourceRange,
	LuaChunk,
	LuaStatement,
	LuaExpression,
	LuaIdentifierExpression,
	LuaMemberExpression,
	LuaIndexExpression,
	LuaCallExpression,
	LuaFunctionExpression,
	LuaTableConstructorExpression,
	LuaTableArrayField,
	LuaTableIdentifierField,
	LuaTableExpressionField,
	LuaBinaryExpression,
	LuaUnaryExpression,
	LuaStringLiteralExpression,
} from '../../lua/ast.ts';
import { LuaSyntaxKind, LuaTableFieldKind } from '../../lua/ast.ts';
import type { LuaToken } from '../../lua/token.ts';
import { LuaTokenType } from '../../lua/token.ts';
import { analyzeLuaSemanticsFromSource, type LuaSemanticAnnotations, type LuaSemanticDefinition, type SemanticKind } from './lua_semantics';

export type { LuaSemanticDefinition } from './lua_semantics';

export type LuaSemanticModel = {
	annotations: LuaSemanticAnnotations;
	definitions: LuaDefinitionInfo[];
	lookupIdentifier(row: number, column: number | null, namePath: readonly string[]): LuaDefinitionInfo | null;
	lookupReferences(row: number, column: number | null, namePath: readonly string[]): LuaReferenceLookupResult;
	getDefinitionReferences(definition: LuaDefinitionInfo): LuaSourceRange[];
};

export type LuaReferenceLookupResult = {
	definition: LuaDefinitionInfo | null;
	references: LuaSourceRange[];
};

export function buildLuaSemanticModel(source: string, chunkName: string): LuaSemanticModel {
	const normalizedSource = source.replace(/\r\n/g, '\n');
	const semantics = analyzeLuaSemanticsFromSource(normalizedSource);
	const annotations = semantics ? semantics.annotations : [];
	const lexer = new LuaLexer(normalizedSource, chunkName);
	const tokens = lexer.scanTokens();
	const parser = new LuaParser(tokens, chunkName, normalizedSource);
	const chunk = parser.parseChunk();
	const definitions: LuaDefinitionInfo[] = [];
	const seen = new Set<string>();

	const addDefinition = (definition: LuaDefinitionInfo): void => {
		const key = `${definition.namePath.join('.')}:${definition.definition.start.line}:${definition.definition.start.column}`;
		if (!seen.has(key)) {
			seen.add(key);
			definitions.push(definition);
		}
	};

	if (chunk.definitions) {
		for (let index = 0; index < chunk.definitions.length; index += 1) {
			addDefinition(chunk.definitions[index]);
		}
	}

	if (semantics && semantics.definitions.length > 0) {
		const converted = convertSemanticDefinitions(chunkName, semantics.definitions);
		for (let index = 0; index < converted.length; index += 1) {
			addDefinition(converted[index]);
		}
	}

	definitions.sort((a, b) => {
		if (a.definition.start.line !== b.definition.start.line) {
			return a.definition.start.line - b.definition.start.line;
		}
		if (a.definition.start.column !== b.definition.start.column) {
			return a.definition.start.column - b.definition.start.column;
		}
		return a.name.localeCompare(b.name);
	});

	const referenceIndex = buildReferenceIndex({
		chunk,
		tokens,
		definitions,
		annotations,
		chunkName,
	});

	const model: LuaSemanticModel = {
		annotations,
		definitions,
		lookupIdentifier(row: number, column: number | null, namePath: readonly string[]): LuaDefinitionInfo | null {
			return resolveIdentifierDefinition({ annotations, definitions }, row, column, namePath);
		},
		lookupReferences(row: number, column: number | null, namePath: readonly string[]): LuaReferenceLookupResult {
			const definition = resolveIdentifierDefinition({ annotations, definitions }, row, column, namePath);
			if (!definition) {
				return { definition: null, references: [] };
			}
			return {
				definition,
				references: getDefinitionReferences(referenceIndex, definition),
			};
		},
		getDefinitionReferences(definition: LuaDefinitionInfo): LuaSourceRange[] {
			return getDefinitionReferences(referenceIndex, definition);
		},
	};

	return model;
}

function resolveIdentifierDefinition(model: { annotations: LuaSemanticAnnotations; definitions: ReadonlyArray<LuaDefinitionInfo> }, row: number, column: number | null, namePath: readonly string[]): LuaDefinitionInfo | null {
	const desiredKind = resolveSemanticKind(model.annotations, row, column);
	const desiredDefinitionKind = desiredKind ? semanticKindToDefinitionKind(desiredKind) : null;
	let best: LuaDefinitionInfo | null = null;
	let bestScore = -Infinity;
	for (let index = 0; index < model.definitions.length; index += 1) {
		const definition = model.definitions[index];
		if (!matchesNamePath(definition, namePath)) {
			continue;
		}
		if (row !== null) {
			if (!positionWithinRange(row, column, definition.scope)) {
				continue;
			}
			if (column !== null
				&& row === definition.definition.start.line
				&& column === definition.definition.start.column
				&& definition.kind !== 'assignment') {
				return definition;
			}
			if (!definitionOccursBeforeUsage(definition, row, column)) {
				continue;
			}
		}
		let score = basePriority(definition.kind);
		if (desiredDefinitionKind && definition.kind === desiredDefinitionKind) {
			score += 1000;
		}
		if (row !== null && positionWithinRange(row, column, definition.definition)) {
			score += 250;
		}
		if (definition.kind === 'assignment'
			&& row !== null
			&& column !== null
			&& row === definition.definition.start.line
			&& column === definition.definition.start.column) {
			score -= 500;
		}
		if (!best || score > bestScore || (score === bestScore && isDefinitionPreferred(definition, best))) {
			best = definition;
			bestScore = score;
		}
	}
	return best;
}

function resolveSemanticKind(annotations: LuaSemanticAnnotations, row: number, column: number | null): SemanticKind | null {
	const rowIndex = row - 1;
	if (rowIndex < 0 || rowIndex >= annotations.length) {
		return null;
	}
	const rowAnnotations = annotations[rowIndex];
	if (!rowAnnotations) {
		return null;
	}
	const columnIndex = column !== null ? Math.max(0, column - 1) : 0;
	for (let index = 0; index < rowAnnotations.length; index += 1) {
		const annotation = rowAnnotations[index];
		if (columnIndex >= annotation.start && columnIndex < annotation.end) {
			return annotation.kind;
		}
	}
	return null;
}

function matchesNamePath(definition: LuaDefinitionInfo, namePath: readonly string[]): boolean {
	if (namePath.length === 0) {
		return false;
	}
	if (definition.namePath.length === namePath.length) {
		for (let index = 0; index < namePath.length; index += 1) {
			if (definition.namePath[index] !== namePath[index]) {
				return false;
			}
		}
		return true;
	}
	const identifier = namePath[namePath.length - 1];
	return definition.name === identifier;
}

function basePriority(kind: LuaDefinitionKind): number {
	switch (kind) {
		case 'parameter':
			return 500;
		case 'variable':
			return 400;
		case 'function':
			return 300;
		case 'table_field':
			return 200;
		case 'assignment':
		default:
			return 100;
	}
}

function isDefinitionPreferred(candidate: LuaDefinitionInfo, current: LuaDefinitionInfo): boolean {
	if (candidate.definition.start.line !== current.definition.start.line) {
		return candidate.definition.start.line > current.definition.start.line;
	}
	if (candidate.definition.start.column !== current.definition.start.column) {
		return candidate.definition.start.column > current.definition.start.column;
	}
	return candidate.name.localeCompare(current.name) < 0;
}

function positionWithinRange(row: number, column: number | null, range: LuaSourceRange): boolean {
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

function definitionOccursBeforeUsage(definition: LuaDefinitionInfo, usageRow: number | null, usageColumn: number | null): boolean {
	if (usageRow === null) {
		return true;
	}
	if (usageRow < definition.definition.start.line) {
		return false;
	}
	if (usageRow === definition.definition.start.line && usageColumn !== null && usageColumn < definition.definition.start.column) {
		return false;
	}
	return true;
}

function convertSemanticDefinitions(chunkName: string, definitions: readonly LuaSemanticDefinition[]): LuaDefinitionInfo[] {
	const result: LuaDefinitionInfo[] = [];
	for (let index = 0; index < definitions.length; index += 1) {
		const semantic = definitions[index];
		const kind = semanticKindToDefinitionKind(semantic.kind);
		const definitionRange: LuaSourceRange = {
			chunkName,
			start: { line: semantic.startLine, column: semantic.startColumn },
			end: { line: semantic.endLine, column: semantic.endColumn },
		};
		const scopeRange: LuaSourceRange = {
			chunkName,
			start: { line: semantic.scopeStartLine, column: semantic.scopeStartColumn },
			end: { line: semantic.scopeEndLine, column: semantic.scopeEndColumn },
		};
		result.push({
			name: semantic.name,
			namePath: [semantic.name],
			definition: definitionRange,
			scope: scopeRange,
			kind,
		});
	}
	return result;
}

function semanticKindToDefinitionKind(kind: SemanticKind): LuaDefinitionKind {
	switch (kind) {
		case 'parameter':
			return 'parameter';
		case 'functionTop':
		case 'functionLocal':
			return 'function';
		case 'localFunction':
		case 'localTop':
		default:
			return 'variable';
	}
}

type ReferenceIndex = Map<string, LuaSourceRange[]>;

type ReferenceIndexBuildOptions = {
	chunk: LuaChunk;
	tokens: readonly LuaToken[];
	definitions: readonly LuaDefinitionInfo[];
	annotations: LuaSemanticAnnotations;
	chunkName: string;
};

type ReferenceCollectorContext = {
	chunkName: string;
	tokens: readonly LuaToken[];
	tokenLengths: Map<string, number>;
	addReference: (namePath: readonly string[], range: LuaSourceRange) => void;
};

function buildReferenceIndex(options: ReferenceIndexBuildOptions): ReferenceIndex {
	const { chunk, tokens, definitions, annotations, chunkName } = options;
	const tokenLengths = buildTokenLengthMap(tokens);
	const rawIndex = new Map<string, { ranges: LuaSourceRange[]; seen: Set<string> }>();

	for (let index = 0; index < definitions.length; index += 1) {
		const definition = definitions[index];
		const key = definitionKey(definition);
		rawIndex.set(key, { ranges: [], seen: new Set<string>() });
	}
	const collector: ReferenceCollectorContext = {
		chunkName,
		tokens,
		tokenLengths,
		addReference: (namePath: readonly string[], range: LuaSourceRange) => {
			if (namePath.length === 0) {
				return;
			}
			const target = resolveIdentifierDefinition({ annotations, definitions }, range.start.line, range.start.column, namePath);
			if (!target) {
				return;
			}
			const key = definitionKey(target);
			let bucket = rawIndex.get(key);
			if (!bucket) {
				bucket = { ranges: [], seen: new Set() };
				rawIndex.set(key, bucket);
			}
			const normalized = normalizeRange(range, chunkName);
			const identity = rangeIdentity(normalized);
			const definitionIdentity = rangeIdentity(normalizeRange(target.definition, target.definition.chunkName || chunkName));
			if (identity === definitionIdentity) {
				return;
			}
			if (bucket.seen.has(identity)) {
				return;
			}
			bucket.seen.add(identity);
			bucket.ranges.push(cloneRange(normalized));
		},
	};

	collectChunkReferences(chunk, collector);

	const result: ReferenceIndex = new Map();
	for (const [key, bucket] of rawIndex) {
		bucket.ranges.sort(compareRanges);
		result.set(key, bucket.ranges.map(cloneRange));
	}
	return result;
}

function collectChunkReferences(chunk: LuaChunk, context: ReferenceCollectorContext): void {
	type StatementContainer = { body: ReadonlyArray<LuaStatement> };

	const visitBlock = (block: StatementContainer): void => {
		for (let index = 0; index < block.body.length; index += 1) {
			visitStatement(block.body[index]);
		}
	};

	const visitStatement = (statement: LuaStatement): void => {
		switch (statement.kind) {
			case LuaSyntaxKind.LocalAssignmentStatement: {
				const localAssignment = statement;
				for (let i = 0; i < localAssignment.values.length; i += 1) {
					visitExpression(localAssignment.values[i]);
				}
				break;
			}
			case LuaSyntaxKind.LocalFunctionStatement: {
				const localFunction = statement;
				visitFunctionExpression(localFunction.functionExpression);
				break;
			}
			case LuaSyntaxKind.FunctionDeclarationStatement: {
				const functionDeclaration = statement;
				visitFunctionExpression(functionDeclaration.functionExpression);
				break;
			}
			case LuaSyntaxKind.AssignmentStatement: {
				const assignment = statement;
				for (let i = 0; i < assignment.left.length; i += 1) {
					visitExpression(assignment.left[i]);
				}
				for (let i = 0; i < assignment.right.length; i += 1) {
					visitExpression(assignment.right[i]);
				}
				break;
			}
			case LuaSyntaxKind.ReturnStatement: {
				const returnStatement = statement;
				for (let i = 0; i < returnStatement.expressions.length; i += 1) {
					visitExpression(returnStatement.expressions[i]);
				}
				break;
			}
			case LuaSyntaxKind.IfStatement: {
				const ifStatement = statement;
				for (let i = 0; i < ifStatement.clauses.length; i += 1) {
					const clause = ifStatement.clauses[i];
					if (clause.condition) {
						visitExpression(clause.condition);
					}
					visitBlock(clause.block);
				}
				break;
			}
			case LuaSyntaxKind.WhileStatement: {
				const whileStatement = statement;
				visitExpression(whileStatement.condition);
				visitBlock(whileStatement.block);
				break;
			}
			case LuaSyntaxKind.RepeatStatement: {
				const repeatStatement = statement;
				visitBlock(repeatStatement.block);
				visitExpression(repeatStatement.condition);
				break;
			}
			case LuaSyntaxKind.DoStatement: {
				const doStatement = statement;
				visitBlock(doStatement.block);
				break;
			}
			case LuaSyntaxKind.ForNumericStatement: {
				const forNumeric = statement;
				visitExpression(forNumeric.start);
				visitExpression(forNumeric.limit);
				if (forNumeric.step) {
					visitExpression(forNumeric.step);
				}
				visitBlock(forNumeric.block);
				break;
			}
			case LuaSyntaxKind.ForGenericStatement: {
				const forGeneric = statement;
				for (let i = 0; i < forGeneric.iterators.length; i += 1) {
					visitExpression(forGeneric.iterators[i]);
				}
				visitBlock(forGeneric.block);
				break;
			}
			case LuaSyntaxKind.CallStatement: {
				const callStatement = statement;
				visitExpression(callStatement.expression);
				break;
			}
			default:
				break;
		}
	};

	const visitFunctionExpression = (expression: LuaFunctionExpression): void => {
		visitBlock(expression.body);
	};

	const visitExpression = (expression: LuaExpression): void => {
		switch (expression.kind) {
			case LuaSyntaxKind.IdentifierExpression: {
				recordIdentifierReference(expression as LuaIdentifierExpression);
				break;
			}
			case LuaSyntaxKind.MemberExpression: {
				const member = expression as LuaMemberExpression;
				recordMemberReference(member);
				visitExpression(member.base);
				break;
			}
			case LuaSyntaxKind.IndexExpression: {
				const indexExpression = expression as LuaIndexExpression;
				recordIndexReference(indexExpression);
				visitExpression(indexExpression.base);
				visitExpression(indexExpression.index);
				break;
			}
			case LuaSyntaxKind.CallExpression: {
				const call = expression as LuaCallExpression;
				recordMethodReference(call);
				visitExpression(call.callee);
				for (let i = 0; i < call.arguments.length; i += 1) {
					visitExpression(call.arguments[i]);
				}
				break;
			}
			case LuaSyntaxKind.FunctionExpression:
				visitFunctionExpression(expression as LuaFunctionExpression);
				break;
			case LuaSyntaxKind.TableConstructorExpression: {
				const tableExpression = expression as LuaTableConstructorExpression;
				for (let i = 0; i < tableExpression.fields.length; i += 1) {
					const field = tableExpression.fields[i];
					if (field.kind === LuaTableFieldKind.Array) {
						visitExpression((field as LuaTableArrayField).value);
						continue;
					}
					if (field.kind === LuaTableFieldKind.IdentifierKey) {
						visitExpression((field as LuaTableIdentifierField).value);
						continue;
					}
					if (field.kind === LuaTableFieldKind.ExpressionKey) {
						const expressionField = field as LuaTableExpressionField;
						visitExpression(expressionField.key);
						visitExpression(expressionField.value);
					}
				}
				break;
			}
			case LuaSyntaxKind.BinaryExpression: {
				const binary = expression as LuaBinaryExpression;
				visitExpression(binary.left);
				visitExpression(binary.right);
				break;
			}
			case LuaSyntaxKind.UnaryExpression: {
				const unary = expression as LuaUnaryExpression;
				visitExpression(unary.operand);
				break;
			}
			default:
				break;
		}
	};

	const recordIdentifierReference = (identifier: LuaIdentifierExpression): void => {
		const line = identifier.range.start.line;
		const column = identifier.range.start.column;
		const length = resolveTokenLength(context.tokenLengths, line, column) ?? Math.max(1, identifier.name.length);
		const range = createRange(context.chunkName, line, column, length);
		context.addReference([identifier.name], range);
	};

	const recordMemberReference = (member: LuaMemberExpression): void => {
		const path = resolveExpressionPath(member);
		if (!path) {
			return;
		}
		const line = member.range.end.line;
		const column = member.range.end.column;
		const length = resolveTokenLength(context.tokenLengths, line, column) ?? Math.max(1, member.identifier.length);
		const range = createRange(context.chunkName, line, column, length);
		context.addReference(path, range);
	};

	const recordIndexReference = (indexExpression: LuaIndexExpression): void => {
		const path = resolveExpressionPath(indexExpression);
		if (!path) {
			return;
		}
		const index = indexExpression.index;
		const line = index.range.start.line;
		const column = index.range.start.column;
		let length = resolveTokenLength(context.tokenLengths, line, column);
		if (length === null) {
			if (index.kind === LuaSyntaxKind.IdentifierExpression) {
				length = Math.max(1, (index as LuaIdentifierExpression).name.length);
			} else if (index.kind === LuaSyntaxKind.StringLiteralExpression) {
				const stringExpression = index as LuaStringLiteralExpression;
				length = Math.max(1, stringExpression.value.length + 2);
			}
		}
		const range = createRange(context.chunkName, line, column, length ?? 1);
		context.addReference(path, range);
	};

	const recordMethodReference = (call: LuaCallExpression): void => {
		if (!call.methodName) {
			return;
		}
		const basePath = resolveExpressionPath(call.callee);
		if (!basePath) {
			return;
		}
		const methodToken = findMethodTokenPosition(call.methodName, call.range, context.tokens);
		if (!methodToken) {
			return;
		}
		const path = basePath.concat(call.methodName);
		const range = createRange(context.chunkName, methodToken.line, methodToken.column, methodToken.length);
		context.addReference(path, range);
	};

visitBlock(chunk);
}

function resolveExpressionPath(expression: LuaExpression): string[] | null {
	switch (expression.kind) {
		case LuaSyntaxKind.IdentifierExpression:
			return [(expression as LuaIdentifierExpression).name];
		case LuaSyntaxKind.MemberExpression: {
			const member = expression as LuaMemberExpression;
			const basePath = resolveExpressionPath(member.base);
			if (!basePath) {
				return null;
			}
			const merged = basePath.slice();
			merged.push(member.identifier);
			return merged;
		}
		case LuaSyntaxKind.IndexExpression: {
			const indexExpression = expression as LuaIndexExpression;
			const basePath = resolveExpressionPath(indexExpression.base);
			if (!basePath) {
				return null;
			}
			const key = resolveIndexKey(indexExpression.index);
			if (key === null) {
				return null;
			}
			const merged = basePath.slice();
			merged.push(key);
			return merged;
		}
		default:
			return null;
	}
}

function resolveIndexKey(expression: LuaExpression): string | null {
	switch (expression.kind) {
		case LuaSyntaxKind.StringLiteralExpression:
			return (expression as LuaStringLiteralExpression).value;
		case LuaSyntaxKind.IdentifierExpression:
			return (expression as LuaIdentifierExpression).name;
		default:
			return null;
	}
}

function findMethodTokenPosition(methodName: string, range: LuaSourceRange, tokens: readonly LuaToken[]): { line: number; column: number; length: number } | null {
	for (let index = 1; index < tokens.length; index += 1) {
		const current = tokens[index];
		const previous = tokens[index - 1];
		if (previous.type !== LuaTokenType.Colon) {
			continue;
		}
		if (current.type !== LuaTokenType.Identifier || current.lexeme !== methodName) {
			continue;
		}
		const currentPosition = { line: current.line, column: current.column };
		if (positionBefore(currentPosition, range.start)) {
			continue;
		}
		if (positionBefore(range.end, currentPosition)) {
			continue;
		}
		return {
			line: current.line,
			column: current.column,
			length: Math.max(1, current.lexeme.length),
		};
	}
	return null;
}

function buildTokenLengthMap(tokens: readonly LuaToken[]): Map<string, number> {
	const map = new Map<string, number>();
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (!token.lexeme || token.lexeme.length === 0) {
			continue;
		}
		const key = positionKey(token.line, token.column);
		if (!map.has(key)) {
			map.set(key, token.lexeme.length);
		}
	}
	return map;
}

function resolveTokenLength(tokenLengths: Map<string, number>, line: number, column: number): number | null {
	const key = positionKey(line, column);
	if (!tokenLengths.has(key)) {
		return null;
	}
	const length = tokenLengths.get(key);
	return length !== undefined ? length : null;
}

function definitionKey(definition: LuaDefinitionInfo): string {
	const path = definition.namePath.join('.');
	return `${definition.definition.start.line}:${definition.definition.start.column}:${definition.definition.end.line}:${definition.definition.end.column}:${definition.kind}:${path}`;
}

function normalizeRange(range: LuaSourceRange, fallbackChunkName: string): LuaSourceRange {
	const startLine = range.start.line;
	const startColumn = range.start.column;
	let endLine = range.end.line;
	let endColumn = range.end.column;
	if (endLine < startLine || (endLine === startLine && endColumn < startColumn)) {
		endLine = startLine;
		endColumn = startColumn;
	}
	return {
		chunkName: range.chunkName || fallbackChunkName,
		start: { line: startLine, column: startColumn },
		end: { line: endLine, column: endColumn },
	};
}

function cloneRange(range: LuaSourceRange): LuaSourceRange {
	return {
		chunkName: range.chunkName,
		start: { line: range.start.line, column: range.start.column },
		end: { line: range.end.line, column: range.end.column },
	};
}

function rangeIdentity(range: LuaSourceRange): string {
	return `${range.start.line}:${range.start.column}:${range.end.line}:${range.end.column}:${range.chunkName}`;
}

function compareRanges(a: LuaSourceRange, b: LuaSourceRange): number {
	if (a.start.line !== b.start.line) {
		return a.start.line - b.start.line;
	}
	if (a.start.column !== b.start.column) {
		return a.start.column - b.start.column;
	}
	if (a.end.line !== b.end.line) {
		return a.end.line - b.end.line;
	}
	return a.end.column - b.end.column;
}

function getDefinitionReferences(index: ReferenceIndex, definition: LuaDefinitionInfo): LuaSourceRange[] {
	const key = definitionKey(definition);
	const ranges = index.get(key);
	if (!ranges || ranges.length === 0) {
		return [];
	}
	const copies: LuaSourceRange[] = new Array(ranges.length);
	for (let i = 0; i < ranges.length; i += 1) {
		copies[i] = cloneRange(ranges[i]);
	}
	return copies;
}

function positionKey(line: number, column: number): string {
	return `${line}:${column}`;
}

function positionBefore(a: { line: number; column: number }, b: { line: number; column: number }): boolean {
	if (a.line < b.line) {
		return true;
	}
	if (a.line > b.line) {
		return false;
	}
	return a.column < b.column;
}

function createRange(chunkName: string, line: number, column: number, length: number): LuaSourceRange {
	const width = Math.max(1, Math.floor(length));
	return {
		chunkName,
		start: { line, column },
		end: { line, column: column + width - 1 },
	};
}
