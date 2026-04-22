import { defineLintRule } from '../../rule';
import { type LuaLocalAssignmentStatement as LocalAssignmentStatement } from '../../../../src/bmsx/lua/syntax/ast';
import { type CartLintIssue } from '../../lua_rule';
import { isStateLikeAliasName } from './impl/support/general';
import { getSelfPropertyNameFromAliasExpression } from './impl/support/self_properties';
import { pushIssue } from './impl/support/lint_context';

export const selfPropertyLocalAliasPatternRule = defineLintRule('cart', 'self_property_local_alias_pattern');

export function lintLocalAssignment(statement: LocalAssignmentStatement, issues: CartLintIssue[]): void {
	const valueCount = Math.min(statement.names.length, statement.values.length);
	for (let index = 0; index < valueCount; index += 1) {
		const value = statement.values[index];
		const localName = statement.names[index].name;
		const selfPropertyName = getSelfPropertyNameFromAliasExpression(value);
		if (localName !== '_' && selfPropertyName && (isStateLikeAliasName(localName) || isStateLikeAliasName(selfPropertyName))) {
			pushIssue(
				issues,
				selfPropertyLocalAliasPatternRule.name,
				statement.names[index],
				`Local alias of self state-data is forbidden (${localName}). Read state values directly from self instead of caching them in locals.`,
			);
		}
	}
}
