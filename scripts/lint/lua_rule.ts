import { type LintRuleName } from './rule';
import type { LuaSourceLocations, LuaSyntaxSpan } from '../../toolchain/ts/lua/syntax/source_locations';

export type CartLintIssue = {
	readonly rule: LintRuleName;
	readonly path: string;
	readonly line: number;
	readonly column: number;
	readonly message: string;
};

export type CartLintNode = {
	readonly span: LuaSyntaxSpan;
};

export type CartLintContext = {
	readonly locations: LuaSourceLocations;
	readonly issues: CartLintIssue[];
};

export type CartLintReporter = (rule: LintRuleName, node: CartLintNode, message: string) => void;

export type CartLintIssuePusher = (context: CartLintContext, rule: LintRuleName, node: CartLintNode, message: string) => void;

export type CartLintLocationPusher = (
	issues: CartLintIssue[],
	rule: LintRuleName,
	path: string,
	line: number,
	column: number,
	message: string,
) => void;
