import { type AnalysisRegion } from '../../../../analysis/lint_suppressions';
import { noteQualityLedger, type QualityLedger } from '../../../../analysis/quality_ledger';
import { type TsLintIssue as LintIssue, pushTsLintIssue as pushLintIssue } from '../../../ts_rule';
import { allocationFallbackPatternRule } from '../../code_quality/allocation_fallback_pattern';
import { defensiveTypeofFunctionPatternRule } from '../../code_quality/defensive_typeof_function_pattern';
import { nullishCounterIncrementPatternRule } from '../../code_quality/nullish_counter_increment_pattern';
import { nullishNullNormalizationPatternRule } from '../../code_quality/nullish_null_normalization_pattern';
import { emptyContainerFallbackPatternRule } from '../../common/empty_container_fallback_pattern';
import { emptyStringConditionPatternRule } from '../../common/empty_string_condition_pattern';
import { emptyStringFallbackPatternRule } from '../../common/empty_string_fallback_pattern';
import { explicitTruthyComparisonPatternRule } from '../../common/explicit_truthy_comparison_pattern';
import { orNilFallbackPatternRule } from '../../common/or_nil_fallback_pattern';
import { stringOrChainComparisonPatternRule } from '../../common/string_or_chain_comparison_pattern';
import ts from 'typescript';
import { nodeIsInAnalysisRegion } from '../../../../analysis/code_quality/source_scan';
import { isExplicitNonJsTruthinessPair, isInsideConstructor, unwrapExpression } from '../support/ast';
import { collectStringOrChainSubjects, isBooleanLiteral, isBooleanLiteralComparisonSmell, isEmptyContainerLiteral, isEmptyStringLiteral, isEqualityOperator, isTypeofFunctionComparison } from '../support/conditions';
import { isNullOrUndefined, isNullishCounterIncrement, nullishFallbackLedgerKind } from '../support/nullish';
import { isAllocationExpression } from '../support/runtime_patterns';

