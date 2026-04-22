import { type LuaExpression as Expression, type LuaIdentifierExpression as IdentifierExpression, type LuaStatement as Statement, LuaSyntaxKind as SyntaxKind, LuaTableFieldKind as TableFieldKind } from '../../../../../../src/bmsx/lua/syntax/ast';
import { type CartLintIssue } from '../../../../lua_rule';
import { lintDuplicateInitializerInStatements } from '../../duplicate_initializer_pattern';
import { declareBinding, discardBindingScope, enterBindingScope, resolveBinding } from './bindings';
import { DuplicateInitializerBinding, DuplicateInitializerContext } from './types';

export function createDuplicateInitializerContext(issues: CartLintIssue[]): DuplicateInitializerContext {
	const context: DuplicateInitializerContext = {
		issues,
		bindingStacksByName: new Map<string, DuplicateInitializerBinding[]>(),
		scopeStack: [],
	};
	enterDuplicateInitializerScope(context);
	return context;
}

export function resolveDuplicateInitializerBinding(context: DuplicateInitializerContext, name: string): DuplicateInitializerBinding | undefined {
	return resolveBinding(context, name);
}

export function enterDuplicateInitializerScope(context: DuplicateInitializerContext): void {
	enterBindingScope(context);
}

export function leaveDuplicateInitializerScope(context: DuplicateInitializerContext): void {
	discardBindingScope(context);
}

export function declareDuplicateInitializerBinding(
	context: DuplicateInitializerContext,
	declaration: IdentifierExpression,
	initializerSignature: string,
): void {
	declareBinding(context, declaration, {
		declaration,
		initializerSignature,
	});
}

export function lintDuplicateInitializerInExpression(expression: Expression | null, context: DuplicateInitializerContext): void {
	if (!expression) {
		return;
	}
	switch (expression.kind) {
		case SyntaxKind.MemberExpression:
			lintDuplicateInitializerInExpression(expression.base, context);
			return;
		case SyntaxKind.IndexExpression:
			lintDuplicateInitializerInExpression(expression.base, context);
			lintDuplicateInitializerInExpression(expression.index, context);
			return;
		case SyntaxKind.BinaryExpression:
			lintDuplicateInitializerInExpression(expression.left, context);
			lintDuplicateInitializerInExpression(expression.right, context);
			return;
		case SyntaxKind.UnaryExpression:
			lintDuplicateInitializerInExpression(expression.operand, context);
			return;
		case SyntaxKind.CallExpression:
			lintDuplicateInitializerInExpression(expression.callee, context);
			for (const argument of expression.arguments) {
				lintDuplicateInitializerInExpression(argument, context);
			}
			return;
		case SyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				if (field.kind === TableFieldKind.ExpressionKey) {
					lintDuplicateInitializerInExpression(field.key, context);
				}
				lintDuplicateInitializerInExpression(field.value, context);
			}
			return;
		case SyntaxKind.FunctionExpression:
			enterDuplicateInitializerScope(context);
			for (const parameter of expression.parameters) {
				declareDuplicateInitializerBinding(context, parameter, '');
			}
			lintDuplicateInitializerInStatements(expression.body.body, context);
			leaveDuplicateInitializerScope(context);
			return;
		default:
			return;
	}
}

export function lintDuplicateInitializerPattern(statements: ReadonlyArray<Statement>, issues: CartLintIssue[]): void {
	const context = createDuplicateInitializerContext(issues);
	try {
		lintDuplicateInitializerInStatements(statements, context);
	} finally {
		leaveDuplicateInitializerScope(context);
	}
}
