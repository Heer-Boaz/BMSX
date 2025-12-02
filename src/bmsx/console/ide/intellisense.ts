import { BmsxConsoleApi } from '../api';
import { CONSOLE_API_METHOD_METADATA } from '../api_metadata';
import { LuaLexer } from '../../lua/lexer';
import { LuaParser } from '../../lua/parser';
import { LuaSyntaxError } from '../../lua/errors';
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
} from '../../lua/ast';
import { LuaTableFieldKind } from '../../lua/ast';
import type { LuaDefinitionInfo, LuaTableArrayField, LuaTableExpressionField, LuaTableIdentifierField } from '../../lua/ast';
import type { ConsoleLuaBuiltinDescriptor, ConsoleLuaDefinitionLocation, ConsoleLuaDefinitionRange, ConsoleLuaHoverRequest, ConsoleLuaHoverResult, ConsoleLuaSymbolEntry } from '../types';
import type { ApiCompletionMetadata, CodeTabContext, LuaCompletionItem, PointerSnapshot } from './types';
import { activateCodeTab, findCodeTabContext, getActiveCodeTabContext, isCodeTabActive, isReadOnlyCodeTab, setActiveTab } from './editor_tabs';
import { ide_state } from './ide_state';
import { resolvePointerRow, resolvePointerColumn, safeInspectLuaExpression, applyDefinitionSelection, beginNavigationCapture, completeNavigation, focusChunkSource, listResourcesStrict } from './console_cart_editor';
import { isLuaCommentContext } from './text_utils';
import { type ProjectReferenceEnvironment, resolveDefinitionLocationForExpression } from './code_reference';
import * as constants from './constants';

export const KEYWORDS = new Set([
	'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'goto', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while',
]);

