import {
	LuaSyntaxKind,
	LuaTableFieldKind,
	type LuaCallExpression,
	type LuaChunk,
	type LuaExpression,
	type LuaIdentifierExpression,
	type LuaIndexExpression,
	type LuaLocalAssignmentStatement,
	type LuaMemberExpression,
	type LuaSourceRange,
	type LuaStatement,
	type LuaStringLiteralExpression,
} from '../syntax/ast';
import { API_METHOD_METADATA } from '../../machine/firmware/api_metadata';
import { DEFAULT_LUA_BUILTIN_FUNCTIONS } from '../../machine/firmware/builtin_descriptors';
import type { LuaBuiltinDescriptor, LuaSymbolEntry } from '../semantic_contracts';
import {
	buildLuaSemanticWorkspaceSnapshot,
	type Decl,
	type FileSemanticData,
	type FunctionSignatureInfo,
	type LuaSemanticWorkspaceSnapshotInput,
} from './model';
import { getCachedLuaParse } from '../analysis/cache';
import { sourceRangeStartKey } from './source_range';
import { buildLuaKnownNameSet, isReservedMemoryMapName, methodPathToPropertyPath, semanticSymbolKindToLuaSymbolKind } from './common';

export type LuaStaticDiagnostic = {
	row: number;
	startColumn: number;
	endColumn: number;
	message: string;
	severity: LuaStaticDiagnosticSeverity;
};

export type LuaStaticDiagnosticSeverity = 'error' | 'warning';

export type LuaApiSignatureMetadata = {
	params: readonly string[];
	optionalParams?: readonly string[];
};

export type LuaAnalysisDiagnosticOptions = {
	analysis: FileSemanticData;
	chunk: LuaChunk;
	globalSymbols: readonly LuaSymbolEntry[];
	builtinDescriptors: readonly LuaBuiltinDescriptor[];
	apiSignatures: ReadonlyMap<string, LuaApiSignatureMetadata>;
	extraGlobalNames?: readonly string[];
};

export type LuaProjectSource = {
	path: string;
	source: string;
	version?: number;
};

export type LuaProjectDiagnosticOptions = {
	builtinDescriptors?: readonly LuaBuiltinDescriptor[];
	apiSignatures?: ReadonlyMap<string, LuaApiSignatureMetadata>;
	extraGlobalNames?: readonly string[];
};

type CallSignatureMetadata = {
	params: readonly string[];
	required: number;
	label: string;
	callStyle?: 'function' | 'method';
	declarationStyle?: 'function' | 'method';
};

type FunctionCallInfo = {
	path: string;
	style: 'function' | 'method';
};

type QualifiedName = {
	parts: string[];
};

type MutableProjectSource = {
	path: string;
	chunk: LuaChunk;
	analysis: FileSemanticData;
};

function walkLuaStatementTree(statements: readonly LuaStatement[], visitStatement: (statement: LuaStatement) => void): void {
	for (let index = 0; index < statements.length; index += 1) {
		const statement = statements[index];
		visitStatement(statement);
		walkLuaStatementChildren(statement, visitStatement);
	}
}

function walkLuaStatementChildren(statement: LuaStatement, visitStatement: (statement: LuaStatement) => void): void {
	switch (statement.kind) {
		case LuaSyntaxKind.LocalFunctionStatement:
			walkLuaStatementTree(statement.functionExpression.body.body, visitStatement);
			return;
		case LuaSyntaxKind.FunctionDeclarationStatement:
			walkLuaStatementTree(statement.functionExpression.body.body, visitStatement);
			return;
		case LuaSyntaxKind.IfStatement:
			for (let index = 0; index < statement.clauses.length; index += 1) {
				walkLuaStatementTree(statement.clauses[index].block.body, visitStatement);
			}
			return;
		case LuaSyntaxKind.WhileStatement:
			walkLuaStatementTree(statement.block.body, visitStatement);
			return;
		case LuaSyntaxKind.RepeatStatement:
			walkLuaStatementTree(statement.block.body, visitStatement);
			return;
		case LuaSyntaxKind.ForNumericStatement:
			walkLuaStatementTree(statement.block.body, visitStatement);
			return;
		case LuaSyntaxKind.ForGenericStatement:
			walkLuaStatementTree(statement.block.body, visitStatement);
			return;
		case LuaSyntaxKind.DoStatement:
			walkLuaStatementTree(statement.block.body, visitStatement);
			return;
		default:
			return;
	}
}

