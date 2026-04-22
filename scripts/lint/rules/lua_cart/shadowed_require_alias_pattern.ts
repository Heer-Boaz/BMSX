import { defineLintRule } from '../../rule';
import { type LuaIdentifierExpression } from '../../../../src/bmsx/lua/syntax/ast';
import { ShadowedRequireAliasContext } from './impl/support/types';
import { pushIssue } from './impl/support/lint_context';

export const shadowedRequireAliasPatternRule = defineLintRule('lua_cart', 'shadowed_require_alias_pattern');

export function declareShadowedRequireAliasBinding(
	context: ShadowedRequireAliasContext,
	declaration: LuaIdentifierExpression,
	requiredModulePath: string | null,
): void {
	const name = declaration.name;
	if (name !== '_') {
		const stack = context.bindingStacksByName.get(name);
		if (stack) {
			for (let index = stack.length - 1; index >= 0; index -= 1) {
				const outer = stack[index];
				if (outer.requiredModulePath !== null) {
					pushIssue(
						context.issues,
						shadowedRequireAliasPatternRule.name,
						declaration,
						`Local "${name}" shadows outer module alias from require('${outer.requiredModulePath}'). Rename the local; do not shadow imported module aliases.`,
					);
					break;
				}
			}
		}
	}
	const scope = context.scopeStack[context.scopeStack.length - 1];
	scope.names.push(name);
	let stack = context.bindingStacksByName.get(name);
	if (!stack) {
		stack = [];
		context.bindingStacksByName.set(name, stack);
	}
	stack.push({
		declaration,
		requiredModulePath,
	});
}
