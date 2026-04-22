import { type LuaExpression, type LuaIdentifierExpression, type LuaStatement, LuaSyntaxKind, LuaTableFieldKind } from '../../../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../../../lua_rule';
import { lintConstantCopyInStatements } from '../../constant_copy_pattern';
import { declareLuaBinding, discardLuaBindingScope, enterLuaBindingScope, resolveLuaBinding, setLuaBinding, isConstantSourceIdentifierName } from './bindings';
import { isConstantSourceExpression } from './expressions';
import { ConstantCopyBinding, ConstantCopyContext } from './types';

export function createConstantCopyContext(issues: LuaLintIssue[]): ConstantCopyContext {
	return {
		issues,
		bindingStacksByName: new Map<string, ConstantCopyBinding[]>(),
		scopeStack: [],
	};
}

export function enterConstantCopyScope(context: ConstantCopyContext): void {
	enterLuaBindingScope(context);
}

export function leaveConstantCopyScope(context: ConstantCopyContext): void {
	discardLuaBindingScope(context);
}

export function declareConstantCopyBinding(
	context: ConstantCopyContext,
	declaration: LuaIdentifierExpression,
	isConstantSource: boolean,
): void {
	declareLuaBinding(context, declaration, { isConstantSource });
}

export function setConstantCopyBindingByName(context: ConstantCopyContext, name: string, isConstantSource: boolean): void {
	setLuaBinding(context, name, { isConstantSource });
}

export function getConstantCopyBinding(context: ConstantCopyContext, name: string): ConstantCopyBinding | undefined {
	return resolveLuaBinding(context, name);
}

export function isForbiddenConstantCopyExpression(expression: LuaExpression, context: ConstantCopyContext): boolean {
	if (expression.kind === LuaSyntaxKind.IdentifierExpression) {
		return isConstantSourceIdentifierName(expression.name, context);
	}
	if (expression.kind === LuaSyntaxKind.MemberExpression) {
		return isConstantSourceExpression(expression.base, context);
	}
	if (expression.kind === LuaSyntaxKind.IndexExpression) {
		return isConstantSourceExpression(expression.base, context);
	}
	return false;
}

export function lintConstantCopyInExpression(expression: LuaExpression | null, context: ConstantCopyContext): void {
	if (!expression) {
		return;
	}
	switch (expression.kind) {
		case LuaSyntaxKind.MemberExpression:
			lintConstantCopyInExpression(expression.base, context);
			return;
		case LuaSyntaxKind.IndexExpression:
			lintConstantCopyInExpression(expression.base, context);
			lintConstantCopyInExpression(expression.index, context);
			return;
		case LuaSyntaxKind.BinaryExpression:
			lintConstantCopyInExpression(expression.left, context);
			lintConstantCopyInExpression(expression.right, context);
			return;
		case LuaSyntaxKind.UnaryExpression:
			lintConstantCopyInExpression(expression.operand, context);
			return;
		case LuaSyntaxKind.CallExpression:
			lintConstantCopyInExpression(expression.callee, context);
			for (const argument of expression.arguments) {
				lintConstantCopyInExpression(argument, context);
			}
			return;
		case LuaSyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				if (field.kind === LuaTableFieldKind.ExpressionKey) {
					lintConstantCopyInExpression(field.key, context);
				}
				lintConstantCopyInExpression(field.value, context);
			}
			return;
		case LuaSyntaxKind.FunctionExpression:
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

export function lintConstantCopyInAssignmentTarget(target: LuaExpression | null, context: ConstantCopyContext): void {
	if (!target) {
		return;
	}
	if (target.kind === LuaSyntaxKind.MemberExpression) {
		lintConstantCopyInExpression(target.base, context);
		return;
	}
	if (target.kind === LuaSyntaxKind.IndexExpression) {
		lintConstantCopyInExpression(target.base, context);
		lintConstantCopyInExpression(target.index, context);
	}
}

export function lintConstantCopyPattern(statements: ReadonlyArray<LuaStatement>, issues: LuaLintIssue[]): void {
	const context = createConstantCopyContext(issues);
	enterConstantCopyScope(context);
	try {
		lintConstantCopyInStatements(statements, context);
	} finally {
		leaveConstantCopyScope(context);
	}
}
