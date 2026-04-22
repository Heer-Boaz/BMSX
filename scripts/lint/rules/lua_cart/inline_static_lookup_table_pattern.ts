import { defineLintRule } from '../../rule';
import { type LuaExpression, LuaSyntaxKind, LuaTableFieldKind } from '../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../lua_rule';
import { isStaticLookupTableConstructor } from './impl/support/table_fields';
import { pushIssue } from './impl/support/lint_context';

export const inlineStaticLookupTablePatternRule = defineLintRule('lua_cart', 'inline_static_lookup_table_pattern');

export function lintInlineStaticLookupTableExpression(
	expression: LuaExpression | null,
	functionName: string,
	issues: LuaLintIssue[],
): void {
	if (!expression) {
		return;
	}
	switch (expression.kind) {
		case LuaSyntaxKind.TableConstructorExpression:
			for (const field of expression.fields) {
				if (field.kind === LuaTableFieldKind.ExpressionKey) {
					lintInlineStaticLookupTableExpression(field.key, functionName, issues);
				}
				lintInlineStaticLookupTableExpression(field.value, functionName, issues);
			}
			return;
		case LuaSyntaxKind.MemberExpression:
			lintInlineStaticLookupTableExpression(expression.base, functionName, issues);
			return;
		case LuaSyntaxKind.IndexExpression:
			if (isStaticLookupTableConstructor(expression.base)) {
				pushIssue(
					issues,
					inlineStaticLookupTablePatternRule.name,
					expression.base,
					`Inline static lookup table expression inside function is forbidden (in "${functionName}"). Hoist static lookup tables to file scope.`,
				);
			} else {
				lintInlineStaticLookupTableExpression(expression.base, functionName, issues);
			}
			lintInlineStaticLookupTableExpression(expression.index, functionName, issues);
			return;
		case LuaSyntaxKind.BinaryExpression:
			lintInlineStaticLookupTableExpression(expression.left, functionName, issues);
			lintInlineStaticLookupTableExpression(expression.right, functionName, issues);
			return;
		case LuaSyntaxKind.UnaryExpression:
			lintInlineStaticLookupTableExpression(expression.operand, functionName, issues);
			return;
		case LuaSyntaxKind.CallExpression:
			lintInlineStaticLookupTableExpression(expression.callee, functionName, issues);
			for (const argument of expression.arguments) {
				lintInlineStaticLookupTableExpression(argument, functionName, issues);
			}
			return;
		case LuaSyntaxKind.FunctionExpression:
			// Nested function bodies are linted separately by lintFunctionBody/lintStatements.
			return;
		default:
			return;
	}
}
