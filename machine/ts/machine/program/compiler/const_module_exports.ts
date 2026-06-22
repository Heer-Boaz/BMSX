import {
	LuaSyntaxKind,
	LuaTableFieldKind,
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
} from '../../../lua/syntax/ast';
import type { LuaSemanticFrontendFile } from '../../../lua/semantic/frontend';
import { getBoundIdentifierReference as getResolvedIdentifierReference } from '../bound_reference';
import { extractTableKeyFromExpression } from './expression_paths';
import { buildModuleExportPathKey } from './module_names';
import type { ModuleExportNode } from './module_shape';

export type ConstExportValue =
	| { kind: 'nil' }
	| { kind: 'boolean'; value: boolean }
	| { kind: 'number'; value: number }
	| { kind: 'string'; value: string }
	| { kind: 'bss_addr'; symbolHandle: string };

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
		case LuaSyntaxKind.IdentifierExpression: {
			const reference = getResolvedIdentifierReference(semantics, expression as LuaIdentifierExpression);
			return reference.decl?.kind === 'constant'
				? constValuesBySymbol.get(reference.decl.id)
				: undefined;
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
	allowBssExports: boolean,
): ConstExportValue | undefined => {
	const value = evaluateModuleConstLiteral(expression, constValuesBySymbol, semantics);
	if (value !== undefined) {
		return value;
	}
	if (!allowBssExports || expression.kind !== LuaSyntaxKind.IdentifierExpression) {
		return undefined;
	}
	const reference = getResolvedIdentifierReference(semantics, expression as LuaIdentifierExpression);
	return reference.decl?.kind === 'bss'
		? { kind: 'bss_addr', symbolHandle: reference.decl.id }
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
		const value = evaluateModuleConstLiteral(local.values[0], consts, semantics);
		if (value !== undefined) {
			const declaration = semantics.getDeclaration(local.names[0].range);
			if (!declaration) {
				throw new Error(`[Compiler] Missing bound declaration for const '${local.names[0].name}'.`);
			}
			consts.set(declaration.id, value);
		}
	}
	return consts;
};

const collectModuleExportConstValues = (
	expression: LuaExpression,
	constValuesBySymbol: ReadonlyMap<string, ConstExportValue>,
	semantics: LuaSemanticFrontendFile,
	allowBssExports: boolean,
	out: Map<string, ConstExportValue>,
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
			collectModuleExportConstValues(field.value, constValuesBySymbol, semantics, allowBssExports, out, path);
			path.pop();
		}
		return;
	}
	const value = evaluateModuleConstExportExpression(expression, constValuesBySymbol, semantics, allowBssExports);
	if (value !== undefined) {
		out.set(buildModuleExportPathKey(path), value);
	}
};

export const assertConstModuleExportsAreConstant = (
	modulePath: string,
	exportRoot: ModuleExportNode,
	exportConstValueByPathKey: ReadonlyMap<string, ConstExportValue>,
): void => {
	const visit = (node: ModuleExportNode, path: string[], visiting: WeakSet<ModuleExportNode>): void => {
		if (visiting.has(node)) {
			return;
		}
		visiting.add(node);
		for (const [key, child] of node.children) {
			path.push(key);
			if (child.children.size === 0 && !exportConstValueByPathKey.has(buildModuleExportPathKey(path))) {
				throw new Error(`[Compiler] Const module '${modulePath}' export '${buildModuleExportPathKey(path)}' is not a compile-time constant or static storage symbol.`);
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
	allowBssExports: boolean,
): Map<string, ConstExportValue> => {
	const out = new Map<string, ConstExportValue>();
	collectModuleExportConstValues(expression, collectTopLevelConstValues(chunk, semantics), semantics, allowBssExports, out, []);
	return out;
};
