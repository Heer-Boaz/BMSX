import type { ConsoleLuaBuiltinDescriptor, ConsoleLuaSymbolEntry, ConsoleResourceDescriptor } from '../types';
import type { EditorDiagnostic } from './types';
import { BmsxConsoleRuntime } from '../runtime';
import { computeLuaDiagnostics, getApiCompletionData, type LuaDiagnostic } from './intellisense';
import { buildLuaFileSemanticData } from './semantic_model';
import { ide_state, diagnosticsDebounceMs } from './ide_state';
import {
	LuaSyntaxKind,
	LuaTableFieldKind,
	type LuaAssignmentStatement,
	type LuaBlock,
	type LuaCallExpression,
	type LuaCallStatement,
	type LuaDoStatement,
	type LuaExpression,
	type LuaForGenericStatement,
	type LuaForNumericStatement,
	type LuaFunctionDeclarationStatement,
	type LuaFunctionExpression,
	type LuaIfStatement,
	type LuaIndexExpression,
	type LuaLocalAssignmentStatement,
	type LuaLocalFunctionStatement,
	type LuaMemberExpression,
	type LuaRepeatStatement,
	type LuaReturnStatement,
	type LuaStatement,
	type LuaTableArrayField,
	type LuaTableConstructorExpression,
	type LuaTableExpressionField,
	type LuaTableIdentifierField,
	type LuaWhileStatement,
	type LuaBinaryExpression,
	type LuaUnaryExpression,
	type LuaIdentifierExpression,
	type LuaStringLiteralExpression,
} from '../../lua/ast';
import { parseLuaChunkWithRecovery } from './lua_parse';

export type DiagnosticContextInput = {
	id: string;
	title: string;
	descriptor: ConsoleResourceDescriptor;
	chunkName: string;
	source: string;
};

export type DiagnosticProviders = {
	listLocalSymbols(chunkName: string): ConsoleLuaSymbolEntry[];
	listGlobalSymbols(): ConsoleLuaSymbolEntry[];
	listBuiltins(): ConsoleLuaBuiltinDescriptor[];
};

export function computeAggregatedEditorDiagnostics(
	contexts: ReadonlyArray<DiagnosticContextInput>,
	providers: DiagnosticProviders,
): EditorDiagnostic[] {
	if (!Array.isArray(contexts) || contexts.length === 0) return [];
	let globalSymbols: ConsoleLuaSymbolEntry[];
	let builtinDescriptors: ConsoleLuaBuiltinDescriptor[];
	try { globalSymbols = providers.listGlobalSymbols(); } catch { globalSymbols = []; }
	try { builtinDescriptors = providers.listBuiltins(); } catch { builtinDescriptors = []; }
	const apiData = getApiCompletionData();
	const globalSymbolsByKey = groupGlobalSymbolsByKey(globalSymbols);

	const aggregated: EditorDiagnostic[] = [];
	for (let i = 0; i < contexts.length; i += 1) {
		const ctx = contexts[i];
		const chunkName = resolveChunkName(ctx);
		const source = ctx.source ?? '';
		if (source.length === 0) continue;
		let localSymbols: ConsoleLuaSymbolEntry[] = [];
		try { localSymbols = providers.listLocalSymbols(chunkName); } catch { localSymbols = []; }
		let luaDiagnostics: LuaDiagnostic[];
		try {
			luaDiagnostics = computeLuaDiagnostics({
				source,
				chunkName: chunkName ?? ctx.title ?? 'lua',
				localSymbols,
				globalSymbols,
				builtinDescriptors,
				apiSignatures: apiData.signatures,
			});
		} catch {
			luaDiagnostics = [];
		}
		for (let j = 0; j < luaDiagnostics.length; j += 1) {
			const d = luaDiagnostics[j];
			const startColumn = d.startColumn > 0 ? d.startColumn : 0;
			const adjustedEnd = d.endColumn > startColumn ? d.endColumn : startColumn + 1;
			aggregated.push({
				row: d.row,
				startColumn,
				endColumn: adjustedEnd,
				message: d.message,
				severity: d.severity,
				contextId: ctx.id,
				sourceLabel: chunkName,
				chunkName,
			});
		}
		const requireDiagnostics = computeMissingRequireDiagnostics(ctx, chunkName, source, globalSymbolsByKey);
		for (let index = 0; index < requireDiagnostics.length; index += 1) {
			aggregated.push(requireDiagnostics[index]);
		}
	}
	return aggregated;
}

