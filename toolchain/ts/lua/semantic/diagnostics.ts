import {
	LuaSyntaxKind,
	LuaTableFieldKind,
	type LuaCallExpression,
	type LuaChunk,
	type LuaExpression,
	type LuaLocalAssignmentStatement,
	type LuaSourceRange,
	type LuaStatement,
} from '../syntax/ast';
import {
	DEFAULT_LUA_BUILTIN_FUNCTIONS,
	getLuaBuiltinDescriptorLookup,
} from '../builtin_descriptors';
import type { LuaBuiltinDescriptor, LuaSymbolEntry } from '../semantic_contracts';
import {
	buildLuaSemanticWorkspaceSnapshot,
	type Decl,
	type FileSemanticData,
	type LuaSemanticWorkspaceSnapshotInput,
	type SymbolID,
} from './model';
import type { WorkspaceSymbolResolver } from './workspace_symbol_resolver';
import { getCachedLuaParse } from '../analysis/cache';
import { sourceRangeStartKey } from './source_range';
import { buildLuaKnownNameSet, isReservedMemoryMapName, semanticSymbolKindToLuaSymbolKind } from './common';
import {
	formatLuaCallReferencePath,
	getLuaBuiltinMinimumArgumentCount,
	getLuaCallMinimumArgumentCount,
	getLuaCallStyle,
} from './call_signature';
import { resolveStaticLuaExpressionPath } from './expression_path';

export type LuaStaticDiagnostic = {
	row: number;
	startColumn: number;
	endColumn: number;
	message: string;
	severity: LuaStaticDiagnosticSeverity;
};

export type LuaStaticDiagnosticSeverity = 'error' | 'warning';

export type LuaAnalysisDiagnosticOptions = {
	analysis: FileSemanticData;
	chunk: LuaChunk;
	globalSymbols: readonly LuaSymbolEntry[];
	builtinDescriptors: readonly LuaBuiltinDescriptor[];
	extraGlobalNames?: readonly string[];
	symbolResolver: WorkspaceSymbolResolver;
};

export type LuaProjectSource = {
	path: string;
	source: string;
};

export type LuaProjectDiagnosticOptions = {
	builtinDescriptors?: readonly LuaBuiltinDescriptor[];
	extraGlobalNames?: readonly string[];
};

type CallSignatureMetadata = {
	required: number;
	label: string;
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
		case LuaSyntaxKind.StructDeclarationStatement:
		case LuaSyntaxKind.BssDeclarationStatement:
		case LuaSyntaxKind.DataDeclarationStatement:
		case LuaSyntaxKind.RodataDeclarationStatement:
			return;
		default:
			return;
	}
}

const DEFAULT_LUA_BUILTIN_DESCRIPTORS = DEFAULT_LUA_BUILTIN_FUNCTIONS as readonly LuaBuiltinDescriptor[];

export function getDefaultLuaBuiltinDescriptors(): readonly LuaBuiltinDescriptor[] {
	return DEFAULT_LUA_BUILTIN_DESCRIPTORS;
}

