import { BmsxConsoleApi } from '../api';
import { LuaLexer } from '../../lua/lexer.ts';
import { LuaParser } from '../../lua/parser.ts';
import { LuaSyntaxError } from '../../lua/errors.ts';
import {
	LuaSyntaxKind,
	type LuaChunk,
	type LuaBlock,
	type LuaStatement,
	type LuaExpression,
	type LuaIdentifierExpression,
	type LuaMemberExpression,
	type LuaCallExpression,
	type LuaAssignmentStatement,
	type LuaLocalAssignmentStatement,
	type LuaLocalFunctionStatement,
	type LuaFunctionDeclarationStatement,
	type LuaForNumericStatement,
	type LuaForGenericStatement,
	type LuaBinaryExpression,
	type LuaUnaryExpression,
	type LuaReturnStatement,
	type LuaIfStatement,
	type LuaWhileStatement,
	type LuaRepeatStatement,
	type LuaDoStatement,
	type LuaCallStatement,
	type LuaIndexExpression,
	type LuaFunctionExpression,
	type LuaTableConstructorExpression,
	type LuaAssignableExpression,
	type LuaStringLiteralExpression,
	type LuaDefinitionKind,
	type LuaSourceRange,
} from '../../lua/ast.ts';
import { LuaTableFieldKind } from '../../lua/ast.ts';
import type { LuaTableArrayField, LuaTableExpressionField, LuaTableIdentifierField } from '../../lua/ast.ts';
import type { ConsoleLuaBuiltinDescriptor, ConsoleLuaDefinitionRange, ConsoleLuaSymbolEntry } from '../types';
import type { ApiCompletionMetadata, LuaCompletionItem } from './types';

export const KEYWORDS = new Set([
	'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'goto', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while',
]);

const keywordCompletions: LuaCompletionItem[] = buildKeywordCompletionsInternal();
const apiCompletionData = initializeApiCompletionDataInternal();

export function getKeywordCompletions(): readonly LuaCompletionItem[] {
	return keywordCompletions;
}

export function getApiCompletionData(): { items: LuaCompletionItem[]; signatures: Map<string, ApiCompletionMetadata> } {
	return apiCompletionData;
}

export type LuaScopedSymbol = {
	name: string;
	path: string;
	kind: LuaDefinitionKind;
	definitionRange: ConsoleLuaDefinitionRange;
	scopeRange: ConsoleLuaDefinitionRange;
};

export type LuaScopedSymbolOptions = {
	source: string;
	chunkName: string;
};

export function collectLuaScopedSymbols(options: LuaScopedSymbolOptions): LuaScopedSymbol[] {
	let chunk: LuaChunk;
	try {
		chunk = parseLuaChunk(options.source, options.chunkName);
	} catch (error) {
		if (!(error instanceof LuaSyntaxError)) {
			throw error;
		}
		const truncated = truncateSourceAtSyntaxError(options.source, error);
		if (truncated === null) {
			throw error;
		}
		try {
			chunk = parseLuaChunk(truncated, options.chunkName);
		} catch {
			throw error;
		}
	}
	const definitions = chunk.definitions;
	if (definitions.length === 0) {
		return [];
	}
	const scopedSymbols: LuaScopedSymbol[] = [];
	for (let index = 0; index < definitions.length; index += 1) {
		const definition = definitions[index];
		const name = definition.name;
		if (name.length === 0) {
			continue;
		}
		const path = definition.namePath.length > 0 ? definition.namePath.join('.') : name;
		scopedSymbols.push({
			name,
			path,
			kind: definition.kind,
			definitionRange: convertRange(definition.definition),
			scopeRange: convertRange(definition.scope),
		});
	}
	return scopedSymbols;
}

function buildKeywordCompletionsInternal(): LuaCompletionItem[] {
	const sorted = Array.from(KEYWORDS);
	sorted.sort((a, b) => a.localeCompare(b));
	const items: LuaCompletionItem[] = [];
	for (let i = 0; i < sorted.length; i += 1) {
		const keyword = sorted[i];
		items.push({
			label: keyword,
			insertText: keyword,
			sortKey: `keyword:${keyword}`,
			kind: 'keyword',
			detail: 'Lua keyword',
		});
	}
	return items;
}

