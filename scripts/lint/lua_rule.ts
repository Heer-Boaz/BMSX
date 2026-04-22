export type LuaCartLintRule = string;

export type LuaLintIssue = {
	readonly rule: LuaCartLintRule;
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

export type LuaLintReporter = (rule: LuaCartLintRule, node: LuaLintNode, message: string) => void;

export type LuaLintIssuePusher = (issues: LuaLintIssue[], rule: LuaCartLintRule, node: LuaLintNode, message: string) => void;

export type LuaLintLocationPusher = (
	issues: LuaLintIssue[],
	rule: LuaCartLintRule,
	path: string,
	line: number,
	column: number,
	message: string,
) => void;

export function pushLuaLintIssue(
	issues: LuaLintIssue[],
	activeRules: ReadonlySet<LuaCartLintRule>,
	isLineSuppressed: (path: string, line: number) => boolean,
	rule: LuaCartLintRule,
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