const DEFAULT_LUA_BUILTIN_DESCRIPTORS = DEFAULT_LUA_BUILTIN_FUNCTIONS as readonly LuaBuiltinDescriptor[];
const cachedStaticApiSignatureMap = new Map<string, LuaApiSignatureMetadata>();

export function getDefaultLuaBuiltinDescriptors(): readonly LuaBuiltinDescriptor[] {
	return DEFAULT_LUA_BUILTIN_DESCRIPTORS;
}

export function getStaticLuaApiSignatureMap(): ReadonlyMap<string, LuaApiSignatureMetadata> {
	if (cachedStaticApiSignatureMap.size > 0) {
		return cachedStaticApiSignatureMap;
	}
	for (const [name, metadata] of Object.entries(API_METHOD_METADATA)) {
		const parameters = 'parameters' in metadata && metadata.parameters ? metadata.parameters : [];
		const params = parameters.map(parameter => parameter.name);
		const optionalParams = parameters.filter(parameter => parameter.optional).map(parameter => parameter.name);
		const optionalList = optionalParams.length > 0 ? optionalParams : undefined;
		const descriptor: LuaApiSignatureMetadata = {
			params,
			optionalParams: optionalList,
		};
		cachedStaticApiSignatureMap.set(name, descriptor);
	}
	return cachedStaticApiSignatureMap;
}

export function computeLuaDiagnosticsFromAnalysis(options: LuaAnalysisDiagnosticOptions): LuaStaticDiagnostic[] {
	const diagnostics: LuaStaticDiagnostic[] = [];
	const apiRoot = 'api';
	const globalKnownNames = buildLuaKnownNameSet(
		options.globalSymbols,
		options.builtinDescriptors,
		options.apiSignatures,
		options.extraGlobalNames,
		true,
	);
	const builtinLookup = buildBuiltinLookup(options.builtinDescriptors);
	addIdentifierDiagnosticsFromSemantic(diagnostics, options.analysis, globalKnownNames);
	addConstLocalWriteDiagnosticsFromSemantic(diagnostics, options.analysis);
	addConstLocalInitializerDiagnostics(diagnostics, options.chunk);
	addCallDiagnosticsFromSemantic(diagnostics, options.analysis, builtinLookup, options.apiSignatures, apiRoot);
	addReservedMemoryDiagnosticsFromSemantic(diagnostics, options.analysis, options.chunk);
	return diagnostics;
}

export function computeLuaProjectDiagnostics(
	sources: ReadonlyArray<LuaProjectSource>,
	options: LuaProjectDiagnosticOptions = {},
): Map<string, LuaStaticDiagnostic[]> {
	const results = new Map<string, LuaStaticDiagnostic[]>();
	if (sources.length === 0) {
		return results;
	}
	const builtinDescriptors = options.builtinDescriptors ?? getDefaultLuaBuiltinDescriptors();
	const apiSignatures = options.apiSignatures ?? getStaticLuaApiSignatureMap();
	const validSources: MutableProjectSource[] = [];
	const snapshotInputs: LuaSemanticWorkspaceSnapshotInput[] = [];
	for (let index = 0; index < sources.length; index += 1) {
		const source = sources[index];
		const parseEntry = getCachedLuaParse({
			path: source.path,
			source: source.source,
			version: source.version,
			withSyntaxError: true,
		});
		if (parseEntry.syntaxError) {
			results.set(source.path, [toSyntaxDiagnostic(parseEntry.syntaxError.message, parseEntry.syntaxError.line, parseEntry.syntaxError.column)]);
			continue;
		}
		snapshotInputs.push({
			path: source.path,
			source: parseEntry.source,
			lines: parseEntry.lines,
			parsed: parseEntry.parsed,
			version: source.version,
		});
	}
	if (snapshotInputs.length === 0) {
		return results;
	}
	const snapshot = buildLuaSemanticWorkspaceSnapshot(snapshotInputs);
	for (let index = 0; index < snapshot.sources.length; index += 1) {
		const source = snapshot.sources[index];
		validSources.push({
			path: source.path,
			chunk: source.chunk,
			analysis: source.analysis,
		});
	}
	const globalSymbols = buildGlobalSymbols(snapshot.listGlobalDecls());
	for (let index = 0; index < validSources.length; index += 1) {
		const source = validSources[index];
		results.set(source.path, computeLuaDiagnosticsFromAnalysis({
			analysis: source.analysis,
			chunk: source.chunk,
			globalSymbols,
			builtinDescriptors,
			apiSignatures,
			extraGlobalNames: options.extraGlobalNames,
		}));
	}
	return results;
}

