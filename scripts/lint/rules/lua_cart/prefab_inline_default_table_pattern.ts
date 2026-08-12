import { defineLintRule } from '../../rule';
import { type LuaCallExpression as CallExpression, LuaSyntaxKind as SyntaxKind } from '../../../../toolchain/ts/lua/syntax/ast';
import { type CartLintIssue } from '../../lua_rule';
import { findTableFieldByKey } from './impl/support/table_fields';
import { pushIssue } from './impl/support/lint_context';
import { CART_MODULE_CALL_PREFAB_DEFINE, type CartModuleCallKind } from './impl/support/types';

export const prefabInlineDefaultTablePatternRule = defineLintRule('cart', 'prefab_inline_default_table_pattern');

export function lintPrefabInlineDefaultTablePattern(
	expression: CallExpression,
	callKind: CartModuleCallKind | undefined,
	issues: CartLintIssue[],
): void {
	if (callKind !== CART_MODULE_CALL_PREFAB_DEFINE) {
		return;
	}
	const defaults = findTableFieldByKey(expression.arguments[0], 'defaults')?.value;
	if (!defaults || defaults.kind !== SyntaxKind.TableConstructorExpression) {
		return;
	}
	for (const field of defaults.fields) {
		if (field.value.kind === SyntaxKind.TableConstructorExpression) {
			pushIssue(
				issues,
				prefabInlineDefaultTablePatternRule.name,
				field.value,
				'prefab.define: inline table defaults are shared by every instance. Initialize mutable tables in the object ctor; reference a named table only when sharing is intentional.',
			);
		}
	}
}
