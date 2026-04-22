import { defineLintRule } from '../../rule';
import { type LuaLintIssue } from '../../lua_rule';
import { pushIssueAt } from './impl/support/lint_context';

export const syntaxErrorPatternRule = defineLintRule('lua_cart', 'syntax_error_pattern');

export function pushSyntaxErrorIssue(
	issues: LuaLintIssue[],
	error: { readonly path: string; readonly line: number; readonly column: number; readonly message: string; },
): void {
	pushIssueAt(
		issues,
		syntaxErrorPatternRule.name,
		error.path,
		error.line,
		error.column,
		error.message,
	);
}