function resolveChunkName(ctx: DiagnosticContextInput): string {
	const candidate = ctx.chunkName && ctx.chunkName.length > 0 ? ctx.chunkName : null;
	if (candidate) return candidate;
	const descriptor = ctx.descriptor;
	if (descriptor) {
		if (descriptor.path && descriptor.path.length > 0) return descriptor.path;
	}
	return ctx.title;
}

function groupGlobalSymbolsByKey(symbols: readonly ConsoleLuaSymbolEntry[]): Map<string, ConsoleLuaSymbolEntry[]> {
	const map = new Map<string, ConsoleLuaSymbolEntry[]>();
	for (let index = 0; index < symbols.length; index += 1) {
		const entry = symbols[index];
		const key = entry.path && entry.path.length > 0 ? entry.path : entry.name;
		let bucket = map.get(key);
		if (!bucket) {
			bucket = [];
			map.set(key, bucket);
		}
		bucket.push(entry);
	}
	return map;
}

function computeMissingRequireDiagnostics(
	context: DiagnosticContextInput,
	chunkName: string,
	source: string,
	globalSymbolsByKey: Map<string, ConsoleLuaSymbolEntry[]>,
): EditorDiagnostic[] {
	const runtime = BmsxConsoleRuntime.instance;
	runtime.ensureLuaModuleIndex();
	const semantic = buildLuaFileSemanticData(source, chunkName);
	const requiredChunks = collectRequiredChunkNames(runtime, source, chunkName);
	const localSymbols = new Set<string>();
	for (let i = 0; i < semantic.decls.length; i += 1) {
		localSymbols.add(semantic.decls[i].symbolKey);
	}
	const seen = new Set<string>();
	const diagnostics: EditorDiagnostic[] = [];
	for (let i = 0; i < semantic.refs.length; i += 1) {
		const ref = semantic.refs[i];
		const key = ref.symbolKey;
		if (!key || localSymbols.has(key)) {
			continue;
		}
		const candidates = globalSymbolsByKey.get(key);
		if (!candidates || candidates.length === 0) {
			continue;
		}
		let target: ConsoleLuaSymbolEntry = null;
		for (let j = 0; j < candidates.length; j += 1) {
			const candidate = candidates[j];
			if (candidate.location.chunkName === chunkName) {
				continue;
			}
			if (requiredChunks.has(candidate.location.chunkName)) {
				target = null;
				break;
			}
			if (!target) {
				target = candidate;
			}
		}
		if (!target) {
			continue;
		}
		const dedupeKey = `${ref.range.start.line}:${ref.range.start.column}:${key}`;
		if (seen.has(dedupeKey)) {
			continue;
		}
		seen.add(dedupeKey);
		const row = ref.range.start.line > 0 ? ref.range.start.line - 1 : 0;
		const startColumn = ref.range.start.column > 0 ? ref.range.start.column - 1 : 0;
		const endColumn = ref.range.end.column > startColumn ? ref.range.end.column - 1 : startColumn + key.length;
		const sourceLabel = target.location.path ?? target.location.chunkName ?? '<module>';
		diagnostics.push({
			row,
			startColumn,
			endColumn,
			message: `'${key}' comes from '${sourceLabel}', but this chunk never requires that module.`,
			severity: 'warning',
			contextId: context.id,
			sourceLabel: chunkName,
			chunkName,
		});
	}
	return diagnostics;
}

