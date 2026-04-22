import { type LuaExpression, type LuaIdentifierExpression, type LuaStatement, LuaSyntaxKind, LuaTableFieldKind } from '../../../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../../../lua_rule';
import { lintForeignObjectMutationInStatements } from '../../foreign_object_internal_mutation_pattern';
import { declareLuaBinding, discardLuaBindingScope, enterLuaBindingScope, resolveLuaBinding, setLuaBinding } from './bindings';
import { isServiceResolverCallExpression } from './object_ownership';
import { ForeignObjectAliasBinding, ForeignObjectMutationContext } from './types';

export function createForeignObjectMutationContext(issues: LuaLintIssue[]): ForeignObjectMutationContext {
	const context: ForeignObjectMutationContext = {
		issues,
		bindingStacksByName: new Map<string, Array<ForeignObjectAliasBinding | null>>(),
		scopeStack: [],
	};
	enterForeignObjectMutationScope(context);
	return context;
}

export function enterForeignObjectMutationScope(context: ForeignObjectMutationContext): void {
	enterLuaBindingScope(context);
}

export function leaveForeignObjectMutationScope(context: ForeignObjectMutationContext): void {
	discardLuaBindingScope(context);
}

export function declareForeignObjectBinding(
	context: ForeignObjectMutationContext,
	declaration: LuaIdentifierExpression,
	binding: ForeignObjectAliasBinding | null,
): void {
	declareLuaBinding(context, declaration, binding);
}

export function resolveForeignObjectBinding(
	context: ForeignObjectMutationContext,
	name: string,
): ForeignObjectAliasBinding | null | undefined {
	return resolveLuaBinding(context, name);
}

export function setForeignObjectBinding(
	context: ForeignObjectMutationContext,
	name: string,
	binding: ForeignObjectAliasBinding | null,
): void {
	setLuaBinding(context, name, binding);
}

export function isForeignObjectAliasInitializer(expression: LuaExpression | undefined): boolean {
	return isServiceResolverCallExpression(expression);
}

export function lintForeignObjectMutationInExpression(
	expression: LuaExpression | null,
	context: ForeignObjectMutationContext,
): void {
	if (!expression) {
		return;
	}
	switch (expression.kind) {
		case LuaSyntaxKind.MemberExpression:
			lintForeignObjectMutationInExpression(expression.base, context);
			return;
		case LuaSyntaxKind.IndexExpression:
			lintForeignObjectMutationInExpression(expression.base, context);
			lintForeignObjectMutationInExpression(expression.index, context);
			return;
		case LuaSyntaxKind.BinaryExpression:
			lintForeignObjectMutationInExpression(expression.left, context);
			lintForeignObjectMutationInExpression(expression.right, context);
			return;
		case LuaSyntaxKind.UnaryExpression:
			lintForeignObjectMutationInExpression(expression.operand, context);
			return;
		case LuaSyntaxKind.CallExpression:
			lintForeignObjectMutationInExpression(expression.callee, context);
			for (const argument of expression.arguments) {
				lintForeignObjectMutationInExpression(argument, context);
			}
			return;
		case LuaSyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				if (field.kind === LuaTableFieldKind.ExpressionKey) {
					lintForeignObjectMutationInExpression(field.key, context);
				}
				lintForeignObjectMutationInExpression(field.value, context);
			}
			return;
		case LuaSyntaxKind.FunctionExpression:
			enterForeignObjectMutationScope(context);
			for (const parameter of expression.parameters) {
				declareForeignObjectBinding(context, parameter, null);
			}
			lintForeignObjectMutationInStatements(expression.body.body, context);
			leaveForeignObjectMutationScope(context);
			return;
		default:
			return;
	}
}

export function lintForeignObjectInternalMutationPattern(statements: ReadonlyArray<LuaStatement>, issues: LuaLintIssue[]): void {
	const context = createForeignObjectMutationContext(issues);
	try {
		lintForeignObjectMutationInStatements(statements, context);
	} finally {
		leaveForeignObjectMutationScope(context);
	}
}
