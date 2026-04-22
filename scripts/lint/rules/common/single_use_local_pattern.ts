import { defineLintRule } from '../../rule';
import { singleUseLocalMessage } from '../lua_cart/impl/support/bindings';
import { SingleUseLocalContext } from '../lua_cart/impl/support/types';
import { pushIssue } from '../lua_cart/impl/support/lint_context';

export const singleUseLocalPatternRule = defineLintRule('common', 'single_use_local_pattern');

export function leaveSingleUseLocalScope(context: SingleUseLocalContext): void {
	const scope = context.scopeStack.pop();
	if (!scope) {
		return;
	}
	for (let index = scope.names.length - 1; index >= 0; index -= 1) {
		const name = scope.names[index];
		const stack = context.bindingStacksByName.get(name);
		if (!stack || stack.length === 0) {
			continue;
		}
		const binding = stack.pop();
		if (binding && binding.reportKind !== null) {
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
		if (stack.length === 0) {
			context.bindingStacksByName.delete(name);
		}
	}
}
