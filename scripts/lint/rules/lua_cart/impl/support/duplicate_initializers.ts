import { type LuaExpression, type LuaIdentifierExpression, type LuaStatement, LuaSyntaxKind, LuaTableFieldKind } from '../../../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../../../lua_rule';
import { lintDuplicateInitializerInStatements } from '../../duplicate_initializer_pattern';
import { declareLuaBinding, discardLuaBindingScope, enterLuaBindingScope, resolveLuaBinding } from './bindings';
import { DuplicateInitializerBinding, DuplicateInitializerContext } from './types';

export function createDuplicateInitializerContext(issues: LuaLintIssue[]): DuplicateInitializerContext {
	const context: DuplicateInitializerContext = {
		issues,
		bindingStacksByName: new Map<string, DuplicateInitializerBinding[]>(),
		scopeStack: [],
	};
	enterDuplicateInitializerScope(context);
	return context;
}

export function resolveDuplicateInitializerBinding(context: DuplicateInitializerContext, name: string): DuplicateInitializerBinding | undefined {
	return resolveLuaBinding(context, name);
}

export function enterDuplicateInitializerScope(context: DuplicateInitializerContext): void {
	enterLuaBindingScope(context);
}

export function leaveDuplicateInitializerScope(context: DuplicateInitializerContext): void {
	discardLuaBindingScope(context);
}

export function declareDuplicateInitializerBinding(
	context: DuplicateInitializerContext,
	declaration: LuaIdentifierExpression,
	initializerSignature: string,
): void {
	declareLuaBinding(context, declaration, {
		declaration,
		initializerSignature,
	});
}

export function lintDuplicateInitializerInExpression(expression: LuaExpression | null, context: DuplicateInitializerContext): void {
	if (!expression) {
		return;
	}
	switch (expression.kind) {
		case LuaSyntaxKind.MemberExpression:
			lintDuplicateInitializerInExpression(expression.base, context);
			return;
		case LuaSyntaxKind.IndexExpression:
			lintDuplicateInitializerInExpression(expression.base, context);
			lintDuplicateInitializerInExpression(expression.index, context);
			return;
		case LuaSyntaxKind.BinaryExpression:
			lintDuplicateInitializerInExpression(expression.left, context);
			lintDuplicateInitializerInExpression(expression.right, context);
			return;
		case LuaSyntaxKind.UnaryExpression:
			lintDuplicateInitializerInExpression(expression.operand, context);
			return;
		case LuaSyntaxKind.CallExpression:
			lintDuplicateInitializerInExpression(expression.callee, context);
			for (const argument of expression.arguments) {
				lintDuplicateInitializerInExpression(argument, context);
			}
			return;
		case LuaSyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				if (field.kind === LuaTableFieldKind.ExpressionKey) {
					lintDuplicateInitializerInExpression(field.key, context);
				}
				lintDuplicateInitializerInExpression(field.value, context);
			}
			return;
		case LuaSyntaxKind.FunctionExpression:
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

export function lintDuplicateInitializerPattern(statements: ReadonlyArray<LuaStatement>, issues: LuaLintIssue[]): void {
	const context = createDuplicateInitializerContext(issues);
	try {
		lintDuplicateInitializerInStatements(statements, context);
	} finally {
		leaveDuplicateInitializerScope(context);
	}
}
