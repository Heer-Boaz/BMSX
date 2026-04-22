import { type LuaExpression as Expression, type LuaIdentifierExpression as IdentifierExpression, type LuaStatement as Statement, LuaSyntaxKind as SyntaxKind, LuaTableFieldKind as TableFieldKind } from '../../../../../../src/bmsx/lua/syntax/ast';
import { type CartLintIssue } from '../../../../lua_rule';
import { lintConstantCopyInStatements } from '../../constant_copy_pattern';
import { declareBinding, discardBindingScope, enterBindingScope, resolveBinding, setBinding } from './bindings';
import { isConstantBindingPathExpression, isConstantSourceExpression } from './expressions';
import { ConstantCopyBinding, ConstantCopyContext } from './types';

export function createConstantCopyContext(issues: CartLintIssue[]): ConstantCopyContext {
	return {
		issues,
		bindingStacksByName: new Map<string, ConstantCopyBinding[]>(),
		scopeStack: [],
	};
}

export function enterConstantCopyScope(context: ConstantCopyContext): void {
	enterBindingScope(context);
}

export function leaveConstantCopyScope(context: ConstantCopyContext): void {
	discardBindingScope(context);
}

export function declareConstantCopyBinding(
	context: ConstantCopyContext,
	declaration: IdentifierExpression,
	isConstantSource: boolean,
): void {
	declareBinding(context, declaration, { isConstantSource });
}

export function setConstantCopyBindingByName(context: ConstantCopyContext, name: string, isConstantSource: boolean): void {
	setBinding(context, name, { isConstantSource });
}

export function getConstantCopyBinding(context: ConstantCopyContext, name: string): ConstantCopyBinding | undefined {
	return resolveBinding(context, name);
}

export function isForbiddenConstantCopyExpression(expression: Expression, context: ConstantCopyContext): boolean {
	return isConstantBindingPathExpression(expression, context);
}

export function lintConstantCopyInExpression(expression: Expression | null, context: ConstantCopyContext): void {
	if (!expression) {
		return;
	}
	switch (expression.kind) {
		case SyntaxKind.MemberExpression:
			lintConstantCopyInExpression(expression.base, context);
			return;
		case SyntaxKind.IndexExpression:
			lintConstantCopyInExpression(expression.base, context);
			lintConstantCopyInExpression(expression.index, context);
			return;
		case SyntaxKind.BinaryExpression:
			lintConstantCopyInExpression(expression.left, context);
			lintConstantCopyInExpression(expression.right, context);
			return;
		case SyntaxKind.UnaryExpression:
			lintConstantCopyInExpression(expression.operand, context);
			return;
		case SyntaxKind.CallExpression:
			lintConstantCopyInExpression(expression.callee, context);
			for (const argument of expression.arguments) {
				lintConstantCopyInExpression(argument, context);
			}
			return;
		case SyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				if (field.kind === TableFieldKind.ExpressionKey) {
					lintConstantCopyInExpression(field.key, context);
				}
				lintConstantCopyInExpression(field.value, context);
			}
			return;
		case SyntaxKind.FunctionExpression:
			enterConstantCopyScope(context);
			for (const parameter of expression.parameters) {
				declareConstantCopyBinding(context, parameter, false);
			}
			lintConstantCopyInStatements(expression.body.body, context);
			leaveConstantCopyScope(context);
			return;
		default:
			return;
	}
}

export function lintConstantCopyInAssignmentTarget(target: Expression | null, context: ConstantCopyContext): void {
	if (!target) {
		return;
	}
	if (target.kind === SyntaxKind.MemberExpression) {
		lintConstantCopyInExpression(target.base, context);
		return;
	}
	if (target.kind === SyntaxKind.IndexExpression) {
		lintConstantCopyInExpression(target.base, context);
		lintConstantCopyInExpression(target.index, context);
	}
}

export function lintConstantCopyPattern(statements: ReadonlyArray<Statement>, issues: CartLintIssue[]): void {
	const context = createConstantCopyContext(issues);
	enterConstantCopyScope(context);
	try {
		lintConstantCopyInStatements(statements, context);
	} finally {
		leaveConstantCopyScope(context);
	}
}
