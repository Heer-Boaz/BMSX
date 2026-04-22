import { type LuaCartLintRule, type LuaLintIssue, type LuaLintNode, pushLuaLintIssue } from '../../../../lua_rule';
import { type LuaLintSuppressionRange } from './types';

export const suppressedLineRangesByPath = new Map<string, ReadonlyArray<LuaLintSuppressionRange>>();

export let activeLintRules: ReadonlySet<LuaCartLintRule>;

export function setActiveLintRules(rules: ReadonlySet<LuaCartLintRule>): void {
	activeLintRules = rules;
}

export function clearSuppressedLineRanges(): void {
	suppressedLineRangesByPath.clear();
}

export function setSuppressedLineRanges(path: string, ranges: ReadonlyArray<LuaLintSuppressionRange>): void {
	suppressedLineRangesByPath.set(path, ranges);
}

export function isLineSuppressed(path: string, line: number): boolean {
	const ranges = suppressedLineRangesByPath.get(path);
	if (!ranges) {
		return false;
	}
	for (const range of ranges) {
		if (line < range.startLine) {
			return false;
		}
		if (line <= range.endLine) {
			return true;
		}
	}
	return false;
}

export function pushIssue(issues: LuaLintIssue[], rule: LuaCartLintRule, node: LuaLintNode, message: string): void {
	pushLuaLintIssue(issues, activeLintRules, isLineSuppressed, rule, node, message);
}

export function pushIssueAt(issues: LuaLintIssue[], rule: LuaCartLintRule, path: string, line: number, column: number, message: string): void {
	if (!activeLintRules.has(rule)) {
		return;
	}
	if (isLineSuppressed(path, line)) {
		return;
	}
	issues.push({
		rule,
		path,
		line,
		column,
		message,
	});
}
