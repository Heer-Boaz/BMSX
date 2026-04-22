import type { CppToken } from '../../../../../src/bmsx/language/cpp/syntax/tokens';
import { pushLintIssue, type CppLintIssue } from './diagnostics';

export function lintCppAdjacentEqualityComparison(
	file: string,
	tokens: readonly CppToken[],
	issues: CppLintIssue[],
	rule: string,
	message: string,
	matches: (left: CppToken, right: CppToken) => boolean,
): void {
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (token.text !== '==' && token.text !== '!=') {
			continue;
		}
		const left = tokens[index - 1];
		const right = tokens[index + 1];
		if (left !== undefined && right !== undefined && matches(left, right)) {
			pushLintIssue(issues, file, token, rule, message);
		}
	}
}