export function computeLuaDiagnosticsFromAnalysis(options: LuaAnalysisDiagnosticOptions): LuaStaticDiagnostic[] {
	const diagnostics: LuaStaticDiagnostic[] = [];
	const globalKnownNames = buildLuaKnownNameSet(
		options.globalSymbols,
		options.builtinDescriptors,
		options.extraGlobalNames,
	);
	const builtinLookup = getLuaBuiltinDescriptorLookup(options.builtinDescriptors);
	addIdentifierDiagnosticsFromSemantic(diagnostics, options.analysis, globalKnownNames);
	addConstLocalWriteDiagnosticsFromSemantic(diagnostics, options.analysis);
	addConstLocalInitializerDiagnostics(diagnostics, options.chunk);
	addCallDiagnosticsFromSemantic(diagnostics, options.analysis, builtinLookup, options.symbolResolver);
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
	const snapshotInputs: LuaSemanticWorkspaceSnapshotInput[] = [];
	for (let index = 0; index < sources.length; index += 1) {
		const source = sources[index];
		const parseEntry = getCachedLuaParse({
			path: source.path,
			source: source.source,
		});
		if (parseEntry.syntaxError) {
			results.set(source.path, [toSyntaxDiagnostic(parseEntry.syntaxError.message, parseEntry.syntaxError.line, parseEntry.syntaxError.column)]);
			continue;
		}
		snapshotInputs.push({
			path: source.path,
			source: parseEntry.source,
			parsed: parseEntry.parsed,
		});
	}
	if (snapshotInputs.length === 0) {
		return results;
	}
	const snapshot = buildLuaSemanticWorkspaceSnapshot(snapshotInputs);
	const globalSymbols = buildGlobalSymbols(snapshot.listGlobalDecls());
	for (let index = 0; index < snapshot.files.length; index += 1) {
		const file = snapshot.files[index];
		results.set(file.file, computeLuaDiagnosticsFromAnalysis({
			analysis: file,
			chunk: file.chunk,
			globalSymbols,
			builtinDescriptors,
			extraGlobalNames: options.extraGlobalNames,
			symbolResolver: snapshot.symbolResolver,
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
	const endColumn = range.end.column > range.start.column ? range.end.column : startColumn + 1;
	pushDiagnostic(diagnostics, row, startColumn, endColumn, message, severity);
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
	builtinLookup: ReadonlyMap<string, LuaBuiltinDescriptor>,
	symbolResolver: WorkspaceSymbolResolver,
): void {
	const callSites = analysis.callSites;
	if (callSites.length === 0) {
		return;
	}
	for (let index = 0; index < callSites.length; index += 1) {
		const callSite = callSites[index];
		const call = callSite.expression;
		if (callSite.directTarget !== undefined) {
			const declaration = symbolResolver.getDeclaration(callSite.directTarget);
			const userMetadata = resolveUserFunctionSignature(
				call,
				declaration.namePath.join('.'),
				callSite.directTarget,
				symbolResolver,
			);
			if (userMetadata) {
				validateCallArity(diagnostics, call, userMetadata);
			}
			continue;
		}
		const reference = callSite.reference;
		if (reference?.target !== undefined) {
			const callStyle = getLuaCallStyle(call);
			const userMetadata = resolveUserFunctionSignature(
				call,
				formatLuaCallReferencePath(reference, callStyle),
				reference.target,
				symbolResolver,
			);
			if (userMetadata) {
				validateCallArity(diagnostics, call, userMetadata);
			}
			continue;
		}
		const metadata = resolveCallSignature(call, builtinLookup);
		if (metadata) {
			validateCallArity(diagnostics, call, metadata);
		}
	}
}

function resolveCallSignature(
	call: LuaCallExpression,
	builtinLookup: ReadonlyMap<string, LuaBuiltinDescriptor>,
): CallSignatureMetadata | null {
	if (call.method !== null) {
		return null;
	}
	const path = resolveStaticLuaExpressionPath(call.callee);
	if (path === null) {
		return null;
	}
	const builtin = builtinLookup.get(path);
	if (builtin) {
		return {
			required: getLuaBuiltinMinimumArgumentCount(builtin),
			label: builtin.name,
		};
	}
	return null;
}

function resolveUserFunctionSignature(
	call: LuaCallExpression,
	label: string,
	target: SymbolID,
	symbolResolver: WorkspaceSymbolResolver,
): CallSignatureMetadata | null {
	const signature = symbolResolver.getDeclaration(target).signature;
	if (!signature) {
		return null;
	}
	const callStyle = getLuaCallStyle(call);
	return {
		required: getLuaCallMinimumArgumentCount(signature, callStyle),
		label,
	};
}

function validateCallArity(diagnostics: LuaStaticDiagnostic[], call: LuaCallExpression, metadata: CallSignatureMetadata): void {
	const required = metadata.required;
	const actualCount = call.arguments.length;
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
