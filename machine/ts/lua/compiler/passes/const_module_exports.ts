import {
	LuaSyntaxKind,
	LuaUnaryOperator,
	type LuaBooleanLiteralExpression,
	type LuaChunk,
	type LuaExpression,
	type LuaIdentifierExpression,
	type LuaLocalAssignmentStatement,
	type LuaNumericLiteralExpression,
	type LuaStringLiteralExpression,
	type LuaTableConstructorExpression,
	type LuaUnaryExpression,
} from '../../syntax/ast';
import type { LuaSemanticFrontendFile } from '../../semantic/frontend';
import { getBoundIdentifierReference as getResolvedIdentifierReference } from '../bound_reference';
import { visitNamedTableFields } from './expression_paths';
import { buildModuleExportPathKey } from './module_names';
import type { ModuleExportNode } from './module_shape';

type ExportPathIndex = {
	has(pathKey: string): boolean;
};

export type ConstExportValue =
	| { kind: 'nil' }
	| { kind: 'boolean'; value: boolean }
	| { kind: 'number'; value: number }
	| { kind: 'string'; value: string }
	| { kind: 'bss_addr'; symbolHandle: string }
	| { kind: 'data_addr'; symbolHandle: string }
	| { kind: 'rodata_addr'; symbolHandle: string };

const evaluateModuleConstLiteral = (
	expression: LuaExpression,
	constValuesBySymbol: ReadonlyMap<string, ConstExportValue>,
	semantics: LuaSemanticFrontendFile,
): ConstExportValue | undefined => {
	switch (expression.kind) {
		case LuaSyntaxKind.NumericLiteralExpression:
			return { kind: 'number', value: (expression as LuaNumericLiteralExpression).value };
		case LuaSyntaxKind.StringLiteralExpression:
			return { kind: 'string', value: (expression as LuaStringLiteralExpression).value };
		case LuaSyntaxKind.BooleanLiteralExpression:
			return { kind: 'boolean', value: (expression as LuaBooleanLiteralExpression).value };
		case LuaSyntaxKind.NilLiteralExpression:
			return { kind: 'nil' };
		case LuaSyntaxKind.FunctionExpression:
			return undefined;
		case LuaSyntaxKind.IdentifierExpression: {
			const reference = getResolvedIdentifierReference(semantics, expression as LuaIdentifierExpression);
			return reference.decl ? constValuesBySymbol.get(reference.decl.id) : undefined;
		}
		case LuaSyntaxKind.UnaryExpression: {
			const unary = expression as LuaUnaryExpression;
			if (unary.operator !== LuaUnaryOperator.Negate) {
				return undefined;
			}
			const operand = evaluateModuleConstLiteral(unary.operand, constValuesBySymbol, semantics);
			return operand !== undefined && operand.kind === 'number'
				? { kind: 'number', value: -operand.value }
				: undefined;
		}
		default:
			return undefined;
	}
};

const evaluateModuleConstExportExpression = (
	expression: LuaExpression,
	constValuesBySymbol: ReadonlyMap<string, ConstExportValue>,
	semantics: LuaSemanticFrontendFile,
	allowStaticStorageExports: boolean,
): ConstExportValue | undefined => {
	const value = evaluateModuleConstLiteral(expression, constValuesBySymbol, semantics);
	if (value !== undefined) {
		return value;
	}
	if (!allowStaticStorageExports || expression.kind !== LuaSyntaxKind.IdentifierExpression) {
		return undefined;
	}
	const reference = getResolvedIdentifierReference(semantics, expression as LuaIdentifierExpression);
	if (reference.decl?.kind === 'bss') {
		return { kind: 'bss_addr', symbolHandle: reference.decl.id };
	}
	if (reference.decl?.kind === 'data') {
		return { kind: 'data_addr', symbolHandle: reference.decl.id };
	}
	return reference.decl?.kind === 'rodata'
		? { kind: 'rodata_addr', symbolHandle: reference.decl.id }
		: undefined;
};

const collectTopLevelConstValues = (
	chunk: LuaChunk,
	semantics: LuaSemanticFrontendFile,
): Map<string, ConstExportValue> => {
	const consts = new Map<string, ConstExportValue>();
	for (let index = 0; index < chunk.body.length; index += 1) {
		const statement = chunk.body[index];
		if (statement.kind !== LuaSyntaxKind.LocalAssignmentStatement) {
			continue;
		}
		const local = statement as LuaLocalAssignmentStatement;
		if (local.names.length !== 1 || local.attributes[0] !== 'const' || local.values.length !== 1) {
			continue;
		}
		if (local.values[0].kind === LuaSyntaxKind.FunctionExpression) {
			continue;
		}
		const value = evaluateModuleConstLiteral(local.values[0], consts, semantics);
		if (value !== undefined) {
			const declaration = semantics.getDeclaration(local.names[0].range);
			consts.set(declaration.id, value);
		}
	}
	return consts;
};

const collectModuleExportConstValues = (
	expression: LuaExpression,
	constValuesBySymbol: ReadonlyMap<string, ConstExportValue>,
	semantics: LuaSemanticFrontendFile,
	allowStaticStorageExports: boolean,
	out: Map<string, ConstExportValue>,
	path: string[],
): void => {
	if (expression.kind === LuaSyntaxKind.TableConstructorExpression) {
		const table = expression as LuaTableConstructorExpression;
		visitNamedTableFields(table, (key, value) => {
			path.push(key);
			collectModuleExportConstValues(value, constValuesBySymbol, semantics, allowStaticStorageExports, out, path);
			path.pop();
		});
		return;
	}
	const value = evaluateModuleConstExportExpression(expression, constValuesBySymbol, semantics, allowStaticStorageExports);
	if (value !== undefined) {
		out.set(buildModuleExportPathKey(path), value);
	}
};

export const assertConstModuleExportsAreStatic = (
	modulePath: string,
	exportRoot: ModuleExportNode,
	exportConstValueByPathKey: ReadonlyMap<string, ConstExportValue>,
	staticFunctionExportByPathKey: ExportPathIndex,
): void => {
	const visit = (node: ModuleExportNode, path: string[], visiting: WeakSet<ModuleExportNode>): void => {
		if (visiting.has(node)) {
			return;
		}
		visiting.add(node);
		for (const [key, child] of node.children) {
			path.push(key);
			const pathKey = buildModuleExportPathKey(path);
			if (child.children.size === 0 && !exportConstValueByPathKey.has(pathKey) && !staticFunctionExportByPathKey.has(pathKey)) {
				throw new Error(`Const module '${modulePath}' export '${pathKey}' is not a compile-time constant or static symbol.`);
			}
			visit(child, path, visiting);
			path.pop();
		}
		visiting.delete(node);
	};
	visit(exportRoot, [], new WeakSet());
};

export const collectConstModuleExportValues = (
	chunk: LuaChunk,
	expression: LuaExpression,
	semantics: LuaSemanticFrontendFile,
	allowStaticStorageExports: boolean,
): Map<string, ConstExportValue> => {
	const out = new Map<string, ConstExportValue>();
	collectModuleExportConstValues(expression, collectTopLevelConstValues(chunk, semantics), semantics, allowStaticStorageExports, out, []);
	return out;
};