function buildGlobalSymbols(decls: readonly Decl[]): LuaSymbolEntry[] {
	const symbols: LuaSymbolEntry[] = [];
	for (let index = 0; index < decls.length; index += 1) {
		const decl = decls[index];
		symbols.push({
			name: decl.name,
			path: decl.namePath.length > 0 ? decl.namePath.join('.') : decl.name,
			kind: semanticSymbolKindToLuaSymbolKind(decl.kind),
			location: {
				path: decl.file,
				range: {
					startLine: decl.range.start.line,
					startColumn: decl.range.start.column,
					endLine: decl.range.end.line,
					endColumn: decl.range.end.column,
				},
			},
		});
	}
	return symbols;
}

function toSyntaxDiagnostic(message: string, line: number, column: number): LuaStaticDiagnostic {
	const row = line - 1;
	const startColumn = column - 1;
	return {
		row,
		startColumn,
		endColumn: startColumn + 1,
		message,
		severity: 'error',
	};
}

function pushDiagnostic(
	diagnostics: LuaStaticDiagnostic[],
	row: number,
	startColumn: number,
	endColumn: number,
	message: string,
	severity: LuaStaticDiagnosticSeverity,
): void {
	diagnostics.push({
		row,
		startColumn,
		endColumn: endColumn > startColumn ? endColumn : startColumn + 1,
		message,
		severity,
	});
}

function pushRangeDiagnostic(
	diagnostics: LuaStaticDiagnostic[],
	range: LuaSourceRange,
	message: string,
	severity: LuaStaticDiagnosticSeverity,
): void {
	const row = range.start.line - 1;
	const startColumn = range.start.column - 1;
	const endColumn = range.end.column > range.start.column ? range.end.column - 1 : startColumn + 1;
	pushDiagnostic(diagnostics, row, startColumn, endColumn, message, severity);
}

function buildBuiltinLookup(builtinDescriptors: readonly LuaBuiltinDescriptor[]): Map<string, LuaBuiltinDescriptor> {
	const lookup = new Map<string, LuaBuiltinDescriptor>();
	for (let index = 0; index < builtinDescriptors.length; index += 1) {
		const descriptor = builtinDescriptors[index];
		lookup.set(descriptor.name, descriptor);
	}
	return lookup;
}

function addIdentifierDiagnosticsFromSemantic(
	diagnostics: LuaStaticDiagnostic[],
	analysis: FileSemanticData,
	globalKnownNames: ReadonlySet<string>,
): void {
	const refs = analysis.refs;
	for (let index = 0; index < refs.length; index += 1) {
		const ref = refs[index];
		if (ref.isWrite || ref.target || ref.referenceKind !== 'identifier' || ref.namePath.length !== 1) {
			continue;
		}
		if (globalKnownNames.has(ref.name)) {
			continue;
		}
		const row = ref.range.start.line - 1;
		const startColumn = ref.range.start.column - 1;
		const endColumn = startColumn + ref.name.length;
		pushDiagnostic(diagnostics, row, startColumn, endColumn, `'${ref.name}' is not defined.`, 'error');
	}
}

function addConstLocalWriteDiagnosticsFromSemantic(diagnostics: LuaStaticDiagnostic[], analysis: FileSemanticData): void {
	const declById = new Map<string, Decl>();
	for (let index = 0; index < analysis.decls.length; index += 1) {
		const decl = analysis.decls[index];
		declById.set(decl.id, decl);
	}
	for (let index = 0; index < analysis.refs.length; index += 1) {
		const ref = analysis.refs[index];
		if (!ref.isWrite || !ref.target) {
			continue;
		}
		const decl = declById.get(ref.target);
		if (!decl || decl.kind !== 'constant') {
			continue;
		}
		const row = ref.range.start.line - 1;
		const startColumn = ref.range.start.column - 1;
		const endColumn = startColumn + ref.name.length;
		pushDiagnostic(diagnostics, row, startColumn, endColumn, `Cannot assign to constant local '${ref.name}'.`, 'error');
	}
}

