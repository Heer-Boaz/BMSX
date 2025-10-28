import { LuaLexer } from '../../lua/lexer.ts';
import { LuaSyntaxError } from '../../lua/errors.ts';
import { LuaTokenType } from '../../lua/token.ts';
import type { LuaToken } from '../../lua/token.ts';

type SemanticRole = 'definition' | 'usage';

export type SemanticKind = 'parameter' | 'localTop' | 'localFunction' | 'functionTop' | 'functionLocal';

export type TokenAnnotation = {
	start: number;
	end: number;
	kind: SemanticKind;
	role: SemanticRole;
};

export type LuaSemanticAnnotations = Array<TokenAnnotation[] | undefined>;

type FunctionContext = {
	parameters: Map<string, SemanticDefinitionRecord>;
	locals: Map<string, SemanticDefinitionRecord>;
	hasVararg: boolean;
	scopeStartLine: number;
	scopeStartColumn: number;
	scopeEndLine: number;
	scopeEndColumn: number;
};

type SemanticDefinitionRecord = {
	name: string;
	kind: SemanticKind;
	token: LuaToken;
	context: FunctionContext | null;
};

type SemanticBinding = {
	kind: SemanticKind;
	definition: SemanticDefinitionRecord;
};

export type LuaSemanticDefinition = {
	name: string;
	kind: SemanticKind;
	startLine: number;
	startColumn: number;
	endLine: number;
	endColumn: number;
	scopeStartLine: number;
	scopeStartColumn: number;
	scopeEndLine: number;
	scopeEndColumn: number;
};

export type LuaSemantics = {
	annotations: LuaSemanticAnnotations;
	definitions: LuaSemanticDefinition[];
};

const INFINITE_LINE = Number.MAX_SAFE_INTEGER;
const INFINITE_COLUMN = Number.MAX_SAFE_INTEGER;

export function analyzeLuaSemanticsFromLines(lines: readonly string[]): LuaSemantics | null {
	if (lines.length === 0) {
		return { annotations: [], definitions: [] };
	}
	const source = lines.join('\n');
	return analyzeInternal(source, lines);
}

export function analyzeLuaSemanticsFromSource(source: string): LuaSemantics | null {
	const normalized = source.replace(/\r\n/g, '\n');
	const lines = normalized.split('\n');
	return analyzeInternal(normalized, lines);
}

