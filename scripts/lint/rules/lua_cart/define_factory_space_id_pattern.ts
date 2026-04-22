import { defineLintRule } from '../../rule';
import { type LuaTableField } from '../../../../src/bmsx/lua/syntax/ast';
import { type LuaLintIssue } from '../../lua_rule';
import { getTableFieldKey } from './impl/support/table_fields';
import { pushIssue } from './impl/support/lint_context';

export const defineFactorySpaceIdPatternRule = defineLintRule('lua_cart', 'define_factory_space_id_pattern');

export function lintDefineFactorySpaceIdPattern(factoryName: string, field: LuaTableField, issues: LuaLintIssue[]): void {
	if (getTableFieldKey(field) !== 'space_id') {
		return;
	}
	pushIssue(
		issues,
		defineFactorySpaceIdPatternRule.name,
		field.value,
		`${factoryName}: space_id is forbidden. Services must not carry space_id, and prefab/object space must be assigned at inst(..., { space_id = ... }).`,
	);
}
