import { defineLintRule } from '../../rule';
import { type CartLintIssue } from '../../lua_rule';
import { pushIssueAt } from './impl/support/lint_context';

export const syntaxErrorPatternRule = defineLintRule('cart', 'syntax_error_pattern');

export type CartLintSyntaxError = {
	readonly path: string;
	readonly line: number;
	readonly column: number;
	readonly message: string;
};

export function lintSyntaxError(
	error: CartLintSyntaxError | null,
	issues: CartLintIssue[],
): boolean {
	if (!error) {
		return false;
	}
	pushIssueAt(
		issues,
		syntaxErrorPatternRule.name,
		error.path,
		error.line,
		error.column,
		error.message,
	);
	return true;
}
