import { defineLintRule } from '../../rule';
import { type LuaExpression as Expression, LuaSyntaxKind as SyntaxKind, LuaTableFieldKind as TableFieldKind } from '../../../../src/bmsx/lua/syntax/ast';
import { declareRuntimeTagLookupBinding, enterRuntimeTagLookupScope, isRuntimeTagLookupExpression, leaveRuntimeTagLookupScope, lintRuntimeTagLookupInStatements } from './impl/support/runtime_tag';
import { RuntimeTagLookupContext } from './impl/support/types';
import { pushIssue } from './impl/support/lint_context';

export const runtimeTagTableAccessPatternRule = defineLintRule('cart', 'runtime_tag_table_access_pattern');

export function lintRuntimeTagLookupInExpression(
	expression: Expression | null,
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
		case SyntaxKind.MemberExpression:
			lintRuntimeTagLookupInExpression(expression.base, context);
			return;
		case SyntaxKind.IndexExpression:
			lintRuntimeTagLookupInExpression(expression.base, context);
			lintRuntimeTagLookupInExpression(expression.index, context);
			return;
		case SyntaxKind.BinaryExpression:
			lintRuntimeTagLookupInExpression(expression.left, context);
			lintRuntimeTagLookupInExpression(expression.right, context);
			return;
		case SyntaxKind.UnaryExpression:
			lintRuntimeTagLookupInExpression(expression.operand, context);
			return;
		case SyntaxKind.CallExpression:
			lintRuntimeTagLookupInExpression(expression.callee, context);
			for (const argument of expression.arguments) {
				lintRuntimeTagLookupInExpression(argument, context);
			}
			return;
		case SyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				if (field.kind === TableFieldKind.ExpressionKey) {
					lintRuntimeTagLookupInExpression(field.key, context);
				}
				lintRuntimeTagLookupInExpression(field.value, context);
			}
			return;
		case SyntaxKind.FunctionExpression:
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
