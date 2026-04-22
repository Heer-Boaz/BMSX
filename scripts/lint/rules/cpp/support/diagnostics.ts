import type { Token } from '../../../../../src/bmsx/language/cpp/syntax/tokens';
import { type LintIssue, type LintRuleName } from '../../../rule';
import { type NormalizedBodyInfo } from '../../../normalized_body';

export type { LintIssue };
export type { NormalizedBodyInfo };

export function pushTokenLintIssue(
	issues: LintIssue[],
	file: string,
	token: Token,
	kind: LintRuleName,
	message: string,
	name = kind,
): void {
	issues.push({
		kind,
		file,
		line: token.line,
		column: token.column,
		name,
		message,
	});
}
