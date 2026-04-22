import { defineLintRule } from '../../rule';
import { type AnalysisRegion } from '../../../analysis/lint_suppressions';
import { type LintIssue as LintIssue, pushLintIssue } from '../../ts_rule';
import ts from 'typescript';
import { nodeIsInAnalysisRegion } from '../../../analysis/code_quality/source_scan';
import { functionBodyContainsLazyInitAssignment, getSingleReturnExpression } from '../ts/support/ast';
import { expressionAccessFingerprint } from '../ts/support/declarations';
import { getFunctionNodeUsageNames } from '../ts/support/function_usage';

export const ensurePatternRule = defineLintRule('shared', 'ensure_pattern');

export function lintEnsurePattern(
	node: ts.FunctionDeclaration | ts.MethodDeclaration | ts.FunctionExpression | ts.ArrowFunction,
	sourceFile: ts.SourceFile,
	regions: readonly AnalysisRegion[],
	issues: LintIssue[],
): void {
	if (nodeIsInAnalysisRegion(sourceFile, regions, 'ensure-acceptable', node)) {
		return;
	}
	const names = getFunctionNodeUsageNames(node);
	if (names.length === 0 || !names.some(name => name.startsWith('ensure'))) {
		return;
	}
	const body = node.body;
	if (body === undefined || !ts.isBlock(body) || body.statements.length < 2) {
		return;
	}
	const lastStatement = body.statements[body.statements.length - 1];
	const returnExpression = getSingleReturnExpression(lastStatement);
	if (returnExpression === null) {
		return;
	}
	const targetFingerprint = expressionAccessFingerprint(returnExpression);
	if (targetFingerprint === null) {
		return;
	}
	let hasGuardReturn = false;
	for (let index = 0; index < body.statements.length - 1; index += 1) {
		const statement = body.statements[index];
		if (!ts.isIfStatement(statement) || statement.elseStatement !== undefined) {
			continue;
		}
		const guardReturn = getSingleReturnExpression(statement.thenStatement);
		if (guardReturn === null) {
			continue;
		}
		if (expressionAccessFingerprint(guardReturn) === targetFingerprint) {
			hasGuardReturn = true;
			break;
		}
	}
	if (!hasGuardReturn || !functionBodyContainsLazyInitAssignment(body, targetFingerprint)) {
		return;
	}
	pushLintIssue(
		issues,
		sourceFile,
		node.name ?? node,
		ensurePatternRule.name,
		'Lazy ensure/init wrapper is forbidden. Initialize the resource eagerly instead of guarding creation and returning the cached singleton.',
	);
}
