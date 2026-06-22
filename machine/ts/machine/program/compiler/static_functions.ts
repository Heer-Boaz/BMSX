import {
	LuaSyntaxKind,
	LuaTableFieldKind,
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
import { extractTableKeyFromExpression } from './expression_paths';
import { buildModuleExportPathKey, buildModuleExportSlotName } from './module_names';

export type StaticFunctionExportSymbol = {
	symbolHandle: string;
	slotName: string;
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
	out: Map<string, StaticFunctionExportSymbol>,
	path: string[],
): void => {
	if (expression.kind === LuaSyntaxKind.TableConstructorExpression) {
		const table = expression as LuaTableConstructorExpression;
		for (let index = 0; index < table.fields.length; index += 1) {
			const field = table.fields[index];
			if (field.kind === LuaTableFieldKind.Array) {
				continue;
			}
			const key = field.kind === LuaTableFieldKind.IdentifierKey
				? field.name
				: extractTableKeyFromExpression(field.key);
			if (!key) {
				continue;
			}
			path.push(key);
			collectStaticFunctionExportSymbols(modulePath, field.value, functions, semantics, out, path);
			path.pop();
		}
		return;
	}
	if (expression.kind !== LuaSyntaxKind.IdentifierExpression) {
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
): Map<string, StaticFunctionExportSymbol> => {
	const out = new Map<string, StaticFunctionExportSymbol>();
	collectStaticFunctionExportSymbols(modulePath, returnExpression, collectTopLevelFunctionExpressions(chunk, semantics), semantics, out, []);
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
			const expression = functions.get(value.symbolHandle);
			if (expression === undefined) {
				throw new Error(`[Compiler] Static function export '${value.symbolHandle}' has no top-level function body.`);
			}
			entry = { symbolHandle: value.symbolHandle, expression, slotNames: [] };
			exportsBySymbol.set(value.symbolHandle, entry);
		}
		entry.slotNames.push(value.slotName);
	}
	return Array.from(exportsBySymbol.values());
};
