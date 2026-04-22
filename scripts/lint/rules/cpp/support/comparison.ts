import type { Token } from '../../../../../src/bmsx/language/cpp/syntax/tokens';
import { pushTokenLintIssue, type LintIssue } from './diagnostics';

export function lintAdjacentEqualityComparison(
	file: string,
	tokens: readonly Token[],
	issues: LintIssue[],
	rule: string,
	message: string,
	matches: (left: Token, right: Token) => boolean,
): void {
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (token.text !== '==' && token.text !== '!=') {
			continue;
		}
		const left = tokens[index - 1];
		const right = tokens[index + 1];
		if (left !== undefined && right !== undefined && matches(left, right)) {
			pushTokenLintIssue(issues, file, token, rule, message);
		}
	}
}
