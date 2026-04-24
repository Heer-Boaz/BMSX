import { type LintRuleName } from './rule';

export type CartLintIssue = {
	readonly rule: LintRuleName;
	readonly path: string;
	readonly line: number;
	readonly column: number;
	readonly message: string;
};

export type CartLintNode = {
	readonly range: {
		readonly path: string;
		readonly start: {
			readonly line: number;
			readonly column: number;
		};
	};
};

export type CartLintReporter = (rule: LintRuleName, node: CartLintNode, message: string) => void;

export type CartLintIssuePusher = (issues: CartLintIssue[], rule: LintRuleName, node: CartLintNode, message: string) => void;

export type CartLintLocationPusher = (
	issues: CartLintIssue[],
	rule: LintRuleName,
	path: string,
	line: number,
	column: number,
	message: string,
) => void;
