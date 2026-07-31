import { defineLintRule } from '../../rule';
import { type LuaCallExpression as CallExpression, LuaSyntaxKind as SyntaxKind } from '../../../../toolchain/ts/lua/syntax/ast';
import { type CartLintIssue } from '../../lua_rule';
import { lintDefineFactorySpaceIdPattern } from './define_factory_space_id_pattern';
import { getTableFieldKey, visitTableFieldsRecursively } from './impl/support/table_fields';
import { pushIssue } from './impl/support/lint_context';
import { CART_MODULE_CALL_PREFAB_DEFINE, type CartModuleCallKind } from './impl/support/types';

export const defineFactoryTickEnabledPatternRule = defineLintRule('cart', 'define_factory_tick_enabled_pattern');

export function lintDefineFactoryTickEnabledAndSpaceIdPattern(
	expression: CallExpression,
	callKind: CartModuleCallKind | undefined,
	issues: CartLintIssue[],
): void {
	if (callKind !== CART_MODULE_CALL_PREFAB_DEFINE) {
		return;
	}
	const definition = expression.arguments[0];
	visitTableFieldsRecursively(definition, (field) => {
		const key = getTableFieldKey(field);
		if (key === 'tick_enabled' && field.value.kind === SyntaxKind.BooleanLiteralExpression) {
			pushIssue(
				issues,
				defineFactoryTickEnabledPatternRule.name,
				field.value,
				'prefab.define: tick_enabled=true/false is forbidden. Remove it: true is redundant (default), and false is ineffective because ticking is enabled on activate.',
			);
			return;
		}
		lintDefineFactorySpaceIdPattern('prefab.define', field, issues);
	});
}
