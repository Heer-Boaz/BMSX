import { defineLintRule } from '../../rule';
import { leaveBindingScope, singleUseLocalMessage } from '../lua_cart/impl/support/bindings';
import { SingleUseLocalContext } from '../lua_cart/impl/support/types';
import { pushIssue } from '../lua_cart/impl/support/lint_context';

export const singleUseLocalPatternRule = defineLintRule('common', 'single_use_local_pattern');

export function leaveSingleUseLocalScope(context: SingleUseLocalContext): void {
	leaveBindingScope(context.scopeStack, context.bindingStacksByName, binding => {
		if (binding.reportKind !== null) {
			const shouldReport = binding.reportKind === 'small_helper'
				? binding.readCount === 1 && binding.callReadCount === 1
				: binding.readCount === 1;
			if (shouldReport) {
				pushIssue(
					context.issues,
					singleUseLocalPatternRule.name,
					binding.declaration,
					singleUseLocalMessage(binding),
				);
			}
		}
	});
}
