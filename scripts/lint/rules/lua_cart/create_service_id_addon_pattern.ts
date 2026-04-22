import { defineLintRule } from '../../rule';
import { type LuaCallExpression } from '../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../lua_rule';
import { isGlobalCall } from '../../../../src/bmsx/lua/syntax/calls';
import { findTableFieldByKey } from './impl/support/table_fields';
import { pushIssue } from './impl/support/lint_context';

export const createServiceIdAddonPatternRule = defineLintRule('lua_cart', 'create_service_id_addon_pattern');

export function lintCreateServiceIdAddonPattern(expression: LuaCallExpression, issues: LuaLintIssue[]): void {
	if (!isGlobalCall(expression, 'create_service')) {
		return;
	}
	if (expression.arguments.length < 2) {
		return;
	}
	const addons = expression.arguments[1];
	const idField = findTableFieldByKey(addons, 'id');
	if (!idField) {
		return;
	}
	pushIssue(
		issues,
		createServiceIdAddonPatternRule.name,
		idField.value,
		'Passing "id" in create_service(...) addons is forbidden. Set the id in define_service.defaults.id.',
	);
}
