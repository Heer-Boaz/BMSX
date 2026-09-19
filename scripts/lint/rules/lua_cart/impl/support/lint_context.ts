import { type LintRuleName } from '../../../../rule';
import { type CartLintContext, type CartLintIssue, type CartLintNode } from '../../../../lua_rule';
import { type CartLintSuppressionRange } from './types';

export const suppressedLineRangesByPath = new Map<string, ReadonlyArray<CartLintSuppressionRange>>();

export let activeLintRules: ReadonlySet<LintRuleName>;

export function setActiveLintRules(rules: ReadonlySet<LintRuleName>): void {
	activeLintRules = rules;
}

export function clearSuppressedLineRanges(): void {
	suppressedLineRangesByPath.clear();
}

export function setSuppressedLineRanges(path: string, ranges: ReadonlyArray<CartLintSuppressionRange>): void {
	suppressedLineRangesByPath.set(path, ranges);
}

export function isLineSuppressed(path: string, line: number, rule: LintRuleName): boolean {
	const ranges = suppressedLineRangesByPath.get(path);
	if (!ranges) {
		return false;
	}
	for (const range of ranges) {
		if (line < range.startLine) {
			return false;
		}
		if (line <= range.endLine && (range.rule === null || range.rule === rule)) {
			return true;
		}
	}
	return false;
}

export function pushIssue(context: CartLintContext, rule: LintRuleName, node: CartLintNode, message: string): void {
	if (!activeLintRules.has(rule)) {
		return;
	}
	const range = context.locations.range(node.span);
	if (isLineSuppressed(range.path, range.start.line, rule)) {
		return;
	}
	context.issues.push({
		rule,
		path: range.path,
		line: range.start.line,
		column: range.start.column,
		message,
	});
}

export function pushIssueAt(issues: CartLintIssue[], rule: LintRuleName, path: string, line: number, column: number, message: string): void {
	if (!activeLintRules.has(rule)) {
		return;
	}
	if (isLineSuppressed(path, line, rule)) {
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