function addConstLocalInitializerDiagnostics(diagnostics: LuaStaticDiagnostic[], chunk: LuaChunk): void {
	const isExplicitInitializer = (statement: LuaLocalAssignmentStatement, nameIndex: number): boolean => {
		if (statement.values.length === 0) {
			return false;
		}
		if (nameIndex < statement.values.length - 1) {
			return true;
		}
		if (nameIndex === statement.values.length - 1) {
			return true;
		}
		return isMultiReturnExpression(statement.values[statement.values.length - 1]);
	};
	const checkStatement = (statement: LuaStatement): void => {
		if (statement.kind !== LuaSyntaxKind.LocalAssignmentStatement) {
			return;
		}
		const localAssignment = statement as LuaLocalAssignmentStatement;
		for (let index = 0; index < localAssignment.names.length; index += 1) {
			if (localAssignment.attributes[index] !== 'const') {
				continue;
			}
			if (isExplicitInitializer(localAssignment, index)) {
				continue;
			}
			const identifier = localAssignment.names[index];
			pushRangeDiagnostic(diagnostics, identifier.range, `Constant local '${identifier.name}' must have an initializer.`, 'error');
		}
	};
	walkLuaStatementTree(chunk.body, checkStatement);
}

function addCallDiagnosticsFromSemantic(
	diagnostics: LuaStaticDiagnostic[],
	analysis: FileSemanticData,
	builtinLookup: Map<string, LuaBuiltinDescriptor>,
	apiSignatures: ReadonlyMap<string, LuaApiSignatureMetadata>,
	apiRoot: string,
): void {
	const calls = analysis.callExpressions;
	if (calls.length === 0) {
		return;
	}
	const signatures = analysis.functionSignatures;
	for (let index = 0; index < calls.length; index += 1) {
		const call = calls[index];
		const metadata = resolveCallSignature(call, builtinLookup, apiSignatures, apiRoot);
		if (metadata) {
			validateCallArity(diagnostics, call, metadata);
			continue;
		}
		if (signatures) {
			const userMetadata = resolveUserFunctionSignature(call, signatures);
			if (userMetadata) {
				validateCallArity(diagnostics, call, userMetadata);
			}
		}
	}
}

function resolveCallSignature(
	call: LuaCallExpression,
	builtinLookup: Map<string, LuaBuiltinDescriptor>,
	apiSignatures: ReadonlyMap<string, LuaApiSignatureMetadata>,
	apiRoot: string,
): CallSignatureMetadata | null {
	if (call.methodName !== null) {
		const qualified = resolveQualifiedName(call.callee);
		if (qualified && qualified.parts.length > 0 && qualified.parts[0] === apiRoot) {
			const apiMeta = apiSignatures.get(call.methodName);
			if (apiMeta) {
				return createCallSignatureMetadata(`api.${call.methodName}`, apiMeta.params, apiMeta.optionalParams, 'method', 'function');
			}
		}
		return null;
	}
	const qualified = resolveQualifiedName(call.callee);
	if (!qualified) {
		return null;
	}
	if (qualified.parts.length >= 2 && qualified.parts[0] === apiRoot) {
		const method = qualified.parts[qualified.parts.length - 1];
		const apiMeta = apiSignatures.get(method);
		if (apiMeta) {
			return createCallSignatureMetadata(`api.${method}`, apiMeta.params, apiMeta.optionalParams, 'function', 'function');
		}
	}
	const key = qualified.parts.join('.');
	const builtin = builtinLookup.get(key);
	if (builtin) {
		return createCallSignatureMetadata(builtin.name, builtin.params, builtin.optionalParams, 'function', 'function');
	}
	const apiMetaAsGlobal = apiSignatures.get(key);
	if (apiMetaAsGlobal) {
		return createCallSignatureMetadata(key, apiMetaAsGlobal.params, apiMetaAsGlobal.optionalParams, 'function', 'function');
	}
	return null;
}

function createCallSignatureMetadata(
	label: string,
	params: readonly string[],
	optionalParams: readonly string[] | undefined,
	callStyle: 'function' | 'method',
	declarationStyle: 'function' | 'method',
	requiredOverride?: number,
): CallSignatureMetadata {
	return {
		params,
		required: requiredOverride ?? countRequiredParameters(params, optionalParams),
		label,
		callStyle,
		declarationStyle,
	};
}

