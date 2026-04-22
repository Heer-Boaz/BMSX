import type { CppToken } from '../../../../../src/bmsx/language/cpp/syntax/tokens';

type CodeQualityLintRule = string;

export type CppLintIssue = {
	kind: CodeQualityLintRule;
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

export function pushLintIssue(
	issues: CppLintIssue[],
	file: string,
	token: CppToken,
	kind: CodeQualityLintRule,
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