function analyzeInternal(source: string, lines: readonly string[]): LuaSemantics | null {
	let tokens: LuaToken[];
	try {
		const lexer = new LuaLexer(source, '<console>');
		tokens = lexer.scanTokens();
	} catch (error) {
		if (error instanceof LuaSyntaxError) {
			return null;
		}
		throw error;
	}

	const annotations: LuaSemanticAnnotations = new Array(lines.length);
	const definitionRecords: SemanticDefinitionRecord[] = [];
	const handledIndices: Set<number> = new Set();
	const topLevelDefinitions: Map<string, SemanticDefinitionRecord> = new Map();
	const functionStack: FunctionContext[] = [];
	const structureStack: Array<'function' | 'block' | 'repeat'> = [];
	let nextFunctionIsLocal = false;
	let lastSignificant: LuaTokenType | null = null;
	let tableConstructorDepth = 0;

	const currentFunction = (): FunctionContext | null => functionStack.length > 0 ? functionStack[functionStack.length - 1] : null;

	const registerDefinition = (
		token: LuaToken,
		kind: SemanticKind,
		context: FunctionContext | null,
	): SemanticDefinitionRecord => {
		annotateToken(annotations, token, kind, 'definition');
		const record: SemanticDefinitionRecord = { name: token.lexeme, kind, token, context };
		definitionRecords.push(record);
		return record;
	};

	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		const type = token.type;
		switch (type) {
			case LuaTokenType.Local: {
				const next = tokens[index + 1];
				if (next && next.type === LuaTokenType.Function) {
					nextFunctionIsLocal = true;
					lastSignificant = LuaTokenType.Local;
					continue;
				}
				const context = currentFunction();
				const definitionKind: SemanticKind = context ? 'localFunction' : 'localTop';
				const targetMap = context ? context.locals : topLevelDefinitions;
				let scan = index + 1;
				while (scan < tokens.length) {
					const candidate = tokens[scan];
					if (candidate.type === LuaTokenType.Identifier) {
						const record = registerDefinition(candidate, definitionKind, context);
						targetMap.set(candidate.lexeme, record);
						handledIndices.add(scan);
						scan += 1;
						continue;
					}
					if (candidate.type === LuaTokenType.Comma) {
						scan += 1;
						continue;
					}
					break;
				}
				if (scan > index + 1) {
					index = scan - 1;
				}
				lastSignificant = LuaTokenType.Local;
				continue;
			}
			case LuaTokenType.Function: {
				const functionToken = token;
				const nameTokenIndices: number[] = [];
				let scan = index + 1;
				while (scan < tokens.length) {
					const part = tokens[scan];
					if (part.type === LuaTokenType.Identifier) {
						nameTokenIndices.push(scan);
						scan += 1;
						continue;
					}
					if (part.type === LuaTokenType.Dot || part.type === LuaTokenType.Colon) {
						scan += 1;
						continue;
					}
					break;
				}
				for (let i = 0; i < nameTokenIndices.length; i += 1) {
					handledIndices.add(nameTokenIndices[i]);
				}

				const ownerContext = currentFunction();
				const targetNameIndex = nameTokenIndices.length > 0 ? nameTokenIndices[nameTokenIndices.length - 1] : null;
				if (targetNameIndex !== null) {
					const nameToken = tokens[targetNameIndex];
					if (nextFunctionIsLocal) {
						const record = registerDefinition(nameToken, 'functionLocal', ownerContext);
						if (ownerContext) {
							ownerContext.locals.set(nameToken.lexeme, record);
						} else {
							topLevelDefinitions.set(nameToken.lexeme, record);
						}
					} else {
						const record = registerDefinition(nameToken, 'functionTop', null);
						topLevelDefinitions.set(nameToken.lexeme, record);
					}
				}
				nextFunctionIsLocal = false;

				const context: FunctionContext = {
					parameters: new Map(),
					locals: new Map(),
					hasVararg: false,
					scopeStartLine: functionToken.line,
					scopeStartColumn: functionToken.column,
					scopeEndLine: INFINITE_LINE,
					scopeEndColumn: INFINITE_COLUMN,
				};

				let hasVararg = false;
				if (scan < tokens.length && tokens[scan].type === LuaTokenType.LeftParen) {
					scan += 1;
					while (scan < tokens.length) {
						const part = tokens[scan];
						if (part.type === LuaTokenType.RightParen || part.type === LuaTokenType.Eof) {
							break;
						}
						if (part.type === LuaTokenType.Identifier) {
							const record = registerDefinition(part, 'parameter', context);
							context.parameters.set(part.lexeme, record);
							handledIndices.add(scan);
							scan += 1;
							continue;
						}
						if (part.type === LuaTokenType.Vararg) {
							hasVararg = true;
							const record = registerDefinition(part, 'parameter', context);
							context.parameters.set(part.lexeme, record);
							handledIndices.add(scan);
						}
						scan += 1;
					}
				}
				if (hasVararg) {
					context.hasVararg = true;
				}
				functionStack.push(context);
				structureStack.push('function');
				if (scan > index) {
					index = scan;
				}
				lastSignificant = LuaTokenType.Function;
				continue;
			}
			case LuaTokenType.For: {
				const context = currentFunction();
				const definitionKind: SemanticKind = context ? 'localFunction' : 'localTop';
				const targetMap = context ? context.locals : topLevelDefinitions;
				let scan = index + 1;
				while (scan < tokens.length) {
					const part = tokens[scan];
					if (part.type === LuaTokenType.Identifier) {
						const record = registerDefinition(part, definitionKind, context);
						targetMap.set(part.lexeme, record);
						handledIndices.add(scan);
						scan += 1;
						continue;
					}
					if (part.type === LuaTokenType.Comma) {
						scan += 1;
						continue;
					}
					if (part.type === LuaTokenType.Equal || part.type === LuaTokenType.In) {
						break;
					}
					break;
				}
				structureStack.push('block');
				if (scan > index) {
					index = scan - 1;
				}
				lastSignificant = LuaTokenType.For;
				continue;
			}
			case LuaTokenType.While:
			case LuaTokenType.If: {
				structureStack.push('block');
				lastSignificant = type;
				continue;
			}
			case LuaTokenType.Do: {
				if (lastSignificant !== LuaTokenType.For && lastSignificant !== LuaTokenType.While) {
					structureStack.push('block');
				}
				lastSignificant = LuaTokenType.Do;
				continue;
			}
			case LuaTokenType.Repeat: {
				structureStack.push('repeat');
				lastSignificant = LuaTokenType.Repeat;
				continue;
			}
			case LuaTokenType.Until: {
				if (structureStack.length > 0) {
					const popped = structureStack.pop();
					if (popped === 'repeat') {
						lastSignificant = LuaTokenType.Until;
						continue;
					}
				}
				lastSignificant = LuaTokenType.Until;
				continue;
			}
			case LuaTokenType.End: {
				if (structureStack.length > 0) {
					const popped = structureStack.pop();
					if (popped === 'function') {
						const context = functionStack.pop() ?? null;
						if (context) {
							context.scopeEndLine = token.line;
							context.scopeEndColumn = token.column + token.lexeme.length;
						}
					}
				} else if (functionStack.length > 0) {
					const context = functionStack.pop() ?? null;
					if (context) {
						context.scopeEndLine = token.line;
						context.scopeEndColumn = token.column + token.lexeme.length;
					}
				}
				lastSignificant = LuaTokenType.End;
				continue;
			}
			case LuaTokenType.LeftBrace: {
				tableConstructorDepth += 1;
				lastSignificant = LuaTokenType.LeftBrace;
				continue;
			}
			case LuaTokenType.RightBrace: {
				if (tableConstructorDepth > 0) {
					tableConstructorDepth -= 1;
				}
				lastSignificant = LuaTokenType.RightBrace;
				continue;
			}
			case LuaTokenType.Vararg: {
				const binding = resolveBinding(token.lexeme, functionStack, topLevelDefinitions);
				if (binding) {
					annotateToken(annotations, token, binding.kind, 'usage');
				}
				lastSignificant = LuaTokenType.Vararg;
				continue;
			}
			case LuaTokenType.Identifier: {
				const nextToken = tokens[index + 1];
				const isTableField = tableConstructorDepth > 0
					&& nextToken?.type === LuaTokenType.Equal
					&& (lastSignificant === LuaTokenType.LeftBrace || lastSignificant === LuaTokenType.Comma || lastSignificant === LuaTokenType.Semicolon);
				if (isTableField) {
					handledIndices.add(index);
					lastSignificant = LuaTokenType.Identifier;
					continue;
				}
				if (handledIndices.has(index)) {
					lastSignificant = LuaTokenType.Identifier;
					continue;
				}
				const binding = resolveBinding(token.lexeme, functionStack, topLevelDefinitions);
				if (binding) {
					annotateToken(annotations, token, binding.kind, 'usage');
				}
				lastSignificant = LuaTokenType.Identifier;
				continue;
			}
			default: {
				if (type !== LuaTokenType.Eof) {
					lastSignificant = type;
				}
			}
		}
	}

	for (let index = 0; index < functionStack.length; index += 1) {
		const context = functionStack[index];
		if (context.scopeEndLine === INFINITE_LINE) {
			context.scopeEndLine = INFINITE_LINE;
			context.scopeEndColumn = INFINITE_COLUMN;
		}
	}

	const definitions: LuaSemanticDefinition[] = definitionRecords.map((record) => {
		const token = record.token;
		const startLine = token.line;
		const startColumn = token.column;
		const endLine = token.line;
		const endColumn = token.column + Math.max(1, token.lexeme.length) - 1;
		const context = record.context;
		const scopeStartLine = context ? context.scopeStartLine : startLine;
		const scopeStartColumn = context ? context.scopeStartColumn : startColumn;
		const scopeEndLine = context ? context.scopeEndLine : INFINITE_LINE;
		const scopeEndColumn = context ? context.scopeEndColumn : INFINITE_COLUMN;
		return {
			name: record.name,
			kind: record.kind,
			startLine,
			startColumn,
			endLine,
			endColumn,
			scopeStartLine,
			scopeStartColumn,
			scopeEndLine,
			scopeEndColumn,
		};
	});

	return { annotations, definitions };
}

function resolveBinding(name: string, stack: readonly FunctionContext[], topLevel: Map<string, SemanticDefinitionRecord>): SemanticBinding | null {
	for (let index = stack.length - 1; index >= 0; index -= 1) {
		const context = stack[index];
		const parameter = context.parameters.get(name);
		if (parameter) {
			return { kind: parameter.kind, definition: parameter };
		}
		const local = context.locals.get(name);
		if (local) {
			return { kind: local.kind, definition: local };
		}
	}
	const top = topLevel.get(name);
	if (top) {
		return { kind: top.kind, definition: top };
	}
	return null;
}

function annotateToken(target: LuaSemanticAnnotations, token: LuaToken, kind: SemanticKind, role: SemanticRole): void {
	const row = token.line - 1;
	if (row < 0 || row >= target.length) {
		return;
	}
	const start = token.column - 1;
	const end = start + token.lexeme.length;
	if (end <= start) {
		return;
	}
	let rowAnnotations = target[row];
	if (!rowAnnotations) {
		rowAnnotations = [];
		target[row] = rowAnnotations;
	}
	rowAnnotations.push({ start, end, kind, role });
}
