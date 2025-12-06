import type { LuaDefinitionInfo, LuaDefinitionKind, LuaForGenericStatement, LuaForNumericStatement, LuaFunctionExpression, LuaMemberExpression, LuaReturnStatement, LuaSourceRange, LuaStringLiteralExpression, LuaTableArrayField, LuaTableExpressionField, LuaTableIdentifierField } from '../../lua/ast';
import { LuaSyntaxKind, LuaTableFieldKind, type LuaAssignableExpression, type LuaAssignmentStatement, type LuaBinaryExpression, type LuaBlock, type LuaCallExpression, type LuaChunk, type LuaDoStatement, type LuaExpression, type LuaIdentifierExpression, type LuaIndexExpression, type LuaLocalAssignmentStatement, type LuaLocalFunctionStatement, type LuaTableConstructorExpression, type LuaCallStatement, type LuaFunctionDeclarationStatement, type LuaIfStatement, type LuaRepeatStatement, type LuaStatement, type LuaUnaryExpression, type LuaWhileStatement } from '../../lua/ast';
import { LuaEnvironment } from '../../lua/environment';
import { LuaSyntaxError } from '../../lua/errors';
import { LuaLexer } from '../../lua/lexer';
import { parseLuaChunk, parseLuaChunkWithRecovery } from './lua_parse';
import { LuaInterpreter } from '../../lua/runtime';
import { extractErrorMessage, isLuaFunctionValue, isLuaNativeValue, isLuaTable, LuaFunctionValue, LuaNativeValue, LuaTable, LuaValue, resolveNativeTypeName } from '../../lua/value';
import { BmsxConsoleApi } from '../api';
import { CONSOLE_API_METHOD_METADATA } from '../api_metadata';
import { BmsxConsoleRuntime } from '../runtime';
import type { ConsoleLuaBuiltinDescriptor, ConsoleLuaDefinitionLocation, ConsoleLuaDefinitionRange, ConsoleLuaHoverRequest, ConsoleLuaHoverResult, ConsoleLuaHoverScope, ConsoleLuaMemberCompletion, ConsoleLuaMemberCompletionRequest, ConsoleLuaSymbolEntry } from '../types';
import { resolveDefinitionLocationForExpression, type ProjectReferenceEnvironment } from './code_reference';
import { applyDefinitionSelection, beginNavigationCapture, completeNavigation, focusChunkSource, listResourcesStrict, resolvePointerColumn, resolvePointerRow, safeInspectLuaExpression } from './console_cart_editor';
import * as constants from './constants';
import { activateCodeTab, findCodeTabContext, getActiveCodeTabContext, isCodeTabActive, isReadOnlyCodeTab, setActiveTab } from './editor_tabs';
import { ide_state } from './ide_state';
import { buildLuaSemanticModel, LuaSemanticModel } from './semantic_model';
import { isLuaCommentContext, wrapOverlayLine } from './text_utils';
import type { ApiCompletionMetadata, CodeTabContext, LuaCompletionItem, PointerSnapshot } from './types';
export const CONSOLE_PREVIEW_MAX_ENTRIES = 12;
export const CONSOLE_PREVIEW_MAX_DEPTH = 2;

export const KEYWORDS = new Set([
	'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'goto', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while',
]);

const SYMBOL_PRIORITY_ORDER: LuaDefinitionKind[] = ['table_field', 'function', 'parameter', 'variable', 'assignment'];
const LOCAL_DEFINITION_PRIORITY_ORDER: LuaDefinitionKind[] = ['parameter', 'table_field', 'function', 'variable', 'assignment'];

function resolveTableChain(table: LuaTable): LuaTable[] {
	const chain: LuaTable[] = [];
	let current: LuaTable = table;
	const visited = new Set<LuaTable>();
	while (current && !visited.has(current)) {
		visited.add(current);
		chain.push(current);
		const metatable = current.getMetatable();
		if (metatable) {
			const metaIndex = metatable.get('__index');
			if (isLuaTable(metaIndex)) {
				current = metaIndex;
				continue;
			}
		}
		const ownIndex = current.get('__index');
		if (isLuaTable(ownIndex)) {
			current = ownIndex;
			continue;
		}
		break;
	}
	return chain;
}

function resolveTableTypeName(table: LuaTable): string {
	const chain = resolveTableChain(table);
	for (let i = 0; i < chain.length; i += 1) {
		const direct = BmsxConsoleRuntime.instance.interpreter.resolveValueName(chain[i]);
		if (direct) {
			return direct;
		}
	}
	return null;
}

function buildDefinitionPriority(order: LuaDefinitionKind[]): (kind: LuaDefinitionKind) => number {
	const max = order.length;
	return (kind: LuaDefinitionKind): number => {
		const index = order.indexOf(kind);
		return index === -1 ? 0 : max - index;
	};
}

const definitionPriorityForSymbols = buildDefinitionPriority(SYMBOL_PRIORITY_ORDER);
const definitionPriorityForLocals = buildDefinitionPriority(LOCAL_DEFINITION_PRIORITY_ORDER);

