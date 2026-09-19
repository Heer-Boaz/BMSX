import { defineLintRule } from '../../rule';
import { type LuaTableField as TableField } from '../../../../toolchain/ts/lua/syntax/ast';
import { type CartLintContext } from '../../lua_rule';
import { getTableFieldKey } from './impl/support/table_fields';
import { pushIssue } from './impl/support/lint_context';

export const defineFactorySpaceIdPatternRule = defineLintRule('cart', 'define_factory_space_id_pattern');

export function lintDefineFactorySpaceIdPattern(factoryName: string, field: TableField, lint: CartLintContext): void {
	if (getTableFieldKey(field) !== 'space_id') {
		return;
	}
	pushIssue(
		lint,
		defineFactorySpaceIdPatternRule.name,
		field.value,
		`${factoryName}: space_id is forbidden. Object space must be assigned at world:spawn(..., { space_id = ... }).`,
	);
}
