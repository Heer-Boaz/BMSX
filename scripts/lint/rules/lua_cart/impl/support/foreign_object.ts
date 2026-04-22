import { type LuaExpression as Expression, type LuaIdentifierExpression as IdentifierExpression, type LuaStatement as Statement, LuaSyntaxKind as SyntaxKind, LuaTableFieldKind as TableFieldKind } from '../../../../../../src/bmsx/lua/syntax/ast';
import { type CartLintIssue } from '../../../../lua_rule';
import { lintForeignObjectMutationInStatements } from '../../foreign_object_internal_mutation_pattern';
import { declareBinding, discardBindingScope, enterBindingScope, resolveBinding, setBinding } from './bindings';
import { isServiceResolverCallExpression } from './object_ownership';
import { ForeignObjectAliasBinding, ForeignObjectMutationContext } from './types';

export function createForeignObjectMutationContext(issues: CartLintIssue[]): ForeignObjectMutationContext {
	const context: ForeignObjectMutationContext = {
		issues,
		bindingStacksByName: new Map<string, Array<ForeignObjectAliasBinding | null>>(),
		scopeStack: [],
	};
	enterForeignObjectMutationScope(context);
	return context;
}

export function enterForeignObjectMutationScope(context: ForeignObjectMutationContext): void {
	enterBindingScope(context);
}

export function leaveForeignObjectMutationScope(context: ForeignObjectMutationContext): void {
	discardBindingScope(context);
}

export function declareForeignObjectBinding(
	context: ForeignObjectMutationContext,
	declaration: IdentifierExpression,
	binding: ForeignObjectAliasBinding | null,
): void {
	declareBinding(context, declaration, binding);
}

export function resolveForeignObjectBinding(
	context: ForeignObjectMutationContext,
	name: string,
): ForeignObjectAliasBinding | null | undefined {
	return resolveBinding(context, name);
}

export function setForeignObjectBinding(
	context: ForeignObjectMutationContext,
	name: string,
	binding: ForeignObjectAliasBinding | null,
): void {
	setBinding(context, name, binding);
}

export function isForeignObjectAliasInitializer(expression: Expression | undefined): boolean {
	return isServiceResolverCallExpression(expression);
}

export function lintForeignObjectMutationInExpression(
	expression: Expression | null,
	context: ForeignObjectMutationContext,
): void {
	if (!expression) {
		return;
	}
	switch (expression.kind) {
		case SyntaxKind.MemberExpression:
			lintForeignObjectMutationInExpression(expression.base, context);
			return;
		case SyntaxKind.IndexExpression:
			lintForeignObjectMutationInExpression(expression.base, context);
			lintForeignObjectMutationInExpression(expression.index, context);
			return;
		case SyntaxKind.BinaryExpression:
			lintForeignObjectMutationInExpression(expression.left, context);
			lintForeignObjectMutationInExpression(expression.right, context);
			return;
		case SyntaxKind.UnaryExpression:
			lintForeignObjectMutationInExpression(expression.operand, context);
			return;
		case SyntaxKind.CallExpression:
			lintForeignObjectMutationInExpression(expression.callee, context);
			for (const argument of expression.arguments) {
				lintForeignObjectMutationInExpression(argument, context);
			}
			return;
		case SyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				if (field.kind === TableFieldKind.ExpressionKey) {
					lintForeignObjectMutationInExpression(field.key, context);
				}
				lintForeignObjectMutationInExpression(field.value, context);
			}
			return;
		case SyntaxKind.FunctionExpression:
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

export function lintForeignObjectInternalMutationPattern(statements: ReadonlyArray<Statement>, issues: CartLintIssue[]): void {
	const context = createForeignObjectMutationContext(issues);
	try {
		lintForeignObjectMutationInStatements(statements, context);
	} finally {
		leaveForeignObjectMutationScope(context);
	}
}