function canonicalizeIdeIdentifier(name: string): string { // TODO: UGLY: TRIPLE IMPLEMENTATION
	if (!ide_state.caseInsensitive) {
		return name;
	}
	if (ide_state.canonicalization === 'upper') {
		return name.toUpperCase();
	}
	if (ide_state.canonicalization === 'lower') {
		return name.toLowerCase();
	}
	return name;
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

export function collectLuaModuleAliases(options: LuaScopedSymbolOptions): Map<string, string> {
	let chunk: LuaChunk;
	try {
		chunk = parseLuaChunkWithRecovery(options.source, options.chunkName).chunk;
	} catch (error) {
		if (error instanceof LuaSyntaxError) {
			return new Map();
		}
		throw error;
	}
	const aliases = new Map<string, string>();
	collectRequireAliasesFromStatements(chunk.body, aliases);
	return aliases;
}

function collectRequireAliasesFromStatements(statements: ReadonlyArray<LuaStatement>, aliases: Map<string, string>): void {
	for (let index = 0; index < statements.length; index += 1) {
		const statement = statements[index];
		switch (statement.kind) {
			case LuaSyntaxKind.LocalAssignmentStatement:
				recordLocalRequireAliases(statement as LuaLocalAssignmentStatement, aliases);
				break;
			case LuaSyntaxKind.AssignmentStatement:
				recordGlobalRequireAliases(statement as LuaAssignmentStatement, aliases);
				break;
			default:
				break;
		}
	}
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

export function getKeywordCompletions(): LuaCompletionItem[] {
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

export function getApiCompletionData(): { items: LuaCompletionItem[]; signatures: Map<string, ApiCompletionMetadata> } {
	const items: LuaCompletionItem[] = [];
	const signatures: Map<string, ApiCompletionMetadata> = new Map();
	const processed = new Set<string>();
	let prototype: object = BmsxConsoleApi.prototype;
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
				const metadata = CONSOLE_API_METHOD_METADATA[name];
				const optionalSources = new Set<string>();
				if (metadata?.optionalParameters) {
					for (let optIndex = 0; optIndex < metadata.optionalParameters.length; optIndex += 1) {
						optionalSources.add(metadata.optionalParameters[optIndex]);
					}
				}
				const parameterDescriptionMap: Map<string, string> = new Map();
				if (metadata?.parameters) {
					for (let paramIndex = 0; paramIndex < metadata.parameters.length; paramIndex += 1) {
						const paramMeta = metadata.parameters[paramIndex];
						if (!paramMeta || typeof paramMeta.name !== 'string') {
							continue;
						}
						if (paramMeta.optional) {
							optionalSources.add(paramMeta.name);
						}
						if (paramMeta.description !== undefined) {
							parameterDescriptionMap.set(paramMeta.name, paramMeta.description);
						}
					}
				}
				const optionalParams = optionalSources.size > 0 ? Array.from(optionalSources) : [];
				const parameterDescriptions = params.map(param => parameterDescriptionMap.get(param));
				const displayParams = params.map(param => (optionalSources.has(param) ? `${param}?` : param));
				const baseDetail = displayParams.length > 0
					? `api.${name}(${displayParams.join(', ')})`
					: `api.${name}()`;
				const methodDescription = metadata?.description;
				const detail = methodDescription && methodDescription.length > 0 ? `${baseDetail} • ${methodDescription}` : baseDetail;
				const item: LuaCompletionItem = {
					label: name,
					insertText: name,
					sortKey: `api:${name}`,
					kind: 'api_method',
					detail,
					parameters: displayParams,
				};
				items.push(item);
				const metadataEntry: ApiCompletionMetadata = {
					params: params.slice(),
					signature: baseDetail,
					kind: 'method',
					optionalParams,
					parameterDescriptions,
					description: methodDescription,
				};
				signatures.set(name, metadataEntry);
				const lower = name.toLowerCase();
				if (lower !== name && !signatures.has(lower)) {
					signatures.set(lower, metadataEntry);
				}
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
				const metadataEntry: ApiCompletionMetadata = { params: [], signature: detail, kind: 'getter', description: null };
				signatures.set(name, metadataEntry);
				const lower = name.toLowerCase();
				if (lower !== name && !signatures.has(lower)) {
					signatures.set(lower, metadataEntry);
				}
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
		chunk = parseLuaChunk(options.source, options.chunkName).chunk;
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
		binding: { path: string; style: 'function' | 'method' },
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
	const add = (value: string) => {
		if (!value) {
			return;
		}
		const normalized = canonicalizeIdeIdentifier(value);
		names.add(normalized);
	};
	add('api');
	const defaultGlobals = ['math', 'string', 'table', 'os', 'coroutine', 'debug', 'io', 'utf8', 'bit32'];
	const engineGlobals = ['world', 'game', 'registry', 'events', 'rompack'];
	const jsGlobals = ['Game', 'World', 'Registry', 'Events', 'Rompack', 'Math'];
	for (let i = 0; i < defaultGlobals.length; i += 1) {
		add(defaultGlobals[i]);
	}
	for (let i = 0; i < engineGlobals.length; i += 1) add(engineGlobals[i]);
	for (let i = 0; i < jsGlobals.length; i += 1) add(jsGlobals[i]);
	for (let index = 0; index < localSymbols.length; index += 1) {
		const entry = localSymbols[index];
		if (entry && entry.name.length > 0) {
			add(entry.name);
		}
	}
	for (let index = 0; index < globalSymbols.length; index += 1) {
		const entry = globalSymbols[index];
		if (!entry || entry.name.length === 0) {
			continue;
		}
		const symbolName = entry.name.trim();
		if (symbolName.length === 0) {
			continue;
		}
		add(symbolName);
		const dotIndex = symbolName.indexOf('.');
		if (dotIndex !== -1) {
			const root = symbolName.slice(0, dotIndex);
			if (root.length > 0) {
				add(root);
			}
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
				add(root);
			}
		} else {
			add(descriptor.name);
		}
	}
	// Also expose API method names as globals, since the runtime registers them globally
	for (const [name] of apiSignatures) {
		if (name && name.length > 0) {
			add(name);
		}
	}
	add('self');
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
	description?: string;
	parameterDescriptions?: readonly (string)[];
};

function resolveCallSignature(
	call: LuaCallExpression,
	builtinLookup: Map<string, ConsoleLuaBuiltinDescriptor>,
	apiSignatures: Map<string, ApiCompletionMetadata>,
): CallSignatureMetadata {
	if (!call) {
		return null;
	}
	if (call.methodName !== null) {
		const qualified = resolveQualifiedName(call.callee);
		if (qualified && qualified.parts.length > 0 && qualified.parts[0] === 'api') {
			const apiMeta = apiSignatures.get(call.methodName);
			if (apiMeta) {
				const marker = applyOptionalMarkers(apiMeta.params, apiMeta.optionalParams, apiMeta.parameterDescriptions);
				return {
					params: marker.params,
					label: `api.${call.methodName}`,
					callStyle: 'method',
					declarationStyle: 'function',
					hasVararg: apiMeta.params.some(param => param === '...' || param.endsWith('...')),
					description: apiMeta.description,
					parameterDescriptions: marker.descriptions,
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
			const marker = applyOptionalMarkers(apiMeta.params, apiMeta.optionalParams, apiMeta.parameterDescriptions);
			return {
				params: marker.params,
				label: `api.${method}`,
				callStyle: 'function',
				declarationStyle: 'function',
				hasVararg: apiMeta.params.some(param => param === '...' || param.endsWith('...')),
				description: apiMeta.description,
				parameterDescriptions: marker.descriptions,
			};
		}
	}
	const key = qualified.parts.join('.').toLowerCase();
	const builtin = builtinLookup.get(key);
	if (builtin) {
		const marker = applyOptionalMarkers(builtin.params, builtin.optionalParams, builtin.parameterDescriptions);
		return {
			params: marker.params,
			label: builtin.name,
			callStyle: 'function',
			declarationStyle: 'function',
			hasVararg: builtin.params.some(param => param === '...' || param.endsWith('...')),
			description: builtin.description,
			parameterDescriptions: marker.descriptions,
		};
	}
	// Fallback: treat API methods as global functions (runtime registers them globally)
	const apiMetaAsGlobal = apiSignatures.get(key);
	if (apiMetaAsGlobal) {
		const marker = applyOptionalMarkers(apiMetaAsGlobal.params, apiMetaAsGlobal.optionalParams, apiMetaAsGlobal.parameterDescriptions);
		return {
			params: marker.params,
			label: key,
			callStyle: 'function',
			declarationStyle: 'function',
			hasVararg: apiMetaAsGlobal.params.some(param => param === '...' || param.endsWith('...')),
			description: apiMetaAsGlobal.description,
			parameterDescriptions: marker.descriptions,
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

function applyOptionalMarkers(
	params: readonly string[],
	optionalParams?: readonly string[],
	parameterDescriptions?: readonly (string)[],
): { params: string[]; descriptions: (string)[] } {
	if (!params || params.length === 0) {
		return { params: [], descriptions: [] };
	}
	const optionalSet = optionalParams && optionalParams.length > 0 ? new Set(optionalParams) : null;
	const resultParams: string[] = [];
	const resultDescriptions: (string)[] = [];
	for (let index = 0; index < params.length; index += 1) {
		const param = params[index];
		if (!param || param.length === 0) {
			continue;
		}
		const description = parameterDescriptions && index < parameterDescriptions.length ? parameterDescriptions[index] : null;
		if (optionalSet && optionalSet.has(param)) {
			resultParams.push(param.endsWith('?') ? param : `${param}?`);
			resultDescriptions.push(description);
			continue;
		}
		resultParams.push(param);
		resultDescriptions.push(description);
	}
	return { params: resultParams, descriptions: resultDescriptions };
}

function resolveQualifiedName(expression: LuaExpression): QualifiedName {
	const parts: string[] = [];
	let current: LuaExpression = expression;
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

function mapAssignmentValues<T>(targetCount: number, values: ReadonlyArray<T>): Array<T> {
	const mapped: Array<T> = [];
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

function buildMemberBasePath(expression: LuaExpression): string {
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

function buildAssignmentPath(target: LuaAssignableExpression): string {
	if (target.kind === LuaSyntaxKind.IdentifierExpression) {
		return (target as LuaIdentifierExpression).name;
	}
	if (target.kind === LuaSyntaxKind.MemberExpression || target.kind === LuaSyntaxKind.IndexExpression) {
		return buildMemberBasePath(target as unknown as LuaExpression);
	}
	return null;
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

function convertPropertyPathToMethod(path: string): string {
	const index = path.lastIndexOf('.');
	if (index === -1) {
		return null;
	}
	const prefix = path.slice(0, index);
	const suffix = path.slice(index + 1);
	return prefix.length > 0 ? `${prefix}:${suffix}` : suffix;
}

function buildCallInfo(call: LuaCallExpression): FunctionCallInfo {
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
): CallSignatureMetadata {
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

function isSelfParameter(name: string): boolean {
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
	const expectedLabel = required === 1 ? 'argument' : 'arguments';
	const providedLabel = actualCount === 1 ? 'was' : 'were';
	const message = `${metadata.label} expects ${required} ${expectedLabel}, but ${actualCount} ${providedLabel} provided.`;
	diagnostics.push({
		row,
		startColumn,
		endColumn,
		message,
		severity: 'error',
	});
}

function wrapHoverLines(lines: string[]): string[] {
	const wrapWidth = Math.max(
		ide_state.spaceAdvance,
		ide_state.viewportWidth - constants.HOVER_TOOLTIP_PADDING_X * 2 - ide_state.spaceAdvance * 2
	);
	const wrapped: string[] = [];
	for (let i = 0; i < lines.length; i += 1) {
		const segments = wrapOverlayLine(lines[i], wrapWidth);
		for (let j = 0; j < segments.length; j += 1) {
			wrapped.push(segments[j]);
		}
	}
	return wrapped;
}

export function buildHoverContentLines(result: ConsoleLuaHoverResult): string[] {
	const lines: string[] = [];
	const push = (value: string) => { lines.push(value); };
	if (result.state === 'not_defined') {
		push(`${result.expression} = not defined`);
		return wrapHoverLines(lines);
	}
	const valueLines = result.lines.length > 0 ? result.lines : [''];
	if (valueLines.length === 1) {
		const suffix = result.valueType && result.valueType !== 'unknown' ? ` (${result.valueType})` : '';
		push(`${result.expression} = ${valueLines[0]}${suffix}`);
		return wrapHoverLines(lines);
	}
	const suffix = result.valueType && result.valueType !== 'unknown' ? ` (${result.valueType})` : '';
	push(`${result.expression}${suffix}`);
	for (const line of valueLines) push(`  ${line}`);
	return wrapHoverLines(lines);
}

export function intellisenseUiReady(): boolean {
	if (!isCodeTabActive()) {
		return false;
	}
	if (isReadOnlyCodeTab()) {
		return false;
	}
	if (!ide_state.windowFocused) {
		return false;
	}
	if (ide_state.searchActive || ide_state.symbolSearchActive || ide_state.lineJumpActive || ide_state.resourceSearchActive || ide_state.createResourceActive) {
		return false;
	}
	return true;
}

export function shouldAutoTriggerCompletions(): boolean {
	if (!intellisenseUiReady()) {
		return false;
	}
	const lastEditAt = ide_state.lastContentEditAtMs;
	if (lastEditAt === null) {
		return false;
	}
	const now = ide_state.clockNow();
	return now - lastEditAt <= constants.COMPLETION_TYPING_GRACE_MS;
} export function updateHoverTooltip(snapshot: PointerSnapshot): void {
	const context = getActiveCodeTabContext();
	const asset_id = resolveHoverAssetId(context);
	const row = resolvePointerRow(snapshot.viewportY);
	const column = resolvePointerColumn(row, snapshot.viewportX);
	const token = extractHoverExpression(row, column);
	if (!token) {
		clearHoverTooltip();
		return;
	}
	const chunkName = resolveHoverChunkName(context);
	const request: ConsoleLuaHoverRequest = {
		expression: token.expression,
		chunkName,
		row: row + 1,
		column: token.startColumn + 1,
	};
	const inspection = safeInspectLuaExpression(request);
	const previousInspection = ide_state.lastInspectorResult;
	ide_state.lastInspectorResult = inspection;
	if (!inspection) {
		clearHoverTooltip();
		return;
	}
	if (inspection.isFunction && (inspection.isLocalFunction || inspection.isBuiltin)) {
		clearHoverTooltip();
		return;
	}
	const contentLines = buildHoverContentLines(inspection);
	const existing = ide_state.hoverTooltip;
	if (existing && existing.expression === inspection.expression && existing.asset_id === asset_id) {
		existing.contentLines = contentLines;
		existing.valueType = inspection.valueType;
		existing.scope = inspection.scope;
		existing.state = inspection.state;
		existing.asset_id = asset_id;
		existing.row = row;
		existing.startColumn = token.startColumn;
		existing.endColumn = token.endColumn;
		existing.bubbleBounds = null;
		if (!previousInspection || previousInspection.expression !== inspection.expression) {
			existing.scrollOffset = 0;
			existing.visibleLineCount = 0;
		}
		const maxOffset = Math.max(0, contentLines.length - Math.max(1, existing.visibleLineCount));
		if (existing.scrollOffset > maxOffset) {
			existing.scrollOffset = maxOffset;
		}
		return;
	}
	ide_state.hoverTooltip = {
		expression: inspection.expression,
		contentLines,
		valueType: inspection.valueType,
		scope: inspection.scope,
		state: inspection.state,
		asset_id,
		row,
		startColumn: token.startColumn,
		endColumn: token.endColumn,
		scrollOffset: 0,
		visibleLineCount: 0,
		bubbleBounds: null,
	};
}

export function clearHoverTooltip(): void {
	ide_state.hoverTooltip = null;
	ide_state.lastInspectorResult = null;
}
export function resolveHoverAssetId(context: CodeTabContext): string {
	if (context && context.descriptor) {
		return context.descriptor.asset_id;
	}
	return null;
}

export function resolveHoverChunkName(context: CodeTabContext): string {
	if (context && context.descriptor) {
		return context.descriptor.path;
	}
	return null;
}
export function buildMemberCompletionItems(request: {
	objectName: string;
	operator: '.' | ':';
	prefix: string;
	asset_id: string;
	chunkName: string;
}): LuaCompletionItem[] {
	if (request.objectName.length === 0) {
		return [];
	}
	const response = listLuaObjectMembers({
		chunkName: request.chunkName,
		expression: request.objectName,
		operator: request.operator,
	});
	if (response.length === 0) {
		return [];
	}
	const items: LuaCompletionItem[] = [];
	for (let index = 0; index < response.length; index += 1) {
		const entry = response[index];
		if (!entry || !entry.name || entry.name.length === 0) {
			continue;
		}
		const kind = entry.kind === 'method' ? 'native_method' : 'native_property';
		const parameters = entry.parameters && entry.parameters.length > 0 ? entry.parameters.slice() : undefined;
		const detail = entry.detail;
		items.push({
			label: entry.name,
			insertText: entry.name,
			sortKey: `${kind}:${entry.name.toLowerCase()}`,
			kind,
			detail,
			parameters,
		});
	}
	items.sort((a, b) => a.label.localeCompare(b.label));
	return items;
}

export function safeJsonStringify(value: unknown, space = 2): string {
	return JSON.stringify(value, (_key, val) => {
		if (typeof val === 'bigint') {
			return Number(val);
		}
		return val;
	}, space);
}

export function describeMetadataValue(value: unknown): string {
	if (value === null || value === undefined) {
		return '<none>';
	}
	if (typeof value === 'string') {
		return value;
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	if (Array.isArray(value)) {
		const preview = value.slice(0, 4).map(entry => describeMetadataValue(entry)).join(', ');
		return `[${preview}${value.length > 4 ? ', …' : ''}]`;
	}
	if (typeof value === 'object') {
		const keys = Object.keys(value as Record<string, unknown>);
		return `{${keys.join(', ')}}`;
	}
	return String(value);
}
export function requestSemanticRefresh(context?: CodeTabContext): void {
	const activeContext = context ?? getActiveCodeTabContext();
	const chunkName = resolveHoverChunkName(activeContext) ?? '<console>';
	ide_state.layout.requestSemanticUpdate(ide_state.lines, ide_state.textVersion, chunkName);
}
export function resolveSemanticDefinitionLocation(
	context: CodeTabContext,
	expression: string,
	usageRow: number,
	usageColumn: number,
	chunkName: string
): ConsoleLuaDefinitionLocation {
	if (!expression) {
		return null;
	}
	const namePath = expression.split('.');
	if (namePath.length === 0) {
		return null;
	}
	const activeContext = getActiveCodeTabContext();
	const hoverChunkName = resolveHoverChunkName(activeContext);
	const modelChunkName = chunkName ?? hoverChunkName ?? '<console>';
	const model = ide_state.layout.getSemanticModel(ide_state.lines, ide_state.textVersion, modelChunkName);
	if (!model) {
		return null;
	}
	let definition = model.lookupIdentifier(usageRow, usageColumn, namePath);
	if (!definition) {
		definition = findDefinitionAtPosition(model.definitions, usageRow, usageColumn, namePath);
	}
	if (!definition) {
		return null;
	}
	const descriptor = context ? context.descriptor : null;
	const descriptorPath = descriptor && descriptor.path ? descriptor.path : null;
	const resolvedChunk = chunkName
		?? descriptorPath
		?? ide_state.entryAssetId
		?? hoverChunkName
		?? '<console>';
	const location: ConsoleLuaDefinitionLocation = {
		path: descriptorPath,
		chunkName: resolvedChunk,
		range: {
			startLine: definition.definition.start.line,
			startColumn: definition.definition.start.column,
			endLine: definition.definition.end.line,
			endColumn: definition.definition.end.column,
		},
	};
	if (descriptorPath) {
		location.path = descriptorPath;
	} else if (resolvedChunk && resolvedChunk !== '<console>') {
		location.path = resolvedChunk;
	}
	return location;
}

export function findDefinitionAtPosition(
	definitions: readonly LuaDefinitionInfo[],
	row: number,
	column: number,
	namePath: readonly string[]
): LuaDefinitionInfo {
	for (let index = 0; index < definitions.length; index += 1) {
		const candidate = definitions[index];
		if (candidate.namePath.length !== namePath.length) {
			continue;
		}
		let matches = true;
		for (let i = 0; i < namePath.length; i += 1) {
			if (candidate.namePath[i] !== namePath[i]) {
				matches = false;
				break;
			}
		}
		if (!matches) {
			continue;
		}
		const range = candidate.definition;
		if (row !== range.start.line) {
			continue;
		}
		if (column < range.start.column || column > range.end.column) {
			continue;
		}
		return candidate;
	}
	return null;
}

export function extractHoverExpression(row: number, column: number): { expression: string; startColumn: number; endColumn: number; } {
	if (row < 0 || row >= ide_state.lines.length) {
		return null;
	}
	const line = ide_state.lines[row] ?? '';
	const safeColumn = Math.min(Math.max(column, 0), Math.max(0, line.length));
	if (isLuaCommentContext(ide_state.lines, row, safeColumn)) {
		return null;
	}
	if (line.length === 0) {
		return null;
	}
	const clampedColumn = Math.min(Math.max(column, 0), Math.max(0, line.length - 1));
	let probe = clampedColumn;
	if (!LuaLexer.isIdentifierPart(line.charAt(probe))) {
		if (line.charCodeAt(probe) === 46 && probe > 0) {
			probe -= 1;
		}
		else if (probe > 0 && LuaLexer.isIdentifierPart(line.charAt(probe - 1))) {
			probe -= 1;
		}
		else {
			return null;
		}
	}
	let expressionStart = probe;
	while (expressionStart > 0 && LuaLexer.isIdentifierPart(line.charAt(expressionStart - 1))) {
		expressionStart -= 1;
	}
	if (!LuaLexer.isIdentifierStart(line.charAt(expressionStart))) {
		return null;
	}
	let expressionEnd = probe + 1;
	while (expressionEnd < line.length && LuaLexer.isIdentifierPart(line.charAt(expressionEnd))) {
		expressionEnd += 1;
	}
	// extend to include preceding segments (left of initial segment)
	let left = expressionStart;
	while (left > 0) {
		const dotIndex = left - 1;
		if (line.charCodeAt(dotIndex) !== 46) {
			break;
		}
		let segmentStart = dotIndex - 1;
		while (segmentStart >= 0 && LuaLexer.isIdentifierPart(line.charAt(segmentStart))) {
			segmentStart -= 1;
		}
		segmentStart += 1;
		if (segmentStart >= dotIndex) {
			break;
		}
		if (!LuaLexer.isIdentifierStart(line.charAt(segmentStart))) {
			break;
		}
		left = segmentStart;
	}
	expressionStart = left;
	let right = expressionEnd;
	while (right < line.length) {
		if (line.charCodeAt(right) !== 46) {
			break;
		}
		const identifierStart = right + 1;
		if (identifierStart >= line.length) {
			break;
		}
		if (!LuaLexer.isIdentifierStart(line.charAt(identifierStart))) {
			break;
		}
		let identifierEnd = identifierStart + 1;
		while (identifierEnd < line.length && LuaLexer.isIdentifierPart(line.charAt(identifierEnd))) {
			identifierEnd += 1;
		}
		right = identifierEnd;
	}
	expressionEnd = right;
	if (expressionEnd <= expressionStart) {
		return null;
	}
	const segments: Array<{ text: string; start: number; end: number; }> = [];
	let segmentStart = expressionStart;
	while (segmentStart < expressionEnd) {
		let segmentEnd = segmentStart;
		while (segmentEnd < expressionEnd && line.charCodeAt(segmentEnd) !== 46) {
			segmentEnd += 1;
		}
		if (segmentEnd > segmentStart) {
			segments.push({ text: line.slice(segmentStart, segmentEnd), start: segmentStart, end: segmentEnd });
		}
		segmentStart = segmentEnd + 1;
	}
	if (segments.length === 0) {
		return null;
	}
	let pointerColumn = Math.min(column, expressionEnd - 1);
	if (pointerColumn < expressionStart) {
		pointerColumn = expressionStart;
	}
	if (line.charCodeAt(pointerColumn) === 46 && pointerColumn > expressionStart) {
		pointerColumn -= 1;
	}
	let segmentIndex = -1;
	for (let i = 0; i < segments.length; i += 1) {
		const seg = segments[i];
		if (pointerColumn >= seg.start && pointerColumn < seg.end) {
			segmentIndex = i;
			break;
		}
	}
	if (segmentIndex === -1) {
		segmentIndex = segments.length - 1;
	}
	const expression = segments.slice(0, segmentIndex + 1).map(segment => segment.text).join('.');
	if (expression.length === 0) {
		return null;
	}
	const targetSegment = segments[segmentIndex];
	return { expression, startColumn: targetSegment.start, endColumn: targetSegment.end };
} export function refreshGotoHoverHighlight(row: number, column: number, context: CodeTabContext): void {
	const token = extractHoverExpression(row, column);
	if (!token) {
		clearGotoHoverHighlight();
		return;
	}
	const existing = ide_state.gotoHoverHighlight;
	if (existing
		&& existing.row === row
		&& column >= existing.startColumn
		&& column <= existing.endColumn
		&& existing.expression === token.expression) {
		return;
	}
	const chunkName = resolveHoverChunkName(context);
	let definition = resolveSemanticDefinitionLocation(context, token.expression, row + 1, token.startColumn + 1, chunkName);
	if (!definition) {
		const inspection = safeInspectLuaExpression({
			expression: token.expression,
			chunkName,
			row: row + 1,
			column: token.startColumn + 1,
		});
		definition = inspection?.definition;
	}
	if (!definition) {
		clearGotoHoverHighlight();
		return;
	}
	ide_state.gotoHoverHighlight = {
		row,
		startColumn: token.startColumn,
		endColumn: token.endColumn,
		expression: token.expression,
	};
}

export function clearGotoHoverHighlight(): void {
	ide_state.gotoHoverHighlight = null;
}

export function clearReferenceHighlights(): void {
	ide_state.referenceState.clear();
}

export function tryGotoDefinitionAt(row: number, column: number): boolean {
	const context = getActiveCodeTabContext();
	const descriptor = context ? context.descriptor : null;
	const normalizedPath = descriptor && descriptor.path ? descriptor.path : null;
	const asset_id = resolveHoverAssetId(context);
	const token = extractHoverExpression(row, column);
	if (!token) {
		ide_state.showMessage('Definition not found', constants.COLOR_STATUS_WARNING, 1.6);
		return false;
	}
	const chunkName = resolveHoverChunkName(context);
	let definition = resolveSemanticDefinitionLocation(context, token.expression, row + 1, token.startColumn + 1, chunkName);
	if (!definition) {
		const inspection = safeInspectLuaExpression({
			expression: token.expression,
			chunkName,
			row: row + 1,
			column: token.startColumn + 1,
		});
		definition = inspection?.definition;
	}
	if (!definition) {
		const resolvedChunkName = chunkName
			?? normalizedPath
			?? (descriptor ? descriptor.asset_id : null)
			?? asset_id
			?? ide_state.entryAssetId
			?? '<console>';
		const environment: ProjectReferenceEnvironment = {
			activeContext: context,
			activeLines: ide_state.lines,
			codeTabContexts: Array.from(ide_state.codeTabContexts.values()),
		};
		const projectDefinition = resolveDefinitionLocationForExpression({
			expression: token.expression,
			environment,
			workspace: ide_state.semanticWorkspace,
			currentChunkName: resolvedChunkName,
			currentLines: ide_state.lines,
			currentasset_id: asset_id,
			sourceLabelPath: normalizedPath ?? (descriptor ? descriptor.asset_id : null),
		});
		if (projectDefinition) {
			navigateToLuaDefinition(projectDefinition);
			return true;
		}
		if (!ide_state.inspectorRequestFailed) {
			ide_state.showMessage(`Definition not found for ${token.expression}`, constants.COLOR_STATUS_WARNING, 1.8);
		}
		return false;
	}
	navigateToLuaDefinition(definition);
	return true;
}

export function navigateToLuaDefinition(definition: ConsoleLuaDefinitionLocation): void {
	const navigationCheckpoint = beginNavigationCapture();
	clearReferenceHighlights();
	const hint: { asset_id: string; path?: string; } = { asset_id: definition.asset_id };
	if (definition.path !== undefined) {
		hint.path = definition.path;
	}
	let targetContextId: string = null;
	try {
		focusChunkSource(definition.chunkName, hint);
		const context = findCodeTabContext(definition.chunkName);
		if (context) {
			targetContextId = context.id;
		}
	} catch (error) {
		const message = extractErrorMessage(error);
		ide_state.showMessage(`Failed to open definition: ${message}`, constants.COLOR_STATUS_ERROR, 3.2);
		return;
	}
	if (targetContextId) {
		setActiveTab(targetContextId);
	} else {
		activateCodeTab();
	}
	applyDefinitionSelection(definition.range);
	ide_state.cursorRevealSuspended = false;
	clearHoverTooltip();
	clearGotoHoverHighlight();
	completeNavigation(navigationCheckpoint);
	ide_state.showMessage('Jumped to definition', constants.COLOR_STATUS_SUCCESS, 1.6);
}

export function inspectLuaExpression(request: ConsoleLuaHoverRequest): ConsoleLuaHoverResult {
	if (!request) {
		return null;
	}
	const expressionRaw = request.expression;
	if (typeof expressionRaw !== 'string') {
		return null;
	}
	const trimmed = expressionRaw.trim();
	if (trimmed.length === 0) {
		return null;
	}
	const chain = parseLuaIdentifierChain(trimmed);
	if (!chain) {
		return null;
	}
	const asset_id = request.asset_id && request.asset_id.length > 0 ? request.asset_id : null;
	const usageRow = Number.isFinite(request.row) ? Math.max(1, Math.floor(request.row)) : null;
	const usageColumn = Number.isFinite(request.column) ? Math.max(1, Math.floor(request.column)) : null;
	const resolved = resolveLuaChainValue(chain, asset_id);
	const staticDefinition = findStaticDefinitionLocation(chain, usageRow, usageColumn, request.chunkName);
	if (!resolved) {
		if (!staticDefinition) {
			return null;
		}
		return {
			expression: trimmed,
			lines: ['static definition'],
			valueType: 'unknown',
			scope: 'chunk',
			state: 'not_defined',
			isFunction: false,
			isLocalFunction: false,
			isBuiltin: false,
			definition: staticDefinition,
		};
	}
	if (resolved.kind === 'not_defined') {
		return {
			expression: trimmed,
			lines: ['not defined'],
			valueType: 'undefined',
			scope: resolved.scope,
			state: 'not_defined',
			isFunction: false,
			isLocalFunction: false,
			isBuiltin: false,
			definition: staticDefinition,
		};
	}
	const formatted = describeLuaValueForInspector(resolved.value);
	const isFunction = formatted.isFunction;
	const isLocalFunction = isFunction && resolved.scope === 'chunk';
	const isBuiltin = isFunction && chain.length === 1 && isLuaBuiltinFunctionName(chain[0]);
	let definition: ConsoleLuaDefinitionLocation = null;
	if (!isBuiltin) {
		definition = resolveLuaDefinitionMetadata(resolved.value, asset_id, resolved.definitionRange);
		if (!definition) {
			definition = staticDefinition;
		}
	}
	return {
		expression: trimmed,
		lines: formatted.lines,
		valueType: formatted.valueType,
		scope: resolved.scope,
		state: 'value',
		isFunction,
		isLocalFunction,
		isBuiltin,
		definition,
	};
}

export function listLuaObjectMembers(request: ConsoleLuaMemberCompletionRequest): ConsoleLuaMemberCompletion[] {
	const trimmed = request.expression.trim();
	if (trimmed.length === 0) {
		return [];
	}
	const chain = parseLuaIdentifierChain(trimmed);
	if (!chain) {
		return [];
	}
	const resolved = resolveLuaChainValue(chain, request.asset_id);
	if (!resolved || resolved.kind !== 'value') {
		return [];
	}
	const value = resolved.value;
	if (value === null) {
		return [];
	}
	if (isLuaNativeValue(value)) {
		return getNativeMemberCompletionEntries(value, request.operator);
	}
	if (isLuaTable(value)) {
		const typeName = resolveTableTypeName(value);
		return buildTableMemberCompletionEntries(value, request.operator, { typeName });
	}
	return [];
}

export function resolveLuaDefinitionMetadata(value: LuaValue, _fallbackasset_id: string, definitionRange: LuaSourceRange): ConsoleLuaDefinitionLocation {
	let range: LuaSourceRange = definitionRange;
	if (!range && value && typeof value === 'object') {
		const candidate = value as { getSourceRange?: () => LuaSourceRange };
		if (typeof candidate.getSourceRange === 'function') {
			range = candidate.getSourceRange();
		}
	}
	if (!range) {
		return null;
	}
	return buildDefinitionLocationFromRange(range);
}

export function buildDefinitionLocationFromRange(range: LuaSourceRange): ConsoleLuaDefinitionLocation {
	const normalizedChunk = range.chunkName;
	const chunkResource = getChunkResourceHint(range.chunkName);
	const asset_id = chunkResource.asset_id;
	const location: ConsoleLuaDefinitionLocation = {
		chunkName: normalizedChunk,
		asset_id,
		range: {
			startLine: range.start.line,
			startColumn: range.start.column,
			endLine: range.end.line,
			endColumn: range.end.column,
		},
	};
	location.path = chunkResource.path!;
	return location;
}

export function listLuaSymbols(chunkName: string): ConsoleLuaSymbolEntry[] {
	const bundle = getStaticDefinitions(chunkName);
	if (!bundle || bundle.definitions.length === 0) {
		return [];
	}
	const { definitions } = bundle;
	const entries = new Map<string, { info: LuaDefinitionInfo; location: ConsoleLuaDefinitionLocation; priority: number }>();
	for (const info of definitions) {
		const location = buildDefinitionLocationFromRange(info.definition);
		const path = info.namePath.length > 0 ? info.namePath.join('.') : info.name;
		const keyPath = path.length > 0 ? path : info.name;
		const key = `${location.chunkName ?? ''}::${keyPath}@${location.range.startLine}:${location.range.startColumn}`;
		const priority = definitionPriorityForSymbols(info.kind);
		const existing = entries.get(key);
		if (!existing || priority > existing.priority || (priority === existing.priority && info.definition.start.line < existing.info.definition.start.line)) {
			entries.set(key, { info, location, priority });
		}
	}
	const symbols: ConsoleLuaSymbolEntry[] = [];
	for (const { info, location } of entries.values()) {
		const path = info.namePath.length > 0 ? info.namePath.join('.') : info.name;
		symbols.push({
			name: info.name,
			path,
			kind: info.kind,
			location,
		});
	}
	symbols.sort((a, b) => {
		const aLine = a.location.range.startLine;
		const bLine = b.location.range.startLine;
		if (aLine !== bLine) {
			return aLine - bLine;
		}
		return a.path.localeCompare(b.path);
	});
	return symbols;
}

export function listLuaModuleSymbols(moduleName: string): ConsoleLuaSymbolEntry[] {
	const runtime = BmsxConsoleRuntime.instance;
	runtime.ensureLuaModuleIndex();
	const record = runtime.luaModuleAliases.get(moduleName);
	if (!record) {
		return [];
	}
	return listLuaSymbols(record.chunkName);
}

export function listLuaBuiltinFunctions(): ConsoleLuaBuiltinDescriptor[] {
	const result: ConsoleLuaBuiltinDescriptor[] = [];
	for (const metadata of BmsxConsoleRuntime.instance.luaBuiltinMetadata.values()) {
		const optionalParams = metadata.optionalParams ?? [];
		const optionalSet = optionalParams.length > 0 ? new Set(optionalParams) : null;
		const params = metadata.params.map(param => (optionalSet && optionalSet.has(param) ? `${param}?` : param));
		const parameterDescriptions = metadata.parameterDescriptions ? metadata.parameterDescriptions.slice() : undefined;
		result.push({
			name: metadata.name,
			params,
			signature: metadata.signature,
			optionalParams,
			parameterDescriptions,
			description: metadata.description,
		});
	}
	result.sort((a, b) => a.name.localeCompare(b.name));
	return result;
}

export function listGlobalLuaSymbols(): ConsoleLuaSymbolEntry[] {
	const entries = new Map<string, { info: LuaDefinitionInfo; location: ConsoleLuaDefinitionLocation; priority: number }>();

	const appendDefinitions = (info: { asset_id: string; path?: string }, definitions: ReadonlyArray<LuaDefinitionInfo>) => {
		if (!definitions) {
			return;
		}
		for (const definition of definitions) {
			const location = buildDefinitionLocationFromRange(definition.definition);
			if (info.path && !location.path) {
				location.path = info.path;
			}
			const symbolPath = definition.namePath.length > 0 ? definition.namePath.join('.') : definition.name;
			const key = `${location.chunkName}::${symbolPath}@${definition.definition.start.line}:${definition.definition.start.column}`;
			const priority = (() => {
				switch (definition.kind) {
					case 'table_field':
						return 5;
					case 'function':
						return 4;
					case 'variable':
						return 3;
					case 'parameter':
						return 2;
					case 'assignment':
					default:
						return 1;
				}
			})();
			const existing = entries.get(key);
			if (!existing || priority > existing.priority) {
				entries.set(key, { info: definition, location, priority });
			}
		}
	};

	const enqueuedChunks = new Set<string>();
	const candidates: Array<{ chunkName: string; info: { asset_id: string; path?: string } }> = [];
	const enqueueCandidate = (chunkName: string, info: { asset_id: string; path?: string }): void => {
		const key = `${info.asset_id}|${chunkName}`;
		if (enqueuedChunks.has(key)) {
			return;
		}
		enqueuedChunks.add(key);
		const candidateInfo: { asset_id: string; path?: string } = { asset_id: info.asset_id };
		if (info.path !== undefined) {
			candidateInfo.path = info.path;
		}
		candidates.push({ chunkName, info: candidateInfo });
	};

	for (const [chunkName, asset] of Object.entries(BmsxConsoleRuntime.instance.cart.chunk2lua)) {
		const path = asset.normalized_source_path;
		enqueueCandidate(chunkName, { asset_id: asset.resid, path });
	}

	for (const asset of Object.values(BmsxConsoleRuntime.instance.cart.lua)) {
		const chunkName = asset.chunk_name;
		const candidateInfo: { asset_id: string; path?: string } = {
			asset_id: asset.resid,
			path: asset.normalized_source_path,
		};
		enqueueCandidate(chunkName, candidateInfo);
	}

	for (const candidate of candidates) {
		const model = buildSemanticModelForChunk(candidate.chunkName);
		appendDefinitions(candidate.info, model ? model.definitions : null);
	}

	const symbols: ConsoleLuaSymbolEntry[] = [];
	for (const { info, location } of entries.values()) {
		const path = info.namePath.length > 0 ? info.namePath.join('.') : info.name;
		symbols.push({
			name: info.name,
			path,
			kind: info.kind,
			location,
		});
	}
	symbols.sort((a, b) => {
		const pathA = a.location.path ?? a.location.chunkName ?? '';
		const pathB = b.location.path ?? b.location.chunkName ?? '';
		if (pathA !== pathB) {
			return pathA.localeCompare(pathB);
		}
		const lineA = a.location.range.startLine;
		const lineB = b.location.range.startLine;
		if (lineA !== lineB) {
			return lineA - lineB;
		}
		return a.path.localeCompare(b.path);
	});
	return symbols;
}

export function findStaticDefinitionLocation(chain: ReadonlyArray<string>, usageRow: number, usageColumn: number, preferredChunk: string): ConsoleLuaDefinitionLocation {
	if (chain.length === 0) {
		return null;
	}
	const bundle = getStaticDefinitions(preferredChunk);
	if (!bundle || bundle.definitions.length === 0) {
		return null;
	}
	const { definitions, chunks, models } = bundle;
	if (usageRow !== null && usageColumn !== null) {
		for (let index = 0; index < chunks.length; index += 1) {
			const chunk = chunks[index];
			let model = models.get(chunk.chunkName);
			if (!model) {
				const source = BmsxConsoleRuntime.instance.cart.chunk2lua[chunk.chunkName]?.src;
				if (!source) {
					continue;
				}
				model = buildLuaSemanticModel(source, chunk.chunkName);
				models.set(chunk.chunkName, model);
			}
			const semanticDefinition = model.lookupIdentifier(usageRow, usageColumn, chain);
			if (semanticDefinition) {
				return buildDefinitionLocationFromRange(semanticDefinition.definition);
			}
		}
	}
	const identifier = chain[chain.length - 1];
	const pathsMatch = (candidate: ReadonlyArray<string>): boolean => {
		if (candidate.length !== chain.length) {
			return false;
		}
		for (let index = 0; index < candidate.length; index += 1) {
			if (candidate[index] !== chain[index]) {
				return false;
			}
		}
			return true;
		};
	const selectPreferred = (candidate: LuaDefinitionInfo, current: LuaDefinitionInfo): LuaDefinitionInfo => {
		const candidatePriority = definitionPriorityForLocals(candidate.kind);
		const currentPriority = current ? definitionPriorityForLocals(current.kind) : -1;
		if (usageRow !== null) {
			if (!positionWithinRange(usageRow, usageColumn, candidate.scope)) {
				return current;
			}
			if (usageRow < candidate.definition.start.line) {
				return current;
			}
			if (
				!current
				|| candidatePriority > currentPriority
				|| (candidatePriority === currentPriority
					&& (
						candidate.definition.start.line > current.definition.start.line
						|| (candidate.definition.start.line === current.definition.start.line
							&& candidate.definition.start.column >= current.definition.start.column)
					))
			) {
				return candidate;
			}
			return current;
		}
		if (
			!current
			|| candidatePriority > currentPriority
			|| (candidatePriority === currentPriority
				&& (
					candidate.definition.start.line < current.definition.start.line
					|| (candidate.definition.start.line === current.definition.start.line
						&& candidate.definition.start.column < current.definition.start.column)
				))
		)
			return candidate;
		return current;
	};
	let bestExact: LuaDefinitionInfo = null;
	let bestPartial: LuaDefinitionInfo = null;
	for (let i = 0; i < definitions.length; i += 1) {
		const definition = definitions[i];
		if (pathsMatch(definition.namePath)) {
			bestExact = selectPreferred(definition, bestExact);
			continue;
		}
		if (definition.name !== identifier) {
			continue;
		}
		bestPartial = selectPreferred(definition, bestPartial);
	}
	const chosen = bestExact ?? bestPartial;
	if (!chosen) {
		return null;
	}
	return buildDefinitionLocationFromRange(chosen.definition);
}

export function getStaticDefinitions(preferredChunk: string): { definitions: ReadonlyArray<LuaDefinitionInfo>; chunks: Array<{ chunkName: string; info: { asset_id: string; path?: string } }>; models: Map<string, LuaSemanticModel> } {
	const interpreter = BmsxConsoleRuntime.instance.interpreter;
	const matchingChunks: Array<{ chunkName: string; info: { asset_id: string; path?: string } }> = [];
	for (const asset of Object.values(BmsxConsoleRuntime.instance.cart.lua)) {
		const chunkName = asset.chunk_name;
		const info: { asset_id: string; path?: string } = { asset_id: asset.resid, path: asset.normalized_source_path };
		const matchesPath = preferredChunk !== null && info.path === preferredChunk;
		const matchesChunk = preferredChunk !== null && chunkName === preferredChunk;
		if (!matchesPath && !matchesChunk) {
			continue;
		}
		matchingChunks.push({ chunkName, info });
	}
	if (matchingChunks.length === 0) {
		return null;
	}
	const byKey = new Map<string, LuaDefinitionInfo>();
	const models: Map<string, LuaSemanticModel> = new Map();
	const recordDefinition = (definition: LuaDefinitionInfo) => {
		const key = `${definition.namePath.join('.')}@${definition.definition.start.line}:${definition.definition.start.column}`;
		if (!byKey.has(key)) {
			byKey.set(key, definition);
		}
	};
	for (let index = 0; index < matchingChunks.length; index += 1) {
		const candidate = matchingChunks[index];
		const chunkDefinitions = interpreter.getChunkDefinitions(candidate.chunkName);
		if (chunkDefinitions && chunkDefinitions.length > 0) {
			for (let defIndex = 0; defIndex < chunkDefinitions.length; defIndex += 1) {
				recordDefinition(chunkDefinitions[defIndex]);
			}
		}
		const model = buildSemanticModelForChunk(candidate.chunkName);
		const cacheEntry = BmsxConsoleRuntime.instance.chunkSemanticCache.get(candidate.chunkName);
		const cachedDefinitions = cacheEntry ? cacheEntry.definitions : (model ? model.definitions : []);
		if (model) {
			models.set(candidate.chunkName, model);
		}
		for (let defIndex = 0; defIndex < cachedDefinitions.length; defIndex += 1) {
			recordDefinition(cachedDefinitions[defIndex]);
		}
	}
	if (byKey.size === 0) {
		return null;
	}
	return { definitions: Array.from(byKey.values()), chunks: matchingChunks, models };
}

export function buildSemanticModelForChunk(chunkName: string): LuaSemanticModel {
	const runtime = BmsxConsoleRuntime.instance;
	const source = BmsxConsoleRuntime.instance.cart.chunk2lua![chunkName].src;
	const cached = runtime.chunkSemanticCache.get(chunkName);
	const previousModel = cached ? cached.model : null;
	const previousDefinitions = cached ? cached.definitions : [];
	if (cached && cached.source === source) {
		return cached.model;
	}
	try {
		const model = buildLuaSemanticModel(source, chunkName);
		runtime.chunkSemanticCache.set(chunkName, { source, model, definitions: model.definitions });
		return model;
	} catch (error) {
		if (error instanceof LuaSyntaxError) {
			const sanitizedSource = (() => {
				if (!Number.isFinite(error.line)) {
					return null;
				}
				const lines = source.split('\n');
				const lineIndex = error.line - 1;
				if (lineIndex < 0 || lineIndex >= lines.length) {
					return null;
				}
				const originalLine = lines[lineIndex];
				const trimmed = originalLine.trimStart();
				if (trimmed.startsWith('--__BMSX_SYNTAX_ERROR__')) {
					return null;
				}
				const prefixLength = originalLine.length - trimmed.length;
				const prefix = originalLine.slice(0, prefixLength);
				lines[lineIndex] = `${prefix}--__BMSX_SYNTAX_ERROR__ ${trimmed}`;
				return lines.join('\n');
			})();
			if (sanitizedSource && sanitizedSource !== source) {
				try {
					const model = buildLuaSemanticModel(sanitizedSource, chunkName);
					runtime.chunkSemanticCache.set(chunkName, { source, model, definitions: model.definitions });
					return model;
				} catch {
					// continue with fallback logic below
				}
			}
			if (previousModel) {
				runtime.chunkSemanticCache.set(chunkName, { source, model: previousModel, definitions: previousDefinitions });
				return previousModel;
			}
			runtime.chunkSemanticCache.set(chunkName, { source, model: null, definitions: [] });
			return null;
		}
		const message = extractErrorMessage(error);
		runtime.chunkSemanticCache.set(chunkName, { source, model: null, definitions: [] });
		console.warn(`[BmsxConsoleRuntime] Failed to parse '${chunkName}': ${message}`);
		return null;
	}
}

export function positionWithinRange(row: number, column: number, range: LuaSourceRange): boolean {
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

export function parseLuaIdentifierChain(expression: string): string[] {
	if (!expression) {
		return null;
	}
	const parts = expression.split('.');
	if (parts.length === 0) {
		return null;
	}
	for (let i = 0; i < parts.length; i += 1) {
		const part = parts[i];
		if (part.length === 0) {
			return null;
		}
		if (!LuaLexer.isIdentifierStart(part.charAt(0))) {
			return null;
		}
		for (let j = 1; j < part.length; j += 1) {
			if (!LuaLexer.isIdentifierPart(part.charAt(j))) {
				return null;
			}
		}
	}
	return parts;
}

export function resolveLuaChainValue(parts: string[], asset_id: string): ({ kind: 'value'; value: LuaValue; scope: ConsoleLuaHoverScope; definitionRange: LuaSourceRange } | { kind: 'not_defined'; scope: ConsoleLuaHoverScope }) {
	if (!parts || parts.length === 0) {
		return null;
	}
	const runtime = BmsxConsoleRuntime.instance;
	const interpreter = runtime.interpreter;
	const root = parts[0];
	let value: LuaValue = null;
	let scope: ConsoleLuaHoverScope = 'global';
	let found = false;
	let definitionEnv: LuaEnvironment = null;
	let definitionRange: LuaSourceRange = null;
	const globalEnv = interpreter.globalEnvironment;

	const frameEnv = interpreter.lastFaultEnvironment;
	if (frameEnv) {
		const resolved = resolveIdentifierThroughChain(frameEnv, root, interpreter);
		if (resolved) {
			value = resolved.value;
			scope = resolved.scope;
			found = true;
			definitionEnv = resolved.environment;
		}
	}
	if (!found && asset_id) {
		const env = runtime.luaChunkEnvironmentsByAssetId.get(asset_id);
		if (env && env.hasLocal(root)) {
			value = env.get(root);
			scope = env === globalEnv ? 'global' : 'chunk';
			found = true;
			definitionEnv = env;
		}
	}
	if (!found) {
		const chunkName = runtime.currentChunkName;
		if (chunkName) {
			const envByChunk = runtime.luaChunkEnvironmentsByChunkName.get(chunkName);
			if (envByChunk && envByChunk.hasLocal(root)) {
				value = envByChunk.get(root);
				scope = envByChunk === globalEnv ? 'global' : 'chunk';
				found = true;
				definitionEnv = envByChunk;
			}
		}
	}
	if (!found) {
		if (globalEnv.hasLocal(root)) {
			value = globalEnv.get(root);
			scope = 'global';
			found = true;
			definitionEnv = globalEnv;
		}
	}
	if (!found) {
		return null;
	}
	if (definitionEnv) {
		definitionRange = definitionEnv.getDefinition(root);
	}
	if (value === undefined) {
		return null;
	}
	let current: LuaValue = value;
	for (let index = 1; index < parts.length; index += 1) {
		const part = parts[index];
		if (!(isLuaTable(current))) {
			return { kind: 'not_defined', scope };
		}
		const nextValue = current.get(part);
		if (nextValue === null) {
			return { kind: 'not_defined', scope };
		}
		current = nextValue;
		definitionRange = null;
	}
	return { kind: 'value', value: current, scope, definitionRange };
}

export function resolveIdentifierThroughChain(environment: LuaEnvironment, name: string, interpreter: LuaInterpreter): { environment: LuaEnvironment; value: LuaValue; scope: ConsoleLuaHoverScope } {
	let current: LuaEnvironment = environment;
	const globalEnv = interpreter.globalEnvironment;
	while (current) {
		if (current.hasLocal(name)) {
			const value = current.get(name);
			const scope: ConsoleLuaHoverScope = current === globalEnv ? 'global' : 'chunk';
			return { environment: current, value, scope };
		}
		current = current.getParent();
	}
	return null;
}

export function describeLuaValueForInspector(value: LuaValue): { lines: string[]; valueType: string; isFunction: boolean } {
	const resolvedName = BmsxConsoleRuntime.instance.interpreter.resolveValueName(value);
	if (value === null) {
		return { lines: ['Nil'], valueType: 'nil', isFunction: false };
	}
	if (typeof value === 'boolean') {
		return { lines: [value ? 'true' : 'false'], valueType: 'boolean', isFunction: false };
	}
	if (typeof value === 'number') {
		const numeric = Number.isFinite(value) ? String(value) : 'nan';
		return { lines: [numeric], valueType: 'number', isFunction: false };
	}
	if (typeof value === 'string') {
		return { lines: [JSON.stringify(value)], valueType: 'string', isFunction: false };
	}
	if (isLuaFunctionValue(value)) {
		const fnName = value.name && value.name.length > 0 ? value.name : '<anonymous>';
		return { lines: [`<function ${fnName}>`], valueType: 'function', isFunction: true };
	}
	if (isLuaNativeValue(value)) {
		const native = value.native;
		const typeName = value.typeName && value.typeName.length > 0 ? value.typeName : resolveNativeTypeName(native);
		const labelName = resolvedName ?? typeName;
		if (typeof native === 'function') {
			const params = extractFunctionParameters(native as (...args: unknown[]) => unknown);
			const paramSegment = params.length > 0 ? params.join(', ') : '';
			const signature = paramSegment.length > 0 ? `(${paramSegment})` : '()';
			const label = labelName && labelName.length > 0 ? `<native function ${labelName}${signature}>` : `<native function${signature}>`;
			return { lines: [label], valueType: labelName ?? 'native', isFunction: true };
		}
		let summary = `<${labelName ?? 'native'}>`;
		const identifier = (native as { id?: unknown }).id;
		if (identifier !== undefined && identifier !== null) {
			summary = `${summary} id=${String(identifier)}`;
		}
		return { lines: [summary], valueType: labelName ?? 'native', isFunction: false };
	}
	if (isLuaTable(value)) {
		const tableName = resolveTableTypeName(value);
		const preview = consoleValueToString(value);
		const lines = tableName ? [`<table ${tableName}>`] : ['<table>'];
		lines.push(preview);
		return { lines, valueType: tableName ?? 'table', isFunction: false };
	}
	const summary = consoleValueToString(value);
	return { lines: [summary], valueType: 'unknown', isFunction: false };
}

export function getNativeMemberCompletionEntries(value: LuaNativeValue, operator: '.' | ':'): ConsoleLuaMemberCompletion[] {
	const native = value.native;
	const typeName = value.typeName && value.typeName.length > 0 ? value.typeName : resolveNativeTypeName(native);
	const registry = new Map<string, ConsoleLuaMemberCompletion>();
	const includeProperties = operator === '.';
	const metatable = value.getMetatable();
	if (metatable) {
		const indexValue = metatable.get('__index');
		if (isLuaTable(indexValue)) {
			const luaEntries = buildTableMemberCompletionEntries(indexValue, operator, { typeName: resolveTableTypeName(indexValue) });
			for (let index = 0; index < luaEntries.length; index += 1) {
				registerNativeCompletion(registry, luaEntries[index]);
			}
		}
	}
	if (typeof native === 'object' && native !== null) {
		populateNativeMembersFromTarget(native, operator, typeName, registry, includeProperties);
	} else if (typeof native === 'function' && operator === '.') {
		populateNativeMembersFromTarget(native, operator, typeName, registry, includeProperties);
	}
	const prototypeEntries = getCachedPrototypeNativeEntries(native, operator, typeName);
	for (let index = 0; index < prototypeEntries.length; index += 1) {
		registerNativeCompletion(registry, prototypeEntries[index]);
	}
	const result: ConsoleLuaMemberCompletion[] = [];
	for (const entry of registry.values()) {
		result.push({
			name: entry.name,
			kind: entry.kind,
			detail: entry.detail,
			parameters: entry.parameters.slice(),
		});
	}
	result.sort((a, b) => a.name.localeCompare(b.name));
	return result;
}

export function getCachedPrototypeNativeEntries(native: object | Function, operator: '.' | ':', typeName: string): ConsoleLuaMemberCompletion[] {
	const runtime = BmsxConsoleRuntime.instance;
	const cacheKey = resolveNativeCompletionCacheKey(native);
	const cacheField = operator === ':' ? 'colon' : 'dot';
	let cache = runtime.nativeMemberCompletionCache.get(cacheKey);
	const cached = cache && cache[cacheField];
	if (cached) {
		return cloneMemberCompletions(cached);
	}
	const built = buildNativePrototypeMemberEntries(native, operator, typeName);
	if (!cache) {
		cache = {};
		runtime.nativeMemberCompletionCache.set(cacheKey, cache);
	}
	cache[cacheField] = built;
	return cloneMemberCompletions(built);
}

export function buildNativePrototypeMemberEntries(native: object | Function, operator: '.' | ':', typeName: string): ConsoleLuaMemberCompletion[] {
	const registry = new Map<string, ConsoleLuaMemberCompletion>();
	const includeProperties = operator === '.';
	const visited = new Set<object>();
	const traverse = (target: object): void => {
		let current = target;
		while (current && !visited.has(current)) {
			if (current === Object.prototype || current === Function.prototype) {
				return;
			}
			visited.add(current);
			populateNativeMembersFromTarget(current, operator, typeName, registry, includeProperties);
			current = Object.getPrototypeOf(current);
		}
	};
	if (typeof native === 'function') {
		const prototype = native.prototype && typeof native.prototype === 'object' ? native.prototype : null;
		traverse(prototype);
		if (operator === '.') {
			const functionPrototype = Object.getPrototypeOf(native);
			traverse(functionPrototype);
		}
	} else {
		traverse(Object.getPrototypeOf(native));
	}
	const entries: ConsoleLuaMemberCompletion[] = [];
	for (const entry of registry.values()) {
		entries.push({ name: entry.name, kind: entry.kind, detail: entry.detail, parameters: entry.parameters.slice() });
	}
	entries.sort((a, b) => a.name.localeCompare(b.name));
	return entries;
}

export function buildTableMemberCompletionEntries(table: LuaTable, operator: '.' | ':', options?: { typeName?: string }): ConsoleLuaMemberCompletion[] {
	const registry = new Map<string, ConsoleLuaMemberCompletion>();
	const includeProperties = operator === '.';
	const typeName = options?.typeName;

	const appendFromTable = (target: LuaTable) => {
		const entries = target.entriesArray();
		for (let index = 0; index < entries.length; index += 1) {
			const [key, entryValue] = entries[index];
			if (typeof key !== 'string' || key.length === 0) {
				continue;
			}
			if (key === '__index' || key === '__metatable') {
				continue;
			}
			const isFunction = isLuaFunctionValue(entryValue);
			if (operator === ':' && !isFunction) {
				continue;
			}
			const kind: 'method' | 'property' = isFunction ? 'method' : 'property';
			if (!includeProperties && kind === 'property') {
				continue;
			}
			if (registry.has(key)) {
				continue;
			}
			const detail = isFunction
				? (typeName ? `function ${typeName}${operator === ':' ? ':' : '.'}${key}` : `function ${key}`)
				: (typeName ? `${typeName}.${key}` : `table field '${key}'`);
			registry.set(key, { name: key, kind, detail, parameters: [] });
		}
	};

	const chain = resolveTableChain(table);
	for (let i = 0; i < chain.length; i += 1) {
		appendFromTable(chain[i]);
	}

	const results: ConsoleLuaMemberCompletion[] = [];
	for (const entry of registry.values()) {
		results.push({ name: entry.name, kind: entry.kind, detail: entry.detail, parameters: entry.parameters.slice() });
	}
	results.sort((a, b) => a.name.localeCompare(b.name));
	return results;
}

export function resolveNativeCompletionCacheKey(native: object | Function): object {
	if (typeof native === 'function') {
		return native;
	}
	const prototype = Object.getPrototypeOf(native);
	if (prototype && typeof prototype === 'object') {
		return prototype;
	}
	return native;
}

export function populateNativeMembersFromTarget(target: object, operator: '.' | ':', typeName: string, registry: Map<string, ConsoleLuaMemberCompletion>, includeProperties: boolean): void {
	const propertyNames = Object.getOwnPropertyNames(target);
	const isFunctionTarget = typeof target === 'function';
	const skipFunctionPrototypeMembers = target === Function.prototype;
	for (let index = 0; index < propertyNames.length; index += 1) {
		const name = propertyNames[index];
		if (!name || name === 'constructor' || name === '__proto__' || name === 'prototype' || name === 'caller' || name === 'callee') {
			continue;
		}
		if (skipFunctionPrototypeMembers && (name === 'call' || name === 'apply' || name === 'bind')) {
			continue;
		}
		if (isFunctionTarget && (name === 'length' || name === 'name' || name === 'arguments')) {
			continue;
		}
		const descriptor = Object.getOwnPropertyDescriptor(target, name);
		if (!descriptor) {
			continue;
		}
		if (typeof descriptor.value === 'function') {
			const rawParams = extractFunctionParameters(descriptor.value as (...args: unknown[]) => unknown);
			const params = operator === ':' ? adjustMethodParametersForColon(rawParams) : rawParams.slice();
			const detail = formatNativeMethodDetail(typeName, name, params, operator);
			registerNativeCompletion(registry, { name, kind: 'method', detail, parameters: params });
			continue;
		}
		const hasGetter = typeof descriptor.get === 'function';
		const hasSetter = typeof descriptor.set === 'function';
		if (includeProperties && (hasGetter || 'value' in descriptor)) {
			const detail = formatNativePropertyDetail(typeName, name, hasGetter, hasSetter);
			registerNativeCompletion(registry, { name, kind: 'property', detail, parameters: [] });
		}
	}
}

export function registerNativeCompletion(registry: Map<string, ConsoleLuaMemberCompletion>, entry: ConsoleLuaMemberCompletion): void {
	if (registry.has(entry.name)) {
		return;
	}
	registry.set(entry.name, {
		name: entry.name,
		kind: entry.kind,
		detail: entry.detail,
		parameters: entry.parameters.slice(),
	});
}

export function adjustMethodParametersForColon(params: string[]): string[] {
	if (!params || params.length === 0) {
		return [];
	}
	const first = params[0] ?? '';
	const normalized = first.trim().toLowerCase();
	if (normalized === 'self' || normalized === 'this') {
		return params.slice(1);
	}
	return params.slice();
}

export function formatNativeMethodDetail(typeName: string, name: string, parameters: readonly string[], operator: '.' | ':'): string {
	const paramSegment = parameters.length > 0 ? parameters.join(', ') : '';
	const signature = paramSegment.length > 0 ? `(${paramSegment})` : '()';
	const separator = operator === ':' ? ':' : '.';
	if (typeName && typeName.length > 0) {
		return `${typeName}${separator}${name}${signature}`;
	}
	return `${name}${signature}`;
}

export function formatNativePropertyDetail(typeName: string, name: string, hasGetter: boolean, hasSetter: boolean): string {
	const base = typeName && typeName.length > 0 ? `${typeName}.${name}` : name;
	if (hasGetter && hasSetter) {
		return `${base} (property)`;
	}
	if (hasGetter) {
		return `${base} (read-only)`;
	}
	if (hasSetter) {
		return `${base} (write-only)`;
	}
	return `${base}`;
}

export function cloneMemberCompletions(entries: ConsoleLuaMemberCompletion[]): ConsoleLuaMemberCompletion[] {
	const cloned: ConsoleLuaMemberCompletion[] = [];
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		cloned.push({ name: entry.name, kind: entry.kind, detail: entry.detail, parameters: entry.parameters.slice() });
	}
	return cloned;
}

export function clearNativeMemberCompletionCache(): void {
	BmsxConsoleRuntime.instance.nativeMemberCompletionCache = new WeakMap<object, { dot?: ConsoleLuaMemberCompletion[]; colon?: ConsoleLuaMemberCompletion[] }>();
}

export function isLuaBuiltinFunctionName(name: string): boolean {
	if (!name || name.length === 0) {
		return false;
	}
	return BmsxConsoleRuntime.instance.luaBuiltinMetadata.has(name);
}

export function getChunkResourceHint(chunkName: string): { asset_id: string; path?: string } | null {
	const asset = BmsxConsoleRuntime.instance.cart.chunk2lua![chunkName];
	if (!asset) {
		return null;
	}
	const hint: { asset_id: string; path?: string } = { asset_id: asset.resid };
	hint.path = asset.normalized_source_path;
	return hint;
}

export function describeLuaFunctionValue(value: LuaFunctionValue): string {
	const name = value.name && value.name.length > 0 ? value.name : '<anonymous>';
	return `function ${name}`;
}

export function describeLuaTable(table: LuaTable, depth: number, visited: Set<unknown>): string {
	if (visited.has(table) || depth >= CONSOLE_PREVIEW_MAX_DEPTH) {
		return '{…}';
	}
	visited.add(table);
	const entries = table.entriesArray();
	if (entries.length === 0) {
		return '{}';
	}
	const numeric = new Map<number, LuaValue>();
	const stringEntries: Array<{ key: string; value: LuaValue }> = [];
	const otherEntries: Array<{ key: string; value: LuaValue }> = [];
	for (let i = 0; i < entries.length; i += 1) {
		const [key, entryValue] = entries[i];
		if (typeof key === 'number' && Number.isInteger(key)) {
			numeric.set(key, entryValue);
			continue;
		}
		if (typeof key === 'string') {
			if (key === '__index' || key === '__metatable') {
				continue;
			}
			stringEntries.push({ key, value: entryValue });
			continue;
		}
		otherEntries.push({ key: consoleValueToString(key as LuaValue, depth + 1, visited), value: entryValue });
	}
	const sequentialValues: LuaValue[] = [];
	let seqIndex = 1;
	while (numeric.has(seqIndex)) {
		sequentialValues.push(numeric.get(seqIndex)!);
		seqIndex += 1;
	}
	const isPureSequence = sequentialValues.length === numeric.size && stringEntries.length === 0 && otherEntries.length === 0;
	if (isPureSequence) {
		return `[${formatValueList(sequentialValues, depth, visited)}${numeric.size > CONSOLE_PREVIEW_MAX_ENTRIES ? ', …' : ''}]`;
	}
	const parts: string[] = [];
	const limit = CONSOLE_PREVIEW_MAX_ENTRIES;
	let consumed = 0;
	const appendEntry = (label: string, entryValue: LuaValue): void => {
		if (consumed >= limit) {
			return;
		}
		parts.push(`${label} = ${consoleValueToString(entryValue, depth + 1, visited)}`);
		consumed += 1;
	};
	stringEntries.sort((a, b) => a.key.localeCompare(b.key));
	for (let i = 0; i < stringEntries.length && consumed < limit; i += 1) {
		const entry = stringEntries[i];
		appendEntry(entry.key, entry.value);
	}
	const numericKeys = Array.from(numeric.keys()).filter(key => key < 1 || key >= seqIndex);
	numericKeys.sort((a, b) => a - b);
	for (let i = 0; i < numericKeys.length && consumed < limit; i += 1) {
		const key = numericKeys[i];
		const val = numeric.get(key);
		if (val !== undefined) {
			appendEntry(`[${key}]`, val);
		}
	}
	for (let i = 0; i < otherEntries.length && consumed < limit; i += 1) {
		const entry = otherEntries[i];
		appendEntry(`[${entry.key}]`, entry.value);
	}
	if (sequentialValues.length > 0 && consumed < limit) {
		parts.push(`array = [${formatValueList(sequentialValues, depth, visited)}${sequentialValues.length > limit ? ', …' : ''}]`);
	}
	if (parts.length === 0) {
		return '{…}';
	}
	if (consumed >= limit || parts.length < stringEntries.length + numericKeys.length + otherEntries.length) {
		parts.push('…');
	}
	return `{ ${parts.join(', ')} }`;
}

export function describeLuaNativeValue(value: LuaNativeValue, depth: number, visited: Set<unknown>): string {
	const native = value.native;
	const typeName = value.typeName && value.typeName.length > 0 ? value.typeName : resolveNativeTypeName(native);
	if (visited.has(native) || depth >= CONSOLE_PREVIEW_MAX_DEPTH) {
		return `[${typeName ?? 'native'} …]`;
	}
	visited.add(native);
	if (Array.isArray(native)) {
		const preview = formatArrayPreview(native, depth + 1, visited);
		return `${typeName ?? 'array'} [${preview}]`;
	}
	if (typeof native === 'function') {
		const label = native.name && native.name.length > 0 ? native.name : '<anonymous>';
		return `[native function ${label}]`;
	}
	if (native && typeof native === 'object') {
		const entries = Object.getOwnPropertyNames(native).sort();
		const limit = Math.min(entries.length, CONSOLE_PREVIEW_MAX_ENTRIES);
		const parts: string[] = [];
		for (let i = 0; i < limit; i += 1) {
			const key = entries[i];
			let summary = '<unavailable>';
			try {
				const descriptor = (native as Record<string, unknown>)[key];
				summary = formatJsValue(descriptor, depth, visited);
			} catch (error) {
				summary = extractErrorMessage(error);
			}
			parts.push(`${key}: ${summary}`);
		}
		if (entries.length > limit) {
			parts.push('…');
		}
		return `${typeName ?? 'native'} { ${parts.join(', ')} }`;
	}
	return `${typeName ?? 'native'} ${String(native)}`;
}

export function formatArrayPreview(values: unknown[], depth: number, visited: Set<unknown>): string {
	const preview: string[] = [];
	const limit = Math.min(values.length, CONSOLE_PREVIEW_MAX_ENTRIES);
	for (let i = 0; i < limit; i += 1) {
		preview.push(formatJsValue(values[i], depth, visited));
	}
	if (values.length > limit) {
		preview.push('…');
	}
	return preview.join(', ');
}

export function formatValueList(values: LuaValue[], depth: number, visited: Set<unknown>): string {
	const parts: string[] = [];
	const limit = Math.min(values.length, CONSOLE_PREVIEW_MAX_ENTRIES);
	for (let i = 0; i < limit; i += 1) {
		parts.push(consoleValueToString(values[i], depth + 1, visited));
	}
	return parts.join(', ');
}

export function formatJsValue(value: unknown, depth: number, visited: Set<unknown>): string {
	if (value === null) {
		return 'null';
	}
	if (Array.isArray(value)) {
		return `[${formatArrayPreview(value, depth + 1, visited)}]`;
	}
	const type = typeof value;
	if (type === 'string') {
		return `"${value}"`;
	}
	if (type === 'number' || type === 'boolean') {
		return String(value);
	}
	if (type === 'function') {
		const fn = value as Function;
		const label = fn.name && fn.name.length > 0 ? fn.name : '<anonymous>';
		return `[function ${label}]`;
	}
	if (isLuaTable(value)) {
		return describeLuaTable(value, depth + 1, visited);
	}
	if (isLuaNativeValue(value)) {
		return describeLuaNativeValue(value, depth + 1, visited);
	}
	if (value && typeof value === 'object') {
		if (visited.has(value)) {
			return '{…}';
		}
		visited.add(value);
		const entries = Object.keys(value as Record<string, unknown>).sort();
		const limit = Math.min(entries.length, CONSOLE_PREVIEW_MAX_ENTRIES);
		const parts: string[] = [];
		for (let i = 0; i < limit; i += 1) {
			const key = entries[i];
			let summary = '<unavailable>';
			try {
				summary = formatJsValue((value as Record<string, unknown>)[key], depth + 1, visited);
			} catch (error) {
				summary = extractErrorMessage(error);
			}
			parts.push(`${key}: ${summary}`);
		}
		if (entries.length > limit) {
			parts.push('…');
		}
		return `{ ${parts.join(', ')} }`;
	}
	return String(value);
}

export function consoleValueToString(value: LuaValue, depth = 0, visited: Set<unknown> = new Set()): string {
	if (value === null) {
		return 'nil';
	}
	if (typeof value === 'boolean') {
		return value ? 'true' : 'false';
	}
	if (typeof value === 'number') {
		return Number.isFinite(value) ? String(value) : 'nan';
	}
	if (typeof value === 'string') {
		return value;
	}
	if (isLuaTable(value)) {
		return describeLuaTable(value, depth, visited);
	}
	if (isLuaNativeValue(value)) {
		return describeLuaNativeValue(value, depth, visited);
	}
	if (isLuaFunctionValue(value)) {
		return describeLuaFunctionValue(value);
	}
	return 'function';
}
