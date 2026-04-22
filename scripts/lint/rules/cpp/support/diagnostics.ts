import type { CppToken } from '../../../../../src/bmsx/language/cpp/syntax/tokens';
import { type LintRuleName } from '../../../rule';

export type CppLintIssue = {
	kind: LintRuleName;
	file: string;
	line: number;
	column: number;
	name: string;
	message: string;
};

export type CppNormalizedBodyInfo = {
	name: string;
	file: string;
	line: number;
	column: number;
	fingerprint: string;
	semanticSignatures: string[] | null;
};

export function pushTokenLintIssue(
	issues: CppLintIssue[],
	file: string,
	token: CppToken,
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
