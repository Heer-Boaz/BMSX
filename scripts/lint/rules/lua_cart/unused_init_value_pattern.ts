import { defineLintRule } from '../../rule';
import { type LuaIdentifierExpression as IdentifierExpression } from '../../../../src/bmsx/lua/syntax/ast';
import { UnusedInitValueContext } from './impl/support/types';
import { resolveUnusedInitValueBinding } from './impl/support/unused_init';
import { pushIssue } from './impl/support/lint_context';

export const unusedInitValuePatternRule = defineLintRule('cart', 'unused_init_value_pattern');

export function markUnusedInitValueWrite(
	context: UnusedInitValueContext,
	identifier: IdentifierExpression,
	isGuaranteedWrite: boolean,
): void {
	if (!isGuaranteedWrite) {
		return;
	}
	const binding = resolveUnusedInitValueBinding(context, identifier.name);
	if (!binding || !binding.pendingInitValue) {
		return;
	}
	pushIssue(
		context.issues,
		unusedInitValuePatternRule.name,
		binding.declaration,
		`Unused initial value is forbidden ("${binding.declaration.name}"). Remove the initializer and assign only when the value is actually known.`,
	);
	binding.pendingInitValue = false;
}