export function lintBinaryExpressionForCodeQuality(
	node: ts.BinaryExpression,
	sourceFile: ts.SourceFile,
	regions: readonly AnalysisRegion[],
	issues: LintIssue[],
	ledger: QualityLedger):
	void {
	if (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
		noteQualityLedger(ledger, 'nullish_fallback_checked');
		noteQualityLedger(ledger, `nullish_fallback_${nullishFallbackLedgerKind(node)}`);
		if (isNullOrUndefined(node.right)) {
			pushLintIssue(
				issues,
				sourceFile,
				node.operatorToken,
				nullishNullNormalizationPatternRule.name,
				'`?? null`/`?? undefined` normalization is forbidden. Preserve undefined/null directly or handle the case explicitly.',
			);
		}
		if (isEmptyContainerLiteral(node.right)) {
			pushLintIssue(
				issues,
				sourceFile,
				node.operatorToken,
				emptyContainerFallbackPatternRule.name,
				'`?? []`/`?? {}` fallback allocation is forbidden. Use a shared empty value, a direct branch, or keep ownership explicit.',
			);
		}
		if (isEmptyStringLiteral(unwrapExpression(node.right))) {
			pushLintIssue(
				issues,
				sourceFile,
				node.operatorToken,
				emptyStringFallbackPatternRule.name,
				'Empty-string fallback via `??` is forbidden. Do not use empty strings as default values.',
			);
		}
		if (isAllocationExpression(node.right) && !nodeIsInAnalysisRegion(sourceFile, regions, 'allocation-fallback-acceptable', node)) {
			if (isInsideConstructor(node)) {
				noteQualityLedger(ledger, 'allowed_allocation_fallback_constructor_default');
			} else {
				pushLintIssue(
					issues,
					sourceFile,
					node.operatorToken,
					allocationFallbackPatternRule.name,
					'Allocation fallback via `??` is forbidden. Use shared defaults, explicit branches, or require ownership at the call boundary.',
				);
			}
		}
	}
	if (isNullishCounterIncrement(node)) {
		pushLintIssue(
			issues,
			sourceFile,
			node.operatorToken,
			nullishCounterIncrementPatternRule.name,
			'Counter increment through `?? 0` is forbidden. Initialize the counter at the owner boundary and increment directly.',
		);
	}
	if (isTypeofFunctionComparison(node)) {
		pushLintIssue(
			issues,
			sourceFile,
			node.operatorToken,
			defensiveTypeofFunctionPatternRule.name,
			'`typeof x === "function"` is forbidden. Trust callable contracts, use optional calls for optional members, or suppress a proven external boundary locally.',
		);
	}
		if (node.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
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
				const position = sourceFile.getLineAndCharacterOfPosition(node.operatorToken.getStart());
				issues.push({
					kind: stringOrChainComparisonPatternRule.name,
					file: sourceFile.fileName,
					line: position.line + 1,
					column: position.character + 1,
					name: stringOrChainComparisonPatternRule.name,
					message: 'Multiple OR-comparisons against the same expression with string literals are forbidden. Use `switch`-statement or set-like lookups instead.',
				});
			}
		}
	}
	if (isEqualityOperator(node.operatorToken.kind)) {
		if (
			(isEmptyStringLiteral(node.left) && !ts.isStringLiteral(node.right))
			|| (isEmptyStringLiteral(node.right) && !ts.isStringLiteral(node.left))
		) {
			const position = sourceFile.getLineAndCharacterOfPosition(node.operatorToken.getStart());
			issues.push({
				kind: emptyStringConditionPatternRule.name,
				file: sourceFile.fileName,
				line: position.line + 1,
				column: position.character + 1,
				name: emptyStringConditionPatternRule.name,
				message: 'Empty-string condition checks are forbidden. Prefer explicit truthy/falsy checks.',
			});
		}
		const leftBoolean = isBooleanLiteral(node.left);
		const rightBoolean = isBooleanLiteral(node.right);
		if (
			(leftBoolean !== null || rightBoolean !== null)
			&& !(leftBoolean !== null && rightBoolean !== null)
			&& !isExplicitNonJsTruthinessPair(node)
			&& isBooleanLiteralComparisonSmell(node, leftBoolean, rightBoolean)
		) {
			const position = sourceFile.getLineAndCharacterOfPosition(node.operatorToken.getStart());
			issues.push({
				kind: explicitTruthyComparisonPatternRule.name,
				file: sourceFile.fileName,
				line: position.line + 1,
				column: position.character + 1,
				name: explicitTruthyComparisonPatternRule.name,
				message: 'Explicit boolean literal comparison is forbidden. Use truthy/falsy checks instead.',
			});
		}
	}
	if (node.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
		if (
			(isEmptyStringLiteral(node.left) && !ts.isStringLiteral(node.right))
			|| (isEmptyStringLiteral(node.right) && !ts.isStringLiteral(node.left))
		) {
			const position = sourceFile.getLineAndCharacterOfPosition(node.operatorToken.getStart());
			issues.push({
				kind: emptyStringFallbackPatternRule.name,
				file: sourceFile.fileName,
				line: position.line + 1,
				column: position.character + 1,
				name: emptyStringFallbackPatternRule.name,
				message: 'Empty-string fallback via `||` is forbidden. Do not use empty strings as default values.',
			});
		}
		if (
			(isNullOrUndefined(node.left) && !isNullOrUndefined(node.right))
			|| (isNullOrUndefined(node.right) && !isNullOrUndefined(node.left))
		) {
			const position = sourceFile.getLineAndCharacterOfPosition(node.operatorToken.getStart());
			issues.push({
				kind: orNilFallbackPatternRule.name,
				file: sourceFile.fileName,
				line: position.line + 1,
				column: position.character + 1,
				name: orNilFallbackPatternRule.name,
				message: '`|| null`/`|| undefined` fallback is forbidden. Use direct checks or nullish coalescing.',
			});
		}
	}
}
