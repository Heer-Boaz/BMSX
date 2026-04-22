import { defineLintRule } from '../../rule';
import { type LuaIdentifierExpression as IdentifierExpression } from '../../../../src/bmsx/lua/syntax/ast';
import { ShadowedRequireAliasContext } from './impl/support/types';
import { pushIssue } from './impl/support/lint_context';
import { declareBinding } from './impl/support/bindings';

export const shadowedRequireAliasPatternRule = defineLintRule('cart', 'shadowed_require_alias_pattern');

export function declareShadowedRequireAliasBinding(
	context: ShadowedRequireAliasContext,
	declaration: IdentifierExpression,
	requiredModulePath: string | undefined,
): void {
	const name = declaration.name;
	if (name !== '_') {
		const stack = context.bindingStacksByName.get(name);
		if (stack) {
			for (let index = stack.length - 1; index >= 0; index -= 1) {
				const outer = stack[index];
				if (outer.requiredModulePath !== undefined) {
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
	declareBinding(context, declaration, {
		declaration,
		requiredModulePath,
	});
}
