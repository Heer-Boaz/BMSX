import { defineLintRule } from '../../rule';
import { type LuaExpression as Expression, LuaSyntaxKind as SyntaxKind, LuaTableFieldKind as TableFieldKind } from '../../../../toolchain/ts/lua/syntax/ast';
import { type CartLintContext } from '../../lua_rule';
import { isStaticLookupTableConstructor } from './impl/support/table_fields';
import { pushIssue } from './impl/support/lint_context';

export const inlineStaticLookupTablePatternRule = defineLintRule('cart', 'inline_static_lookup_table_pattern');

export function lintInlineStaticLookupTableExpression(
	expression: Expression | null,
	functionName: string,
	lint: CartLintContext,
): void {
	if (!expression) {
		return;
	}
	switch (expression.kind) {
		case SyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				if (field.kind === TableFieldKind.ExpressionKey) {
					lintInlineStaticLookupTableExpression(field.key, functionName, lint);
				}
				lintInlineStaticLookupTableExpression(field.value, functionName, lint);
			}
			return;
		case SyntaxKind.MemberExpression:
			lintInlineStaticLookupTableExpression(expression.base, functionName, lint);
			return;
		case SyntaxKind.IndexExpression:
			if (isStaticLookupTableConstructor(expression.base)) {
				pushIssue(
					lint,
					inlineStaticLookupTablePatternRule.name,
					expression.base,
					`Inline static lookup table expression inside function is forbidden (in "${functionName}"). Hoist static lookup tables to file scope.`,
				);
			} else {
				lintInlineStaticLookupTableExpression(expression.base, functionName, lint);
			}
			lintInlineStaticLookupTableExpression(expression.index, functionName, lint);
			return;
		case SyntaxKind.BinaryExpression:
			lintInlineStaticLookupTableExpression(expression.left, functionName, lint);
			lintInlineStaticLookupTableExpression(expression.right, functionName, lint);
			return;
		case SyntaxKind.UnaryExpression:
			lintInlineStaticLookupTableExpression(expression.operand, functionName, lint);
			return;
		case SyntaxKind.CallExpression:
			lintInlineStaticLookupTableExpression(expression.callee, functionName, lint);
			for (const argument of expression.arguments) {
				lintInlineStaticLookupTableExpression(argument, functionName, lint);
			}
			return;
		case SyntaxKind.FunctionExpression:
			// Nested function bodies are linted separately by lintFunctionBody/lintStatements.
			return;
		default:
			return;
	}
}
