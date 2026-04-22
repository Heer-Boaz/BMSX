import { defineLintRule } from '../../rule';
import { type LuaCallExpression, LuaSyntaxKind } from '../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../lua_rule';
import { lintDefineFactorySpaceIdPattern } from './define_factory_space_id_pattern';
import { isGlobalCall } from './impl/support/calls';
import { getTableFieldKey, visitTableFieldsRecursively } from './impl/support/table_fields';
import { pushIssue } from './impl/support/lint_context';

export const defineFactoryTickEnabledPatternRule = defineLintRule('lua_cart', 'define_factory_tick_enabled_pattern');

export function lintDefineFactoryTickEnabledAndSpaceIdPattern(expression: LuaCallExpression, issues: LuaLintIssue[]): void {
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
		if (key === 'tick_enabled' && field.value.kind === LuaSyntaxKind.BooleanLiteralExpression) {
			pushIssue(
				issues,
				defineFactoryTickEnabledPatternRule.name,
				field.value,
				`${factoryName}: tick_enabled=true/false is forbidden. Remove it: true is redundant (default), and false is ineffective because ticking is enabled on activate.`,
			);
			return;
		}
		if (key !== 'space_id') {
			return;
		}
		lintDefineFactorySpaceIdPattern(factoryName, field.value, issues);
	});
}