function canonicalizeIdeIdentifier(name: string): string {
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
		chunk = parseChunkWithRecovery(options.source, options.chunkName);
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

function parseChunkWithRecovery(source: string, chunkName: string): LuaChunk {
	try {
		return parseLuaChunk(source, chunkName);
	} catch (error) {
		if (!(error instanceof LuaSyntaxError)) {
			throw error;
		}
		const truncated = truncateSourceAtSyntaxError(source, error);
		if (truncated === null) {
			throw error;
		}
		try {
			return parseLuaChunk(truncated, chunkName);
		} catch {
			throw error;
		}
	}
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
							parameterDescriptionMap.set(paramMeta.name, paramMeta.description );
						}
					}
				}
				const optionalParams = optionalSources.size > 0 ? Array.from(optionalSources) : [];
				const parameterDescriptions = params.map(param => parameterDescriptionMap.get(param) );
				const displayParams = params.map(param => (optionalSources.has(param) ? `${param}?` : param));
				const baseDetail = displayParams.length > 0
					? `api.${name}(${displayParams.join(', ')})`
					: `api.${name}()`;
				const methodDescription = metadata?.description ;
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
				const marker = applyOptionalMarkers(apiMeta.params, apiMeta.optionalParams, apiMeta.parameterDescriptions );
				return {
					params: marker.params,
					label: `api.${call.methodName}`,
					callStyle: 'method',
					declarationStyle: 'function',
					hasVararg: apiMeta.params.some(param => param === '...' || param.endsWith('...')),
					description: apiMeta.description ,
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
			const marker = applyOptionalMarkers(apiMeta.params, apiMeta.optionalParams, apiMeta.parameterDescriptions );
			return {
				params: marker.params,
				label: `api.${method}`,
				callStyle: 'function',
				declarationStyle: 'function',
				hasVararg: apiMeta.params.some(param => param === '...' || param.endsWith('...')),
				description: apiMeta.description ,
				parameterDescriptions: marker.descriptions,
			};
		}
	}
	const key = qualified.parts.join('.').toLowerCase();
	const builtin = builtinLookup.get(key);
	if (builtin) {
		const marker = applyOptionalMarkers(builtin.params, builtin.optionalParams, builtin.parameterDescriptions );
		return {
			params: marker.params,
			label: builtin.name,
			callStyle: 'function',
			declarationStyle: 'function',
			hasVararg: builtin.params.some(param => param === '...' || param.endsWith('...')),
			description: builtin.description ,
			parameterDescriptions: marker.descriptions,
		};
	}
	// Fallback: treat API methods as global functions (runtime registers them globally)
	const apiMetaAsGlobal = apiSignatures.get(key);
	if (apiMetaAsGlobal) {
		const marker = applyOptionalMarkers(apiMetaAsGlobal.params, apiMetaAsGlobal.optionalParams, apiMetaAsGlobal.parameterDescriptions );
		return {
			params: marker.params,
			label: key,
			callStyle: 'function',
			declarationStyle: 'function',
			hasVararg: apiMetaAsGlobal.params.some(param => param === '...' || param.endsWith('...')),
			description: apiMetaAsGlobal.description ,
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
		const description = parameterDescriptions && index < parameterDescriptions.length ? parameterDescriptions[index]  : null;
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

function parseLuaChunk(source: string, chunkName: string): LuaChunk {
	const lexer = new LuaLexer(source, chunkName, { canonicalizeIdentifiers: ide_state.caseInsensitive ? ide_state.canonicalization : 'none' });
	const tokens = lexer.scanTokens();
	const parser = new LuaParser(tokens, chunkName, source);
	return parser.parseChunk();
}

function truncateSourceAtSyntaxError(source: string, error: LuaSyntaxError): string {
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

function truncateLine(text: string): string {
	if (text.length <= constants.HOVER_TOOLTIP_MAX_LINE_LENGTH) return text;
	return text.slice(0, constants.HOVER_TOOLTIP_MAX_LINE_LENGTH - 3) + '...';
}

export function buildHoverContentLines(result: ConsoleLuaHoverResult): string[] {
	const lines: string[] = [];
	const push = (value: string) => { lines.push(truncateLine(value)); };
	if (result.state === 'not_defined') {
		push(`${result.expression} = not defined`);
		return lines;
	}
	const valueLines = result.lines.length > 0 ? result.lines : [''];
	if (valueLines.length === 1) {
		const suffix = result.valueType && result.valueType !== 'unknown' ? ` (${result.valueType})` : '';
		push(`${result.expression} = ${valueLines[0]}${suffix}`);
		return lines;
	}
	const suffix = result.valueType && result.valueType !== 'unknown' ? ` (${result.valueType})` : '';
	push(`${result.expression}${suffix}`);
	for (const line of valueLines) push(`  ${line}`);
	return lines;
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
}export function updateHoverTooltip(snapshot: PointerSnapshot): void {
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
		asset_id,
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
		if (context.descriptor.path && context.descriptor.path.length > 0) {
			return context.descriptor.path;
		}
		if (context.descriptor.asset_id) {
			return context.descriptor.asset_id;
		}
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
	const response = ide_state.listLuaObjectMembersFn({
		asset_id: request.asset_id ,
		chunkName: request.chunkName ,
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
		const detail = entry.detail ;
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
	asset_id: string,
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
	const descriptorAssetId = descriptor ? descriptor.asset_id  : null;
	const resolvedAssetId = descriptorAssetId ?? asset_id ;
	const resolvedChunk = chunkName
		?? descriptorPath
		?? descriptorAssetId
		?? asset_id
		?? ide_state.entryAssetId
		?? hoverChunkName
		?? '<console>';
	const location: ConsoleLuaDefinitionLocation = {
		chunkName: resolvedChunk,
		asset_id: resolvedAssetId,
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
}export function refreshGotoHoverHighlight(row: number, column: number, context: CodeTabContext): void {
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
	const asset_id = resolveHoverAssetId(context);
	const chunkName = resolveHoverChunkName(context);
	let definition = resolveSemanticDefinitionLocation(context, token.expression, row + 1, token.startColumn + 1, asset_id, chunkName);
	if (!definition) {
		const inspection = safeInspectLuaExpression({
			asset_id,
			expression: token.expression,
			chunkName,
			row: row + 1,
			column: token.startColumn + 1,
		});
		definition = inspection?.definition ;
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
	let definition = resolveSemanticDefinitionLocation(context, token.expression, row + 1, token.startColumn + 1, asset_id, chunkName);
	if (!definition) {
		const inspection = safeInspectLuaExpression({
			asset_id,
			expression: token.expression,
			chunkName,
			row: row + 1,
			column: token.startColumn + 1,
		});
		definition = inspection?.definition ;
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
			listResources: () => listResourcesStrict(),
			loadLuaResource: (resourceId: string) => ide_state.loadLuaResourceFn(resourceId),
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
		const context = findCodeTabContext(definition.asset_id , definition.chunkName );
		if (context) {
			targetContextId = context.id;
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
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