function initializeApiCompletionDataInternal(): { items: LuaCompletionItem[]; signatures: Map<string, ApiCompletionMetadata> } {
	const items: LuaCompletionItem[] = [];
	const signatures: Map<string, ApiCompletionMetadata> = new Map();
	const processed = new Set<string>();
	let prototype: object | null = BmsxConsoleApi.prototype;
	while (prototype && prototype !== Object.prototype) {
		const propertyNames = Object.getOwnPropertyNames(prototype);
		for (let index = 0; index < propertyNames.length; index += 1) {
			const name = propertyNames[index];
			if (name === 'constructor' || processed.has(name)) {
				continue;
			}
			const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
			if (!descriptor) {
				continue;
			}
			if (typeof descriptor.value === 'function') {
				const params = extractFunctionParameters(descriptor.value as (...args: unknown[]) => unknown);
				const detail = params.length > 0
					? `api.${name}(${params.join(', ')})`
					: `api.${name}()`;
				const item: LuaCompletionItem = {
					label: name,
					insertText: name,
					sortKey: `api:${name}`,
					kind: 'api_method',
					detail,
					parameters: params,
				};
				items.push(item);
				signatures.set(name, { params: params.slice(), signature: detail, kind: 'method' });
				processed.add(name);
				continue;
			}
			if (descriptor.get) {
				const detail = `api.${name}`;
				const item: LuaCompletionItem = {
					label: name,
					insertText: name,
					sortKey: `api:${name}`,
					kind: 'api_property',
					detail,
				};
				items.push(item);
				signatures.set(name, { params: [], signature: detail, kind: 'getter' });
				processed.add(name);
			}
		}
		prototype = Object.getPrototypeOf(prototype);
	}
	items.sort((a, b) => a.label.localeCompare(b.label));
	return { items, signatures };
}