function collectRequiredChunkNames(runtime: BmsxConsoleRuntime, source: string, chunkName: string): Set<string> {
	const required = new Set<string>();
	required.add(chunkName);
	const modules = collectRequiredModuleNames(source, chunkName);
	for (const moduleName of modules) {
		const record = runtime.luaModuleAliases.get(moduleName);
		if (record) {
			required.add(record.chunkName);
		}
	}
	return required;
}

function collectRequiredModuleNames(source: string, chunkName: string): Set<string> {
	const chunk = parseLuaChunkWithRecovery(source, chunkName).chunk;
	const required = new Set<string>();
	for (let index = 0; index < chunk.body.length; index += 1) {
		collectModulesFromStatement(chunk.body[index], required);
	}
	return required;
}

function collectModulesFromStatement(statement: LuaStatement, required: Set<string>): void {
	switch (statement.kind) {
		case LuaSyntaxKind.AssignmentStatement: {
			const assignment = statement as LuaAssignmentStatement;
			for (let index = 0; index < assignment.right.length; index += 1) {
				collectModulesFromExpression(assignment.right[index], required);
			}
			break;
		}
		case LuaSyntaxKind.LocalAssignmentStatement: {
			const localAssignment = statement as LuaLocalAssignmentStatement;
			for (let index = 0; index < localAssignment.values.length; index += 1) {
				collectModulesFromExpression(localAssignment.values[index], required);
			}
			break;
		}
		case LuaSyntaxKind.LocalFunctionStatement: {
			const localFunction = statement as LuaLocalFunctionStatement;
			collectModulesFromFunction(localFunction.functionExpression, required);
			break;
		}
		case LuaSyntaxKind.FunctionDeclarationStatement: {
			const declaration = statement as LuaFunctionDeclarationStatement;
			collectModulesFromFunction(declaration.functionExpression, required);
			break;
		}
		case LuaSyntaxKind.ReturnStatement: {
			const returnStatement = statement as LuaReturnStatement;
			for (let index = 0; index < returnStatement.expressions.length; index += 1) {
				collectModulesFromExpression(returnStatement.expressions[index], required);
			}
			break;
		}
		case LuaSyntaxKind.IfStatement: {
			const ifStatement = statement as LuaIfStatement;
			for (let index = 0; index < ifStatement.clauses.length; index += 1) {
				const clause = ifStatement.clauses[index];
				collectModulesFromExpression(clause.condition, required);
				collectModulesFromBlock(clause.block, required);
			}
			break;
		}
		case LuaSyntaxKind.WhileStatement: {
			const whileStatement = statement as LuaWhileStatement;
			collectModulesFromExpression(whileStatement.condition, required);
			collectModulesFromBlock(whileStatement.block, required);
			break;
		}
		case LuaSyntaxKind.RepeatStatement: {
			const repeatStatement = statement as LuaRepeatStatement;
			collectModulesFromBlock(repeatStatement.block, required);
			collectModulesFromExpression(repeatStatement.condition, required);
			break;
		}
		case LuaSyntaxKind.ForNumericStatement: {
			const forNumeric = statement as LuaForNumericStatement;
			collectModulesFromExpression(forNumeric.start, required);
			collectModulesFromExpression(forNumeric.limit, required);
			if (forNumeric.step) {
				collectModulesFromExpression(forNumeric.step, required);
			}
			collectModulesFromBlock(forNumeric.block, required);
			break;
		}
		case LuaSyntaxKind.ForGenericStatement: {
			const forGeneric = statement as LuaForGenericStatement;
			for (let index = 0; index < forGeneric.iterators.length; index += 1) {
				collectModulesFromExpression(forGeneric.iterators[index], required);
			}
			collectModulesFromBlock(forGeneric.block, required);
			break;
		}
		case LuaSyntaxKind.DoStatement: {
			const doStatement = statement as LuaDoStatement;
			collectModulesFromBlock(doStatement.block, required);
			break;
		}
		case LuaSyntaxKind.CallStatement: {
			const callStatement = statement as LuaCallStatement;
			collectModulesFromExpression(callStatement.expression, required);
			break;
		}
		default:
			break;
	}
}

