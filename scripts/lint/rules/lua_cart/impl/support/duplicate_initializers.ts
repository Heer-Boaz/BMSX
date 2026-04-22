import { type LuaExpression, type LuaIdentifierExpression, type LuaStatement, LuaSyntaxKind, LuaTableFieldKind } from '../../../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../../../lua_rule';
import { lintDuplicateInitializerInStatements } from '../../duplicate_initializer_pattern';
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

export function resolveDuplicateInitializerBinding(context: DuplicateInitializerContext, name: string): DuplicateInitializerBinding {
	const stack = context.bindingStacksByName.get(name);
	if (!stack || stack.length === 0) {
		return undefined;
	}
	return stack[stack.length - 1];
}

export function enterDuplicateInitializerScope(context: DuplicateInitializerContext): void {
	context.scopeStack.push({ names: [] });
}

export function leaveDuplicateInitializerScope(context: DuplicateInitializerContext): void {
	const scope = context.scopeStack.pop();
	if (!scope) {
		return;
	}
	for (const name of scope.names) {
		const stack = context.bindingStacksByName.get(name);
		if (!stack || stack.length === 0) {
			continue;
		}
		stack.pop();
		if (stack.length === 0) {
			context.bindingStacksByName.delete(name);
		}
	}
}

export function declareDuplicateInitializerBinding(
	context: DuplicateInitializerContext,
	declaration: LuaIdentifierExpression,
	initializerSignature: string,
): void {
	const scope = context.scopeStack[context.scopeStack.length - 1];
	scope.names.push(declaration.name);
	let stack = context.bindingStacksByName.get(declaration.name);
	if (!stack) {
		stack = [];
		context.bindingStacksByName.set(declaration.name, stack);
	}
	stack.push({
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
