import {
	LuaSyntaxKind,
	type LuaChunk,
	type LuaExpression,
	type LuaFunctionExpression,
	type LuaIdentifierExpression,
	type LuaLocalAssignmentStatement,
	type LuaLocalFunctionStatement,
	type LuaTableConstructorExpression,
} from '../../../lua/syntax/ast';
import type { LuaSemanticFrontendFile } from '../../../lua/semantic/frontend';
import { getBoundIdentifierReference as getResolvedIdentifierReference } from '../bound_reference';
import { visitNamedTableFields } from './expression_paths';
import { buildModuleExportPathKey, buildModuleExportSlotName } from './module_names';

export type StaticFunctionExportSymbol = {
	symbolHandle: string;
	slotName: string;
	expression?: LuaFunctionExpression;
};

export type StaticFunctionExport = {
	symbolHandle: string;
	expression: LuaFunctionExpression;
	slotNames: string[];
};

const collectTopLevelFunctionExpressions = (
	chunk: LuaChunk,
	semantics: LuaSemanticFrontendFile,
): Map<string, LuaFunctionExpression> => {
	const functions = new Map<string, LuaFunctionExpression>();
	for (let index = 0; index < chunk.body.length; index += 1) {
		const statement = chunk.body[index];
		if (statement.kind === LuaSyntaxKind.LocalFunctionStatement) {
			const localFunction = statement as LuaLocalFunctionStatement;
			functions.set(semantics.getDeclaration(localFunction.name.range).id, localFunction.functionExpression);
			continue;
		}
		if (statement.kind !== LuaSyntaxKind.LocalAssignmentStatement) {
			continue;
		}
		const local = statement as LuaLocalAssignmentStatement;
		for (let nameIndex = 0; nameIndex < local.names.length && nameIndex < local.values.length; nameIndex += 1) {
			const value = local.values[nameIndex];
			if (local.attributes[nameIndex] === 'const' && value.kind === LuaSyntaxKind.FunctionExpression) {
				functions.set(semantics.getDeclaration(local.names[nameIndex].range).id, value as LuaFunctionExpression);
			}
		}
	}
	return functions;
};

const collectStaticFunctionExportSymbols = (
	modulePath: string,
	expression: LuaExpression,
	functions: ReadonlyMap<string, LuaFunctionExpression>,
	semantics: LuaSemanticFrontendFile,
	includeLocalBindingExports: boolean,
	out: Map<string, StaticFunctionExportSymbol>,
	path: string[],
): void => {
	if (expression.kind === LuaSyntaxKind.TableConstructorExpression) {
		const table = expression as LuaTableConstructorExpression;
		visitNamedTableFields(table, (key, value) => {
			path.push(key);
			collectStaticFunctionExportSymbols(modulePath, value, functions, semantics, includeLocalBindingExports, out, path);
			path.pop();
		});
		return;
	}
	if (expression.kind === LuaSyntaxKind.FunctionExpression) {
		if (path.length !== 0 && !includeLocalBindingExports) {
			return;
		}
		const slotName = buildModuleExportSlotName(modulePath, path);
		out.set(buildModuleExportPathKey(path), {
			symbolHandle: slotName,
			slotName,
			expression: expression as LuaFunctionExpression,
		});
		return;
	}
	if (expression.kind !== LuaSyntaxKind.IdentifierExpression) {
		return;
	}
	if (!includeLocalBindingExports) {
		return;
	}
	const reference = getResolvedIdentifierReference(semantics, expression as LuaIdentifierExpression);
	if (reference.decl && functions.has(reference.decl.id)) {
		out.set(buildModuleExportPathKey(path), {
			symbolHandle: reference.decl.id,
			slotName: buildModuleExportSlotName(modulePath, path),
		});
	}
};

export const collectStaticFunctionExportSymbolsByPathKey = (
	modulePath: string,
	chunk: LuaChunk,
	returnExpression: LuaExpression,
	semantics: LuaSemanticFrontendFile,
	includeLocalBindingExports: boolean,
): Map<string, StaticFunctionExportSymbol> => {
	const out = new Map<string, StaticFunctionExportSymbol>();
	collectStaticFunctionExportSymbols(modulePath, returnExpression, collectTopLevelFunctionExpressions(chunk, semantics), semantics, includeLocalBindingExports, out, []);
	return out;
};

export const collectStaticFunctionExports = (
	chunk: LuaChunk,
	semantics: LuaSemanticFrontendFile,
	staticFunctionExportByPathKey: ReadonlyMap<string, StaticFunctionExportSymbol>,
): StaticFunctionExport[] => {
	const functions = collectTopLevelFunctionExpressions(chunk, semantics);
	const exportsBySymbol = new Map<string, StaticFunctionExport>();
	for (const value of staticFunctionExportByPathKey.values()) {
		let entry = exportsBySymbol.get(value.symbolHandle);
		if (entry === undefined) {
			const expression = value.expression ?? functions.get(value.symbolHandle);
			if (expression === undefined) {
				throw new Error(`[Compiler] Const module function export '${value.symbolHandle}' has no top-level function body.`);
			}
			entry = { symbolHandle: value.symbolHandle, expression, slotNames: [] };
			exportsBySymbol.set(value.symbolHandle, entry);
		}
		entry.slotNames.push(value.slotName);
	}
	return Array.from(exportsBySymbol.values());
};