function collectModulesFromBlock(block: LuaBlock, required: Set<string>): void {
	for (let index = 0; index < block.body.length; index += 1) {
		collectModulesFromStatement(block.body[index], required);
	}
}

function collectModulesFromFunction(fn: LuaFunctionExpression, required: Set<string>): void {
	collectModulesFromBlock(fn.body, required);
}

function collectModulesFromExpression(expression: LuaExpression, required: Set<string>): void {
	switch (expression.kind) {
		case LuaSyntaxKind.CallExpression: {
			const callExpression = expression as LuaCallExpression;
			const moduleName = tryGetRequireModuleName(callExpression);
			if (moduleName) {
				required.add(moduleName);
			}
			collectModulesFromExpression(callExpression.callee, required);
			for (let index = 0; index < callExpression.arguments.length; index += 1) {
				collectModulesFromExpression(callExpression.arguments[index], required);
			}
			break;
		}
		case LuaSyntaxKind.FunctionExpression: {
			const functionExpression = expression as LuaFunctionExpression;
			collectModulesFromBlock(functionExpression.body, required);
			break;
		}
		case LuaSyntaxKind.TableConstructorExpression: {
			const tableConstructor = expression as LuaTableConstructorExpression;
			for (let index = 0; index < tableConstructor.fields.length; index += 1) {
				const field = tableConstructor.fields[index];
				switch (field.kind) {
					case LuaTableFieldKind.Array:
						collectModulesFromExpression((field as LuaTableArrayField).value, required);
						break;
					case LuaTableFieldKind.IdentifierKey:
						collectModulesFromExpression((field as LuaTableIdentifierField).value, required);
						break;
					case LuaTableFieldKind.ExpressionKey: {
						const expressionField = field as LuaTableExpressionField;
						collectModulesFromExpression(expressionField.key, required);
						collectModulesFromExpression(expressionField.value, required);
						break;
					}
					default:
						break;
				}
			}
			break;
		}
		case LuaSyntaxKind.BinaryExpression: {
			const binaryExpression = expression as LuaBinaryExpression;
			collectModulesFromExpression(binaryExpression.left, required);
			collectModulesFromExpression(binaryExpression.right, required);
			break;
		}
		case LuaSyntaxKind.UnaryExpression: {
			const unaryExpression = expression as LuaUnaryExpression;
			collectModulesFromExpression(unaryExpression.operand, required);
			break;
		}
		case LuaSyntaxKind.MemberExpression: {
			const memberExpression = expression as LuaMemberExpression;
			collectModulesFromExpression(memberExpression.base, required);
			break;
		}
		case LuaSyntaxKind.IndexExpression: {
			const indexExpression = expression as LuaIndexExpression;
			collectModulesFromExpression(indexExpression.base, required);
			collectModulesFromExpression(indexExpression.index, required);
			break;
		}
		default:
			break;
	}
}

function tryGetRequireModuleName(callExpression: LuaCallExpression): string {
	if (callExpression.methodName) {
		return null;
	}
	if (callExpression.callee.kind !== LuaSyntaxKind.IdentifierExpression) {
		return null;
	}
	const callee = callExpression.callee as LuaIdentifierExpression;
	if (callee.name.toLowerCase() !== 'require') {
		return null;
	}
	if (callExpression.arguments.length === 0) {
		return null;
	}
	const firstArg = callExpression.arguments[0];
	if (firstArg.kind !== LuaSyntaxKind.StringLiteralExpression) {
		return null;
	}
	const moduleName = (firstArg as LuaStringLiteralExpression).value.trim();
	return moduleName.length > 0 ? moduleName : null;
}

export function markDiagnosticsDirty(contextId?: string): void {
	const targetId = contextId ?? ide_state.activeCodeTabContextId;
	if (!targetId) {
		return;
	}
	ide_state.diagnosticsDirty = true;
	ide_state.dirtyDiagnosticContexts.add(targetId);
	ide_state.diagnosticsDueAtMs = ide_state.clockNow() + diagnosticsDebounceMs;
}