function extractFunctionParameters(fn: (...args: unknown[]) => unknown): string[] {
	const source = Function.prototype.toString.call(fn);
	const openIndex = source.indexOf('(');
	if (openIndex === -1) {
		return [];
	}
	let index = openIndex + 1;
	let depth = 1;
	let closeIndex = source.length;
	while (index < source.length) {
		const ch = source.charAt(index);
		if (ch === '(') {
			depth += 1;
		} else if (ch === ')') {
			depth -= 1;
			if (depth === 0) {
				closeIndex = index;
				break;
			}
		}
		index += 1;
	}
	if (depth !== 0 || closeIndex <= openIndex) {
		return [];
	}
	const slice = source.slice(openIndex + 1, closeIndex);
	const withoutBlockComments = slice.replace(/\/\*[\s\S]*?\*\//g, '');
	const withoutLineComments = withoutBlockComments.replace(/\/\/.*$/gm, '');
	const rawTokens = withoutLineComments.split(',');
	const names: string[] = [];
	for (let i = 0; i < rawTokens.length; i += 1) {
		const token = rawTokens[i].trim();
		if (token.length === 0) {
			continue;
		}
		names.push(sanitizeParameterName(token, i));
	}
	return names;
}

function sanitizeParameterName(token: string, index: number): string {
	let candidate = token.trim();
	if (candidate.length === 0) {
		return `arg${index + 1}`;
	}
	if (candidate.startsWith('...')) {
		return '...';
	}
	const equalsIndex = candidate.indexOf('=');
	if (equalsIndex >= 0) {
		candidate = candidate.slice(0, equalsIndex).trim();
	}
	const colonIndex = candidate.indexOf(':');
	if (colonIndex >= 0) {
		candidate = candidate.slice(0, colonIndex).trim();
	}
	const bracketIndex = Math.max(candidate.indexOf('{'), candidate.indexOf('['));
	if (bracketIndex !== -1) {
		return `arg${index + 1}`;
	}
	const sanitized = candidate.replace(/[^A-Za-z0-9_]/g, '');
	if (sanitized.length === 0) {
		return `arg${index + 1}`;
	}
	return sanitized;
}

export type LuaDiagnosticSeverity = 'error' | 'warning';

export type LuaDiagnostic = {
	row: number;
	startColumn: number;
	endColumn: number;
	message: string;
	severity: LuaDiagnosticSeverity;
};

export type LuaDiagnosticOptions = {
	source: string;
	chunkName: string;
	localSymbols: readonly ConsoleLuaSymbolEntry[];
	globalSymbols: readonly ConsoleLuaSymbolEntry[];
	builtinDescriptors: readonly ConsoleLuaBuiltinDescriptor[];
	apiSignatures: Map<string, ApiCompletionMetadata>;
};

export function computeLuaDiagnostics(options: LuaDiagnosticOptions): LuaDiagnostic[] {
	const diagnostics: LuaDiagnostic[] = [];
	const functionSignatures = new Map<string, FunctionSignatureInfo>();
	let chunk: LuaChunk;
	try {
		chunk = parseLuaChunk(options.source, options.chunkName);
	} catch (error) {
		if (error instanceof LuaSyntaxError) {
			const row = error.line > 0 ? error.line - 1 : 0;
			const startColumn = error.column > 0 ? error.column - 1 : 0;
			const endColumn = startColumn + 1;
			diagnostics.push({
				row,
				startColumn,
				endColumn,
				message: error.message,
				severity: 'error',
			});
			return diagnostics;
		}
		throw error;
	}

	const globalKnownNames = buildGlobalKnownNameSet(options.localSymbols, options.globalSymbols, options.builtinDescriptors, options.apiSignatures);
	const builtinLookup = buildBuiltinLookup(options.builtinDescriptors);
	const scopeStack: Array<Set<string>> = [new Set<string>()];

	const declareInCurrentScope = (name: string): void => {
		if (name.length === 0) {
			return;
		}
		scopeStack[scopeStack.length - 1].add(name);
	};

	const pushScope = (): void => {
		scopeStack.push(new Set<string>());
	};

	const popScope = (): void => {
		if (scopeStack.length > 1) {
			scopeStack.pop();
		}
	};

	const isNameDefined = (name: string): boolean => {
		if (name.length === 0) {
			return true;
		}
		for (let index = scopeStack.length - 1; index >= 0; index -= 1) {
			if (scopeStack[index].has(name)) {
				return true;
			}
		}
		return globalKnownNames.has(name);
	};

	const addIdentifierDiagnostic = (identifier: LuaIdentifierExpression): void => {
		const name = identifier.name;
		if (name.length === 0) {
			return;
		}
		if (isNameDefined(name)) {
			return;
		}
		const row = identifier.range.start.line > 0 ? identifier.range.start.line - 1 : 0;
		const startColumn = identifier.range.start.column > 0 ? identifier.range.start.column - 1 : 0;
		const rawLength = name.length;
		const adjustedLength = rawLength > 0 ? rawLength : 1;
		const endColumn = startColumn + adjustedLength;
		diagnostics.push({
			row,
			startColumn,
			endColumn,
			message: `'${name}' is not defined.`,
			severity: 'error',
		});
	};

	const analyzeCallExpression = (call: LuaCallExpression): void => {
		const metadata = resolveCallSignature(call, builtinLookup, options.apiSignatures);
		if (metadata) {
			validateCallArity(call, metadata, diagnostics);
			return;
		}
		const userMetadata = resolveUserFunctionSignature(call, functionSignatures);
		if (userMetadata) {
			validateCallArity(call, userMetadata, diagnostics);
		}
	};

	const visitExpression = (expression: LuaExpression, allowIdentifierCheck: boolean): void => {
		switch (expression.kind) {
			case LuaSyntaxKind.IdentifierExpression: {
				if (allowIdentifierCheck) {
					addIdentifierDiagnostic(expression as LuaIdentifierExpression);
				}
				break;
			}
			case LuaSyntaxKind.CallExpression: {
				const call = expression as LuaCallExpression;
				visitExpression(call.callee, true);
				for (let index = 0; index < call.arguments.length; index += 1) {
					visitExpression(call.arguments[index], true);
				}
				analyzeCallExpression(call);
				break;
			}
			case LuaSyntaxKind.MemberExpression: {
				const member = expression as LuaMemberExpression;
				visitExpression(member.base, true);
				break;
			}
			case LuaSyntaxKind.IndexExpression: {
				const indexExpression = expression as LuaIndexExpression;
				visitExpression(indexExpression.base, true);
				visitExpression(indexExpression.index, true);
				break;
			}
			case LuaSyntaxKind.BinaryExpression: {
				const binary = expression as LuaBinaryExpression;
				visitExpression(binary.left, true);
				visitExpression(binary.right, true);
				break;
			}
			case LuaSyntaxKind.UnaryExpression: {
				const unary = expression as LuaUnaryExpression;
				visitExpression(unary.operand, true);
				break;
			}
		case LuaSyntaxKind.FunctionExpression: {
			visitFunctionExpression(expression as LuaFunctionExpression, false, null);
			break;
		}
			case LuaSyntaxKind.TableConstructorExpression: {
				const tableExpression = expression as LuaTableConstructorExpression;
				for (let i = 0; i < tableExpression.fields.length; i += 1) {
					const field = tableExpression.fields[i];
					if (field.kind === LuaTableFieldKind.Array) {
						const arrayField = field as LuaTableArrayField;
						visitExpression(arrayField.value, true);
						continue;
					}
					if (field.kind === LuaTableFieldKind.IdentifierKey) {
						const identifierField = field as LuaTableIdentifierField;
						visitExpression(identifierField.value, true);
						continue;
					}
					const expressionField = field as LuaTableExpressionField;
					visitExpression(expressionField.key, true);
					visitExpression(expressionField.value, true);
				}
				break;
			}
			default:
				break;
		}
	};

	const visitFunctionExpression = (
		expression: LuaFunctionExpression,
		implicitSelf: boolean,
		binding: { path: string; style: 'function' | 'method' } | null,
	): void => {
		if (binding) {
			registerFunctionFromExpression(functionSignatures, binding.path, expression, binding.style);
		}
		pushScope();
		if (implicitSelf) {
			declareInCurrentScope('self');
		}
		for (let index = 0; index < expression.parameters.length; index += 1) {
			const parameter = expression.parameters[index];
			declareInCurrentScope(parameter.name);
		}
		if (expression.hasVararg) {
			declareInCurrentScope('...');
		}
		visitBlockBody(expression.body);
		popScope();
	};

	const visitAssignmentTarget = (target: LuaAssignableExpression): void => {
		if (target.kind === LuaSyntaxKind.IdentifierExpression) {
			return;
		}
		if (target.kind === LuaSyntaxKind.MemberExpression) {
			const member = target as LuaMemberExpression;
			visitExpression(member.base, true);
			return;
		}
		if (target.kind === LuaSyntaxKind.IndexExpression) {
			const indexExpression = target as LuaIndexExpression;
			visitExpression(indexExpression.base, true);
			visitExpression(indexExpression.index, true);
		}
	};

	const visitStatement = (statement: LuaStatement): void => {
		switch (statement.kind) {
			case LuaSyntaxKind.LocalAssignmentStatement: {
				const localAssignment = statement as LuaLocalAssignmentStatement;
				const mappedValues = mapAssignmentValues(localAssignment.names.length, localAssignment.values);
				const processed = new Set<LuaExpression>();
				for (let index = 0; index < localAssignment.names.length; index += 1) {
					const identifier = localAssignment.names[index];
					declareInCurrentScope(identifier.name);
					const value = mappedValues[index];
					if (!value) {
						continue;
					}
					if (value.kind === LuaSyntaxKind.FunctionExpression) {
						visitFunctionExpression(value as LuaFunctionExpression, false, { path: identifier.name, style: 'function' });
						processed.add(value);
						continue;
					}
					visitExpression(value, true);
					processed.add(value);
				}
				for (let index = 0; index < localAssignment.values.length; index += 1) {
					const value = localAssignment.values[index];
					if (!value || processed.has(value)) {
						continue;
					}
					visitExpression(value, true);
				}
				break;
			}
			case LuaSyntaxKind.LocalFunctionStatement: {
				const localFunction = statement as LuaLocalFunctionStatement;
				declareInCurrentScope(localFunction.name.name);
				visitFunctionExpression(localFunction.functionExpression, false, { path: localFunction.name.name, style: 'function' });
				break;
			}
			case LuaSyntaxKind.FunctionDeclarationStatement: {
				const functionDeclaration = statement as LuaFunctionDeclarationStatement;
				const identifiers = functionDeclaration.name.identifiers;
				if (identifiers.length > 0) {
					const declaredName = identifiers[identifiers.length - 1];
					if (declaredName.length > 0) {
						globalKnownNames.add(declaredName);
					}
				}
				const methodName = functionDeclaration.name.methodName;
				const basePath = identifiers.join('.');
				if (methodName) {
					const colonPath = basePath.length > 0 ? `${basePath}:${methodName}` : methodName;
					visitFunctionExpression(functionDeclaration.functionExpression, true, { path: colonPath, style: 'method' });
				} else {
					const path = basePath;
					visitFunctionExpression(functionDeclaration.functionExpression, false, { path, style: 'function' });
				}
				break;
			}
			case LuaSyntaxKind.AssignmentStatement: {
				const assignment = statement as LuaAssignmentStatement;
				const mappedValues = mapAssignmentValues(assignment.left.length, assignment.right);
				const processed = new Set<LuaExpression>();
				for (let index = 0; index < assignment.left.length; index += 1) {
					const target = assignment.left[index];
					visitAssignmentTarget(target);
					if (target.kind === LuaSyntaxKind.IdentifierExpression) {
						const identifier = target as LuaIdentifierExpression;
						globalKnownNames.add(identifier.name);
						declareInCurrentScope(identifier.name);
					}
					const value = mappedValues[index];
					if (!value) {
						continue;
					}
					if (value.kind === LuaSyntaxKind.FunctionExpression) {
						const path = buildAssignmentPath(target);
						if (path) {
							visitFunctionExpression(value as LuaFunctionExpression, false, { path, style: 'function' });
						} else {
							visitFunctionExpression(value as LuaFunctionExpression, false, null);
						}
						processed.add(value);
						continue;
					}
					visitExpression(value, true);
					processed.add(value);
				}
				for (let index = 0; index < assignment.right.length; index += 1) {
					const value = assignment.right[index];
					if (!value || processed.has(value)) {
						continue;
					}
					visitExpression(value, true);
				}
				break;
			}
			case LuaSyntaxKind.CallStatement: {
				const callStatement = statement as LuaCallStatement;
				visitExpression(callStatement.expression, true);
				break;
			}
			case LuaSyntaxKind.ReturnStatement: {
				const returnStatement = statement as LuaReturnStatement;
				for (let index = 0; index < returnStatement.expressions.length; index += 1) {
					visitExpression(returnStatement.expressions[index], true);
				}
				break;
			}
			case LuaSyntaxKind.IfStatement: {
				const ifStatement = statement as LuaIfStatement;
				for (let index = 0; index < ifStatement.clauses.length; index += 1) {
					const clause = ifStatement.clauses[index];
					if (clause.condition) {
						visitExpression(clause.condition, true);
					}
					visitBlock(clause.block);
				}
				break;
			}
			case LuaSyntaxKind.WhileStatement: {
				const whileStatement = statement as LuaWhileStatement;
				visitExpression(whileStatement.condition, true);
				visitBlock(whileStatement.block);
				break;
			}
			case LuaSyntaxKind.RepeatStatement: {
				const repeatStatement = statement as LuaRepeatStatement;
				visitBlock(repeatStatement.block);
				visitExpression(repeatStatement.condition, true);
				break;
			}
			case LuaSyntaxKind.DoStatement: {
				const doStatement = statement as LuaDoStatement;
				visitBlock(doStatement.block);
				break;
			}
			case LuaSyntaxKind.ForNumericStatement: {
				const forNumeric = statement as LuaForNumericStatement;
				visitExpression(forNumeric.start, true);
				visitExpression(forNumeric.limit, true);
				if (forNumeric.step) {
					visitExpression(forNumeric.step, true);
				}
				pushScope();
				declareInCurrentScope(forNumeric.variable.name);
				visitBlockBody(forNumeric.block);
				popScope();
				break;
			}
			case LuaSyntaxKind.ForGenericStatement: {
				const forGeneric = statement as LuaForGenericStatement;
				for (let index = 0; index < forGeneric.iterators.length; index += 1) {
					visitExpression(forGeneric.iterators[index], true);
				}
				pushScope();
				for (let index = 0; index < forGeneric.variables.length; index += 1) {
					declareInCurrentScope(forGeneric.variables[index].name);
				}
				visitBlockBody(forGeneric.block);
				popScope();
				break;
			}
			default:
				break;
		}
	};

	const visitBlockBody = (block: LuaBlock): void => {
		for (let index = 0; index < block.body.length; index += 1) {
			visitStatement(block.body[index]);
		}
	};

	const visitBlock = (block: LuaBlock): void => {
		pushScope();
		visitBlockBody(block);
		popScope();
	};

	const visitChunk = (root: LuaChunk): void => {
		for (let index = 0; index < root.body.length; index += 1) {
			visitStatement(root.body[index]);
		}
	};

	pushScope();
	visitChunk(chunk);
	popScope();

	return diagnostics;
}

function buildGlobalKnownNameSet(
	localSymbols: readonly ConsoleLuaSymbolEntry[],
	globalSymbols: readonly ConsoleLuaSymbolEntry[],
	builtinDescriptors: readonly ConsoleLuaBuiltinDescriptor[],
	apiSignatures: Map<string, ApiCompletionMetadata>,
): Set<string> {
	const names = new Set<string>();
	names.add('api');
	const defaultGlobals = ['math', 'string', 'table', 'os', 'coroutine', 'debug', 'io', 'utf8', 'bit32'];
	for (let i = 0; i < defaultGlobals.length; i += 1) {
		names.add(defaultGlobals[i]);
	}
	for (let index = 0; index < localSymbols.length; index += 1) {
		const entry = localSymbols[index];
		if (entry && entry.name.length > 0) {
			names.add(entry.name);
		}
	}
	for (let index = 0; index < globalSymbols.length; index += 1) {
		const entry = globalSymbols[index];
		if (entry && entry.name.length > 0) {
			names.add(entry.name);
		}
	}
	for (let index = 0; index < builtinDescriptors.length; index += 1) {
		const descriptor = builtinDescriptors[index];
		if (!descriptor || descriptor.name.length === 0) {
			continue;
		}
		const dotIndex = descriptor.name.indexOf('.');
		if (dotIndex !== -1) {
			const root = descriptor.name.slice(0, dotIndex);
			if (root.length > 0) {
				names.add(root);
			}
		} else {
			names.add(descriptor.name);
		}
	}
	// Also expose API method names as globals, since the runtime registers them globally
	for (const [name] of apiSignatures) {
		if (name && name.length > 0) {
			names.add(name);
		}
	}
	names.add('self');
	return names;
}

function buildBuiltinLookup(builtinDescriptors: readonly ConsoleLuaBuiltinDescriptor[]): Map<string, ConsoleLuaBuiltinDescriptor> {
	const map = new Map<string, ConsoleLuaBuiltinDescriptor>();
	for (let index = 0; index < builtinDescriptors.length; index += 1) {
		const descriptor = builtinDescriptors[index];
		if (!descriptor || descriptor.name.length === 0) {
			continue;
		}
		map.set(descriptor.name.toLowerCase(), descriptor);
	}
	return map;
}

type CallSignatureMetadata = {
	params: readonly string[];
	label: string;
	callStyle?: 'function' | 'method';
	declarationStyle?: 'function' | 'method';
	hasVararg?: boolean;
};

function resolveCallSignature(
	call: LuaCallExpression,
	builtinLookup: Map<string, ConsoleLuaBuiltinDescriptor>,
	apiSignatures: Map<string, ApiCompletionMetadata>,
): CallSignatureMetadata | null {
	if (!call) {
		return null;
	}
	if (call.methodName !== null) {
		const qualified = resolveQualifiedName(call.callee);
		if (qualified && qualified.parts.length > 0 && qualified.parts[0] === 'api') {
			const apiMeta = apiSignatures.get(call.methodName);
			if (apiMeta) {
				return {
					params: apiMeta.params,
					label: `api.${call.methodName}`,
					callStyle: 'method',
					declarationStyle: 'function',
					hasVararg: apiMeta.params.some(param => param === '...' || param.endsWith('...')),
				};
			}
		}
		return null;
	}
	const qualified = resolveQualifiedName(call.callee);
	if (!qualified) {
		return null;
	}
	if (qualified.parts.length >= 2 && qualified.parts[0] === 'api') {
		const method = qualified.parts[qualified.parts.length - 1];
		const apiMeta = apiSignatures.get(method);
		if (apiMeta) {
			return {
				params: apiMeta.params,
				label: `api.${method}`,
				callStyle: 'function',
				declarationStyle: 'function',
				hasVararg: apiMeta.params.some(param => param === '...' || param.endsWith('...')),
			};
		}
	}
	const key = qualified.parts.join('.').toLowerCase();
	const builtin = builtinLookup.get(key);
	if (builtin) {
		return {
			params: builtin.params,
			label: builtin.name,
			callStyle: 'function',
			declarationStyle: 'function',
			hasVararg: builtin.params.some(param => param === '...' || param.endsWith('...')),
		};
	}
	// Fallback: treat API methods as global functions (runtime registers them globally)
	const apiMetaAsGlobal = apiSignatures.get(key);
	if (apiMetaAsGlobal) {
		return {
			params: apiMetaAsGlobal.params,
			label: key,
			callStyle: 'function',
			declarationStyle: 'function',
			hasVararg: apiMetaAsGlobal.params.some(param => param === '...' || param.endsWith('...')),
		};
	}
	return null;
}

type QualifiedName = {
	parts: string[];
};

type FunctionCallInfo = {
	path: string;
	style: 'function' | 'method';
};

function resolveQualifiedName(expression: LuaExpression): QualifiedName | null {
	const parts: string[] = [];
	let current: LuaExpression | null = expression;
	while (current) {
		if (current.kind === LuaSyntaxKind.IdentifierExpression) {
			const identifier = current as LuaIdentifierExpression;
			if (identifier.name.length === 0) {
				return null;
			}
			parts.unshift(identifier.name);
			return { parts };
		}
		if (current.kind === LuaSyntaxKind.MemberExpression) {
			const member = current as LuaMemberExpression;
			if (member.identifier.length === 0) {
				return null;
			}
			parts.unshift(member.identifier);
			current = member.base;
			continue;
		}
		if (current.kind === LuaSyntaxKind.IndexExpression) {
			return null;
		}
		return null;
	}
	return null;
}

type ParameterRequirement = {
	required: number;
};

type FunctionSignatureInfo = {
	params: string[];
	hasVararg: boolean;
	declarationStyle: 'function' | 'method';
};

function determineParameterRequirements(params: readonly string[]): ParameterRequirement {
	let required = 0;
	for (let index = 0; index < params.length; index += 1) {
		const original = params[index];
		if (!original) {
			continue;
		}
		let token = original.trim();
		if (token.length === 0) {
			continue;
		}
		if (token === '...' || token.endsWith('...')) {
			continue;
		}
		const isOptional = token.endsWith('?');
		if (!isOptional) {
			required += 1;
		}
	}
	return { required };
}

function mapAssignmentValues<T>(targetCount: number, values: ReadonlyArray<T>): Array<T | null> {
	const mapped: Array<T | null> = [];
	if (targetCount <= 0) {
		return mapped;
	}
	for (let index = 0; index < targetCount; index += 1) {
		mapped.push(index < values.length ? values[index] : null);
	}
	return mapped;
}

function registerFunctionSignatureExplicit(
	signatures: Map<string, FunctionSignatureInfo>,
	path: string | null,
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
	path: string | null,
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

function buildMemberBasePath(expression: LuaExpression): string | null {
	if (expression.kind === LuaSyntaxKind.IdentifierExpression) {
		const identifier = expression as LuaIdentifierExpression;
		return identifier.name;
	}
	if (expression.kind === LuaSyntaxKind.MemberExpression) {
		const member = expression as LuaMemberExpression;
		const parent = buildMemberBasePath(member.base);
		if (parent === null) {
			return null;
		}
		return parent.length === 0 ? member.identifier : `${parent}.${member.identifier}`;
	}
	if (expression.kind === LuaSyntaxKind.IndexExpression) {
		const indexExpression = expression as LuaIndexExpression;
		if (indexExpression.index.kind === LuaSyntaxKind.StringLiteralExpression) {
			const literal = indexExpression.index as LuaStringLiteralExpression;
			const base = buildMemberBasePath(indexExpression.base);
			if (base === null) {
				return null;
			}
			return `${base}.${literal.value}`;
		}
		return null;
	}
	return null;
}

function buildAssignmentPath(target: LuaAssignableExpression): string | null {
	if (target.kind === LuaSyntaxKind.IdentifierExpression) {
		return (target as LuaIdentifierExpression).name;
	}
	if (target.kind === LuaSyntaxKind.MemberExpression || target.kind === LuaSyntaxKind.IndexExpression) {
		return buildMemberBasePath(target as unknown as LuaExpression);
	}
	return null;
}

function convertMethodPathToProperty(path: string): string | null {
	const index = path.lastIndexOf(':');
	if (index === -1) {
		return null;
	}
	const prefix = path.slice(0, index);
	const suffix = path.slice(index + 1);
	return prefix.length > 0 ? `${prefix}.${suffix}` : suffix;
}

function convertPropertyPathToMethod(path: string): string | null {
	const index = path.lastIndexOf('.');
	if (index === -1) {
		return null;
	}
	const prefix = path.slice(0, index);
	const suffix = path.slice(index + 1);
	return prefix.length > 0 ? `${prefix}:${suffix}` : suffix;
}

function buildCallInfo(call: LuaCallExpression): FunctionCallInfo | null {
	if (call.methodName !== null) {
		const basePath = buildMemberBasePath(call.callee);
		if (!basePath) {
			return null;
		}
		const path = basePath.length > 0 ? `${basePath}:${call.methodName}` : call.methodName;
		return { path, style: 'method' };
	}
	const qualified = resolveQualifiedName(call.callee);
	if (!qualified) {
		return null;
	}
	const path = qualified.parts.join('.');
	return { path, style: 'function' };
}

function resolveUserFunctionSignature(
	call: LuaCallExpression,
	signatures: Map<string, FunctionSignatureInfo>,
): CallSignatureMetadata | null {
	const callInfo = buildCallInfo(call);
	if (!callInfo) {
		return null;
	}
	const direct = signatures.get(callInfo.path);
	if (direct) {
		return {
			params: direct.params,
			label: callInfo.path,
			callStyle: callInfo.style,
			declarationStyle: direct.declarationStyle,
			hasVararg: direct.hasVararg,
		};
	}
	if (callInfo.style === 'method') {
		const dotPath = convertMethodPathToProperty(callInfo.path);
		if (dotPath) {
			const fallback = signatures.get(dotPath);
			if (fallback) {
				return {
					params: fallback.params,
					label: dotPath,
					callStyle: callInfo.style,
					declarationStyle: fallback.declarationStyle,
					hasVararg: fallback.hasVararg,
				};
			}
		}
	} else {
		const colonPath = convertPropertyPathToMethod(callInfo.path);
		if (colonPath) {
			const fallback = signatures.get(colonPath);
			if (fallback) {
				return {
					params: fallback.params,
					label: colonPath,
					callStyle: callInfo.style,
					declarationStyle: fallback.declarationStyle,
					hasVararg: fallback.hasVararg,
				};
			}
		}
	}
	return null;
}

function isSelfParameter(name: string | undefined): boolean {
	if (!name) {
		return false;
	}
	const normalized = name.trim().toLowerCase();
	return normalized === 'self' || normalized === 'this';
}

function validateCallArity(
	call: LuaCallExpression,
	metadata: CallSignatureMetadata,
	diagnostics: LuaDiagnostic[],
): void {
	const requirement = determineParameterRequirements(metadata.params);
	let required = requirement.required;
	const actualCount = call.arguments.length;
	if (metadata.declarationStyle === 'method' && metadata.callStyle === 'function') {
		required += 1;
	} else if (metadata.declarationStyle === 'function' && metadata.callStyle === 'method') {
		if (isSelfParameter(metadata.params[0])) {
			required = Math.max(0, required - 1);
		}
	}
	if (actualCount >= required) {
		return;
	}
	const row = call.range.start.line > 0 ? call.range.start.line - 1 : 0;
	const startColumn = call.range.start.column > 0 ? call.range.start.column - 1 : 0;
	const endColumnCandidate = call.range.end.column;
	const endColumn = endColumnCandidate > startColumn ? endColumnCandidate : startColumn + 1;
	const missing = required - actualCount;
	const expectedLabel = required === 1 ? 'argument' : 'arguments';
	const providedLabel = actualCount === 1 ? 'was' : 'were';
	const message = `${metadata.label} expects ${required} ${expectedLabel}, but ${actualCount} ${providedLabel} provided${missing > 0 ? ` (${missing} missing)` : ''}.`;
	diagnostics.push({
		row,
		startColumn,
		endColumn,
		message,
		severity: 'error',
	});
}

function parseLuaChunk(source: string, chunkName: string): LuaChunk {
	const lexer = new LuaLexer(source, chunkName);
	const tokens = lexer.scanTokens();
	const parser = new LuaParser(tokens, chunkName, source);
	return parser.parseChunk();
}

function convertRange(range: LuaSourceRange): ConsoleLuaDefinitionRange {
	return {
		startLine: range.start.line,
		startColumn: range.start.column,
		endLine: range.end.line,
		endColumn: range.end.column,
	};
}

function truncateSourceAtSyntaxError(source: string, error: LuaSyntaxError): string | null {
	if (!Number.isFinite(error.line)) {
		return null;
	}
	const lines = source.split('\n');
	const lineIndex = error.line - 1;
	if (lineIndex < 0 || lineIndex >= lines.length) {
		return null;
	}
	const truncated: string[] = [];
	for (let index = 0; index < lineIndex; index += 1) {
		truncated.push(lines[index]);
	}
	if (lineIndex < lines.length) {
		const column = Number.isFinite(error.column) ? Math.max(0, error.column - 1) : lines[lineIndex].length;
		const prefix = lines[lineIndex].slice(0, column);
		if (prefix.trim().length > 0) {
			truncated.push(prefix);
		}
	}
	return truncated.join('\n');
}
