import { defineLintRule } from '../../rule';
import { type LuaExpression, LuaSyntaxKind, LuaTableFieldKind } from '../../../../src/bmsx/lua/syntax/ast';
import { declareRuntimeTagLookupBinding, enterRuntimeTagLookupScope, isRuntimeTagLookupExpression, leaveRuntimeTagLookupScope, lintRuntimeTagLookupInStatements } from './impl/support/runtime_tag';
import { RuntimeTagLookupContext } from './impl/support/types';
import { pushIssue } from './impl/support/lint_context';

export const runtimeTagTableAccessPatternRule = defineLintRule('lua_cart', 'runtime_tag_table_access_pattern');

export function lintRuntimeTagLookupInExpression(
	expression: LuaExpression | null,
	context: RuntimeTagLookupContext,
): void {
	if (!expression) {
		return;
	}
	if (isRuntimeTagLookupExpression(expression, context)) {
		pushIssue(
			context.issues,
			runtimeTagTableAccessPatternRule.name,
			expression,
			'Direct runtime .tags access is forbidden. Use :has_tag(...) and derived/group tags instead of reading internal tag tables to bypass linting.',
		);
	}
	switch (expression.kind) {
		case LuaSyntaxKind.MemberExpression:
			lintRuntimeTagLookupInExpression(expression.base, context);
			return;
		case LuaSyntaxKind.IndexExpression:
			lintRuntimeTagLookupInExpression(expression.base, context);
			lintRuntimeTagLookupInExpression(expression.index, context);
			return;
		case LuaSyntaxKind.BinaryExpression:
			lintRuntimeTagLookupInExpression(expression.left, context);
			lintRuntimeTagLookupInExpression(expression.right, context);
			return;
		case LuaSyntaxKind.UnaryExpression:
			lintRuntimeTagLookupInExpression(expression.operand, context);
			return;
		case LuaSyntaxKind.CallExpression:
			lintRuntimeTagLookupInExpression(expression.callee, context);
			for (const argument of expression.arguments) {
				lintRuntimeTagLookupInExpression(argument, context);
			}
			return;
		case LuaSyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				if (field.kind === LuaTableFieldKind.ExpressionKey) {
					lintRuntimeTagLookupInExpression(field.key, context);
				}
				lintRuntimeTagLookupInExpression(field.value, context);
			}
			return;
		case LuaSyntaxKind.FunctionExpression:
			enterRuntimeTagLookupScope(context);
			for (const parameter of expression.parameters) {
				declareRuntimeTagLookupBinding(context, parameter, null);
			}
			lintRuntimeTagLookupInStatements(expression.body.body, context);
			leaveRuntimeTagLookupScope(context);
			return;
		default:
			return;
	}
}
