import { defineLintRule } from '../../rule';
import { type TsLintIssue as LintIssue, pushTsLintIssue } from '../../ts_rule';
import ts from 'typescript';
import { getActiveBinding, unwrapExpression } from '../ts/support/ast';
import { getCallTargetLeafName } from '../ts/support/calls';
import { findSplitLikeDelimiterInExpression, isJoinLikeCallTarget, splitJoinDelimiterFingerprint } from '../ts/support/split_join';
import { LintBinding } from '../ts/support/types';

export const splitJoinRoundtripPatternRule = defineLintRule('common', 'split_join_roundtrip_pattern');

export function lintSplitJoinRoundtripPattern(
	node: ts.CallExpression,
	sourceFile: ts.SourceFile,
	issues: LintIssue[],
	scopes: Array<Map<string, LintBinding[]>>,
): void {
	const outerTarget = getCallTargetLeafName(node.expression);
	if (outerTarget === null || !isJoinLikeCallTarget(outerTarget)) {
		return;
	}
	const outerExpression = unwrapExpression(node.expression);
	if (!ts.isPropertyAccessExpression(outerExpression)) {
		return;
	}
	const receiver = unwrapExpression(outerExpression.expression);
	let splitFingerprint = findSplitLikeDelimiterInExpression(receiver);
	if (splitFingerprint === null) {
		if (!ts.isIdentifier(receiver)) {
			return;
		}
		const binding = getActiveBinding(scopes, receiver.text);
		if (binding === null || binding.splitJoinDelimiterFingerprint === null || binding.readCount !== 0) {
			return;
		}
		splitFingerprint = binding.splitJoinDelimiterFingerprint;
	}
	const joinFingerprint = splitJoinDelimiterFingerprint(node.arguments[0]);
	if (joinFingerprint === null || splitFingerprint !== joinFingerprint) {
		return;
	}
	pushTsLintIssue(
		issues,
		sourceFile,
		node,
		splitJoinRoundtripPatternRule.name,
		'Split/join roundtrip is forbidden. Keep the text in one shape instead of splitting and rejoining it.',
	);
}
