import { defineLintRule } from '../../rule';
import { SingleUseHasTagContext } from './impl/support/types';
import { pushIssue } from './impl/support/lint_context';

export const singleUseHasTagPatternRule = defineLintRule('lua_cart', 'single_use_has_tag_pattern');

export function leaveSingleUseHasTagScope(context: SingleUseHasTagContext): void {
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
		if (binding && binding.pendingReadCount === 1) {
			pushIssue(
				context.issues,
				singleUseHasTagPatternRule.name,
				binding.declaration,
				`Local has_tag result "${binding.declaration.name}" is read exactly once; inline self:has_tag(...) instead of caching it.`,
			);
		}
		if (stack.length === 0) {
			context.bindingStacksByName.delete(name);
		}
	}
}
