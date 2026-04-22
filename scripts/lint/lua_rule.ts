import { type LintRuleName } from './rule';

export type LuaLintIssue = {
	readonly rule: LintRuleName;
	readonly path: string;
	readonly line: number;
	readonly column: number;
	readonly message: string;
};

export type LuaLintNode = {
	readonly range: {
		readonly path: string;
		readonly start: {
			readonly line: number;
			readonly column: number;
		};
	};
};

export type LuaLintReporter = (rule: LintRuleName, node: LuaLintNode, message: string) => void;

export type LuaLintIssuePusher = (issues: LuaLintIssue[], rule: LintRuleName, node: LuaLintNode, message: string) => void;

export type LuaLintLocationPusher = (
	issues: LuaLintIssue[],
	rule: LintRuleName,
	path: string,
	line: number,
	column: number,
	message: string,
) => void;

export function pushLuaLintIssue(
	issues: LuaLintIssue[],
	activeRules: ReadonlySet<LintRuleName>,
	isLineSuppressed: (path: string, line: number) => boolean,
	rule: LintRuleName,
	node: LuaLintNode,
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
