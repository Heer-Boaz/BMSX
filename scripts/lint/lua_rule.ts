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

export function pushLintIssue(
	issues: CartLintIssue[],
	activeRules: ReadonlySet<LintRuleName>,
	isLineSuppressed: (path: string, line: number) => boolean,
	rule: LintRuleName,
	node: CartLintNode,
	message: string,
): void {
	if (!activeRules.has(rule)) {
		return;
	}
	if (isLineSuppressed(node.range.path, node.range.start.line)) {
		return;
	}
	issues.push({
		rule,
		path: node.range.path,
		line: node.range.start.line,
		column: node.range.start.column,
		message,
	});
}