function resolveQualifiedName(expression: LuaExpression): QualifiedName | null {
	const parts: string[] = [];
	let current: LuaExpression = expression;
	while (current) {
		if (current.kind === LuaSyntaxKind.IdentifierExpression) {
			const identifier = current as LuaIdentifierExpression;
			parts.unshift(identifier.name);
			return { parts };
		}
		if (current.kind === LuaSyntaxKind.MemberExpression) {
			const member = current as LuaMemberExpression;
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

function countRequiredParameters(params: readonly string[], optionalParams?: readonly string[]): number {
	const optionalSet = optionalParams ? new Set(optionalParams) : null;
	let required = 0;
	for (let index = 0; index < params.length; index += 1) {
		const param = params[index];
		if (param === '...' || param.endsWith('...') || param.endsWith('?')) {
			continue;
		}
		if (optionalSet && optionalSet.has(param)) {
			continue;
		}
		required += 1;
	}
	return required;
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
		return `${parent}.${member.identifier}`;
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

function buildCallInfo(call: LuaCallExpression): FunctionCallInfo | null {
	if (call.methodName !== null) {
		const basePath = buildMemberBasePath(call.callee);
		if (basePath === null) {
			return null;
		}
		return { path: `${basePath}:${call.methodName}`, style: 'method' };
	}
	const qualified = resolveQualifiedName(call.callee);
	if (!qualified) {
		return null;
	}
	return { path: qualified.parts.join('.'), style: 'function' };
}

function convertPropertyPathToMethod(path: string): string | null {
	const index = path.lastIndexOf('.');
	if (index === -1) {
		return null;
	}
	const prefix = path.slice(0, index);
	const suffix = path.slice(index + 1);
	return `${prefix}:${suffix}`;
}

function resolveUserFunctionSignature(
	call: LuaCallExpression,
	signatures: ReadonlyMap<string, FunctionSignatureInfo>,
): CallSignatureMetadata | null {
	const callInfo = buildCallInfo(call);
	if (!callInfo) {
		return null;
	}
	const direct = signatures.get(callInfo.path);
	if (direct) {
		return createCallSignatureMetadata(callInfo.path, direct.params, undefined, callInfo.style, direct.declarationStyle, direct.minimumArgumentCount);
	}
	if (callInfo.style === 'method') {
		const dotPath = methodPathToPropertyPath(callInfo.path);
		if (dotPath) {
			const fallback = signatures.get(dotPath);
			if (fallback) {
				return createCallSignatureMetadata(dotPath, fallback.params, undefined, callInfo.style, fallback.declarationStyle, fallback.minimumArgumentCount);
			}
		}
	} else {
		const colonPath = convertPropertyPathToMethod(callInfo.path);
		if (colonPath) {
			const fallback = signatures.get(colonPath);
			if (fallback) {
				return createCallSignatureMetadata(colonPath, fallback.params, undefined, callInfo.style, fallback.declarationStyle, fallback.minimumArgumentCount);
			}
		}
	}
	return null;
}

function isSelfParameter(name: string): boolean {
	return name === 'self' || name === 'this';
}

function validateCallArity(diagnostics: LuaStaticDiagnostic[], call: LuaCallExpression, metadata: CallSignatureMetadata): void {
	let required = metadata.required;
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
	const row = call.range.start.line - 1;
	const startColumn = call.range.start.column - 1;
	const endColumnCandidate = call.range.end.column;
	const endColumn = endColumnCandidate > startColumn ? endColumnCandidate : startColumn + 1;
	const expectedLabel = required === 1 ? 'argument' : 'arguments';
	const providedLabel = actualCount === 1 ? 'was' : 'were';
	pushDiagnostic(
		diagnostics,
		row,
		startColumn,
		endColumn,
		`${metadata.label} expects ${required} ${expectedLabel}, but ${actualCount} ${providedLabel} provided.`,
		'error',
	);
}

function isMultiReturnExpression(expression: LuaExpression): boolean {
	return expression.kind === LuaSyntaxKind.CallExpression || expression.kind === LuaSyntaxKind.VarargExpression;
}

function collectAllowedReservedMemoryRanges(chunk: LuaChunk): Set<string> {
	const allowed = new Set<string>();
	const collectStatement = (statement: LuaStatement): void => {
		switch (statement.kind) {
			case LuaSyntaxKind.LocalAssignmentStatement:
				for (let index = 0; index < statement.values.length; index += 1) {
					visitExpression(statement.values[index]);
				}
				return;
			case LuaSyntaxKind.AssignmentStatement:
				for (let index = 0; index < statement.left.length; index += 1) {
					visitExpression(statement.left[index]);
				}
				for (let index = 0; index < statement.right.length; index += 1) {
					visitExpression(statement.right[index]);
				}
				return;
			case LuaSyntaxKind.ReturnStatement:
				for (let index = 0; index < statement.expressions.length; index += 1) {
					visitExpression(statement.expressions[index]);
				}
				return;
			case LuaSyntaxKind.IfStatement:
				for (let index = 0; index < statement.clauses.length; index += 1) {
					const clause = statement.clauses[index];
					if (clause.condition) {
						visitExpression(clause.condition);
					}
				}
				return;
			case LuaSyntaxKind.WhileStatement:
				visitExpression(statement.condition);
				return;
			case LuaSyntaxKind.RepeatStatement:
				visitExpression(statement.condition);
				return;
			case LuaSyntaxKind.ForNumericStatement:
				visitExpression(statement.start);
				visitExpression(statement.limit);
				if (statement.step) {
					visitExpression(statement.step);
				}
				return;
			case LuaSyntaxKind.ForGenericStatement:
				for (let index = 0; index < statement.iterators.length; index += 1) {
					visitExpression(statement.iterators[index]);
				}
				return;
			case LuaSyntaxKind.CallStatement:
				visitExpression(statement.expression);
				return;
			default:
				return;
		}
	};
	const visitExpression = (expression: LuaExpression): void => {
		switch (expression.kind) {
			case LuaSyntaxKind.IndexExpression:
				if (expression.base.kind === LuaSyntaxKind.IdentifierExpression && isReservedMemoryMapName(expression.base.name)) {
					allowed.add(sourceRangeStartKey(expression.base.range));
				}
				visitExpression(expression.base);
				visitExpression(expression.index);
				return;
			case LuaSyntaxKind.MemberExpression:
				visitExpression(expression.base);
				return;
			case LuaSyntaxKind.CallExpression:
				visitExpression(expression.callee);
				for (let index = 0; index < expression.arguments.length; index += 1) {
					visitExpression(expression.arguments[index]);
					}
					return;
				case LuaSyntaxKind.FunctionExpression:
					walkLuaStatementTree(expression.body.body, collectStatement);
					return;
			case LuaSyntaxKind.TableConstructorExpression:
				for (let index = 0; index < expression.fields.length; index += 1) {
					const field = expression.fields[index];
					if (field.kind === LuaTableFieldKind.Array) {
						visitExpression(field.value);
						continue;
					}
					if (field.kind === LuaTableFieldKind.IdentifierKey) {
						visitExpression(field.value);
						continue;
					}
					visitExpression(field.key);
					visitExpression(field.value);
				}
				return;
			case LuaSyntaxKind.BinaryExpression:
				visitExpression(expression.left);
				visitExpression(expression.right);
				return;
			case LuaSyntaxKind.UnaryExpression:
				visitExpression(expression.operand);
				return;
			default:
				return;
		}
	};
	walkLuaStatementTree(chunk.body, collectStatement);
	return allowed;
}

function addReservedMemoryDiagnosticsFromSemantic(
	diagnostics: LuaStaticDiagnostic[],
	analysis: FileSemanticData,
	chunk: LuaChunk,
): void {
	const allowedReservedRanges = collectAllowedReservedMemoryRanges(chunk);
	for (let index = 0; index < analysis.decls.length; index += 1) {
		const decl = analysis.decls[index];
		if (!isReservedMemoryMapName(decl.name)) {
			continue;
		}
		switch (decl.kind) {
			case 'local':
			case 'constant':
			case 'parameter':
				pushRangeDiagnostic(diagnostics, decl.range, `'${decl.name}' is a reserved memory map name and cannot be used as a local, constant, or parameter.`, 'error');
				continue;
			case 'function':
			case 'global':
				pushRangeDiagnostic(diagnostics, decl.range, `'${decl.name}' is a reserved memory map. Use direct indexing syntax like ${decl.name}[addr].`, 'error');
				continue;
		}
	}
	for (let index = 0; index < analysis.refs.length; index += 1) {
		const ref = analysis.refs[index];
		if (!isReservedMemoryMapName(ref.name) || ref.referenceKind !== 'identifier' || ref.namePath.length !== 1) {
			continue;
		}
		if (allowedReservedRanges.has(sourceRangeStartKey(ref.range))) {
			continue;
		}
		pushRangeDiagnostic(diagnostics, ref.range, `'${ref.name}' is a reserved memory map. Use direct indexing syntax like ${ref.name}[addr].`, 'error');
	}
}
