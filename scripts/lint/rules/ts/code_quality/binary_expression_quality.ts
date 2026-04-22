import { type AnalysisRegion } from '../../../../analysis/lint_suppressions';
import { noteQualityLedger, type QualityLedger } from '../../../../analysis/quality_ledger';
import ts from 'typescript';
import { lintAllocationFallbackPattern } from '../../code_quality/allocation_fallback_pattern';
import { lintDefensiveTypeofFunctionPattern } from '../../code_quality/defensive_typeof_function_pattern';
import { lintNullishCounterIncrementPattern } from '../../code_quality/nullish_counter_increment_pattern';
import { lintNullishNullNormalizationPattern } from '../../code_quality/nullish_null_normalization_pattern';
import { lintEmptyContainerFallbackPattern } from '../../common/empty_container_fallback_pattern';
import { unwrapExpression } from '../../../../../src/bmsx/language/ts/ast/expressions';
import { isBooleanLiteral, isEmptyStringLiteral, isNullOrUndefined } from '../../../../../src/bmsx/language/ts/ast/literals';
import { isEqualityOperator } from '../../../../../src/bmsx/language/ts/ast/operators';
import { LintIssue, isExplicitNonJsTruthinessPair, pushLintIssue } from '../support/ast';
import { collectStringOrChainSubjects, isBooleanLiteralComparisonSmell } from '../support/conditions';
import { nullishFallbackLedgerKind } from '../support/nullish';

export function lintBinaryExpressionForCodeQuality(
	node: ts.BinaryExpression,
	sourceFile: ts.SourceFile,
	regions: readonly AnalysisRegion[],
	issues: LintIssue[],
	ledger: QualityLedger):
	void {
	const operatorKind = node.operatorToken.kind;
	const isLogicalOr = operatorKind === ts.SyntaxKind.BarBarToken;
	const hasEmptyStringOperand = (isEmptyStringLiteral(node.left) && !ts.isStringLiteral(node.right))
		|| (isEmptyStringLiteral(node.right) && !ts.isStringLiteral(node.left));
	if (operatorKind === ts.SyntaxKind.QuestionQuestionToken) {
		noteQualityLedger(ledger, 'nullish_fallback_checked');
		noteQualityLedger(ledger, `nullish_fallback_${nullishFallbackLedgerKind(node)}`);
		lintNullishNullNormalizationPattern(node, sourceFile, issues);
		lintEmptyContainerFallbackPattern(node, sourceFile, issues);
		if (isEmptyStringLiteral(unwrapExpression(node.right))) {
			pushLintIssue(
				issues,
				sourceFile,
				node.operatorToken,
				'empty_string_fallback_pattern',
				'Empty-string fallback via `??` is forbidden. Do not use empty strings as default values.',
			);
		}
		lintAllocationFallbackPattern(node, sourceFile, regions, issues, ledger);
	}
	lintNullishCounterIncrementPattern(node, sourceFile, issues);
	lintDefensiveTypeofFunctionPattern(node, sourceFile, issues);
	if (isLogicalOr) {
		const subjects: string[] = [];
		if (collectStringOrChainSubjects(node, subjects) && subjects.length > 2) {
			const first = subjects[0];
			let sameSubject = true;
			for (let index = 1; index < subjects.length; index += 1) {
				if (subjects[index] !== first) {
					sameSubject = false;
					break;
				}
			}
			if (sameSubject) {
				pushLintIssue(
					issues,
					sourceFile,
					node.operatorToken,
					'string_or_chain_comparison_pattern',
					'Multiple OR-comparisons against the same expression with string literals are forbidden. Use `switch`-statement or set-like lookups instead.',
				);
			}
		}
	}
	if (isEqualityOperator(operatorKind)) {
		if (hasEmptyStringOperand) {
			pushLintIssue(
				issues,
				sourceFile,
				node.operatorToken,
				'empty_string_condition_pattern',
				'Empty-string condition checks are forbidden. Prefer explicit truthy/falsy checks.',
			);
		}
		const leftBoolean = isBooleanLiteral(node.left);
		const rightBoolean = isBooleanLiteral(node.right);
		if (
			(leftBoolean !== null || rightBoolean !== null)
			&& !(leftBoolean !== null && rightBoolean !== null)
			&& !isExplicitNonJsTruthinessPair(node)
			&& isBooleanLiteralComparisonSmell(node, leftBoolean, rightBoolean)
		) {
			pushLintIssue(
				issues,
				sourceFile,
				node.operatorToken,
				'explicit_truthy_comparison_pattern',
				'Explicit boolean literal comparison is forbidden. Use truthy/falsy checks instead.',
			);
		}
	}
	if (isLogicalOr) {
		if (hasEmptyStringOperand) {
			pushLintIssue(
				issues,
				sourceFile,
				node.operatorToken,
				'empty_string_fallback_pattern',
				'Empty-string fallback via `||` is forbidden. Do not use empty strings as default values.',
			);
		}
		if (
			(isNullOrUndefined(node.left) && !isNullOrUndefined(node.right))
			|| (isNullOrUndefined(node.right) && !isNullOrUndefined(node.left))
		) {
			pushLintIssue(
				issues,
				sourceFile,
				node.operatorToken,
				'or_nil_fallback_pattern',
				'`|| null`/`|| undefined` fallback is forbidden. Use direct checks or nullish coalescing.',
			);
		}
	}
}
