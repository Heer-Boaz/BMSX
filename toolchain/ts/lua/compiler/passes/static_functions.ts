import {
	LuaSyntaxKind,
	type LuaChunk,
	type LuaExpression,
	type LuaFunctionExpression,
	type LuaIdentifierExpression,
	type LuaLocalAssignmentStatement,
	type LuaLocalFunctionStatement,
	type LuaTableConstructorExpression,
} from '../../syntax/ast';
import type { LuaSemanticFrontendFile } from '../../semantic/frontend';
import {
	getBoundDeclaration,
	getBoundIdentifierReference as getResolvedIdentifierReference,
} from '../bound_reference';
import { visitNamedTableFields } from './expression_paths';
import { buildModuleExportPathKey, buildModuleExportSlotName } from '../../module_path';

export type StaticFunctionExportSymbol = {
	symbolHandle: string;
	slotName: string;
	displayName: string;
	expression?: LuaFunctionExpression;
};

export type StaticFunctionExport = {
	symbolHandle: string;
	expression: LuaFunctionExpression;
	displayName: string;
	slotNames: string[];
};

type TopLevelFunction = {
	expression: LuaFunctionExpression;
	displayName: string;
};

const collectTopLevelFunctionExpressions = (
	chunk: LuaChunk,
	semantics: LuaSemanticFrontendFile,
): Map<string, TopLevelFunction> => {
	const functions = new Map<string, TopLevelFunction>();
	for (let index = 0; index < chunk.body.length; index += 1) {
		const statement = chunk.body[index];
		if (statement.kind === LuaSyntaxKind.LocalFunctionStatement) {
			const localFunction = statement as LuaLocalFunctionStatement;
			const declaration = getBoundDeclaration(semantics, localFunction.name);
			functions.set(declaration.id, {
				expression: localFunction.functionExpression,
				displayName: declaration.name,
			});
			continue;
		}
		if (statement.kind !== LuaSyntaxKind.LocalAssignmentStatement) {
			continue;
		}
		const local = statement as LuaLocalAssignmentStatement;
		for (let nameIndex = 0; nameIndex < local.names.length && nameIndex < local.values.length; nameIndex += 1) {
			const value = local.values[nameIndex];
			if (local.attributes[nameIndex] === 'const' && value.kind === LuaSyntaxKind.FunctionExpression) {
				const declaration = getBoundDeclaration(semantics, local.names[nameIndex]);
				functions.set(declaration.id, {
					expression: value as LuaFunctionExpression,
					displayName: declaration.name,
				});
			}
		}
	}
	return functions;
};

const collectStaticFunctionExportSymbols = (
	modulePath: string,
	expression: LuaExpression,
	functions: ReadonlyMap<string, TopLevelFunction>,
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
			displayName: path.length === 0 ? modulePath : buildModuleExportPathKey(path),
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
	const fn = reference.decl && functions.get(reference.decl.id);
	if (fn) {
		out.set(buildModuleExportPathKey(path), {
			symbolHandle: reference.decl.id,
			slotName: buildModuleExportSlotName(modulePath, path),
			displayName: fn.displayName,
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
			const expression = value.expression ?? functions.get(value.symbolHandle)?.expression;
			if (expression === undefined) {
				throw new Error(`Const module function export '${value.symbolHandle}' has no top-level function body.`);
			}
			entry = {
				symbolHandle: value.symbolHandle,
				expression,
				displayName: value.displayName,
				slotNames: [],
			};
			exportsBySymbol.set(value.symbolHandle, entry);
		}
		entry.slotNames.push(value.slotName);
	}
	return Array.from(exportsBySymbol.values());
};
