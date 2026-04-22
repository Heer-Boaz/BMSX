import { defineLintRule } from '../../rule';
import { SingleUseHasTagContext } from './impl/support/types';
import { pushIssue } from './impl/support/lint_context';
import { leaveBindingScope } from './impl/support/bindings';

export const singleUseHasTagPatternRule = defineLintRule('cart', 'single_use_has_tag_pattern');

export function leaveSingleUseHasTagScope(context: SingleUseHasTagContext): void {
	leaveBindingScope(context.scopeStack, context.bindingStacksByName, binding => {
		if (binding.pendingReadCount === 1) {
			pushIssue(
				context.issues,
				singleUseHasTagPatternRule.name,
				binding.declaration,
				`Local has_tag result "${binding.declaration.name}" is read exactly once; inline self:has_tag(...) instead of caching it.`,
			);
		}
	});
}
