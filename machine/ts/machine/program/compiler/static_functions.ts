import {
	LuaSyntaxKind,
	type LuaChunk,
	type LuaFunctionExpression,
	type LuaLocalAssignmentStatement,
	type LuaLocalFunctionStatement,
} from '../../../lua/syntax/ast';
import type { LuaSemanticFrontendFile } from '../../../lua/semantic/frontend';
import type { ConstExportValue } from './const_module_exports';

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

export const collectStaticFunctionExports = (
	chunk: LuaChunk,
	semantics: LuaSemanticFrontendFile,
	exportValues: ReadonlyMap<string, ConstExportValue>,
): StaticFunctionExport[] => {
	const functions = collectTopLevelFunctionExpressions(chunk, semantics);
	const exportsBySymbol = new Map<string, StaticFunctionExport>();
	for (const value of exportValues.values()) {
		if (value.kind !== 'function') {
			continue;
		}
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
