import { defineLintRule } from '../../rule';
import { type LuaCallExpression as CallExpression, LuaSyntaxKind as SyntaxKind } from '../../../../src/bmsx/lua/syntax/ast';
import { type CartLintIssue } from '../../lua_rule';
import { lintDefineFactorySpaceIdPattern } from './define_factory_space_id_pattern';
import { isGlobalCall } from '../../../../src/bmsx/lua/syntax/calls';
import { getTableFieldKey, visitTableFieldsRecursively } from './impl/support/table_fields';
import { pushIssue } from './impl/support/lint_context';

export const defineFactoryTickEnabledPatternRule = defineLintRule('cart', 'define_factory_tick_enabled_pattern');

export function lintDefineFactoryTickEnabledAndSpaceIdPattern(expression: CallExpression, issues: CartLintIssue[]): void {
	let factoryName: string | undefined;
	if (isGlobalCall(expression, 'define_service')) {
		factoryName = 'define_service';
	} else if (isGlobalCall(expression, 'define_prefab')) {
		factoryName = 'define_prefab';
	}
	if (!factoryName) {
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
				`${factoryName}: tick_enabled=true/false is forbidden. Remove it: true is redundant (default), and false is ineffective because ticking is enabled on activate.`,
			);
			return;
		}
		lintDefineFactorySpaceIdPattern(factoryName, field, issues);
	});
}
