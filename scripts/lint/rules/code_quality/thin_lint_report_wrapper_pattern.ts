import { defineLintRule } from '../../rule';
import ts from 'typescript';
import { type AnalysisStatement } from '../../../analysis/lint_suppressions';
import { getFunctionLikeName } from '../../../../src/bmsx/language/ts/ast/functions';
import { sourceFileIsLintRuleFile } from './empty_lint_rule_file_pattern';
import { LintIssue, pushLintIssue } from '../ts/support/ast';

export const thinLintReportWrapperPatternRule = defineLintRule('code_quality', 'thin_lint_report_wrapper_pattern');

export function lintThinLintReportWrapperPattern(
	node: ts.FunctionDeclaration | ts.MethodDeclaration | ts.FunctionExpression | ts.ArrowFunction,
	sourceFile: ts.SourceFile,
	analysisStatements: readonly AnalysisStatement[],
	issues: LintIssue[],
): void {
	const name = getFunctionLikeName(node);
	if (
		!sourceFileIsLintRuleFile(analysisStatements)
		|| name === null
		|| !/^report[A-Z]/.test(name)
		|| !functionBodyOnlyForwardsOneCall(node)
	) {
		return;
	}
	pushLintIssue(
		issues,
		sourceFile,
		node.name ?? node,
		thinLintReportWrapperPatternRule.name,
		`Thin lint report wrapper "${name}" is forbidden. The rule file must own detection logic, not just forward to pushLintIssue/pushIssue.`,
	);
}

function functionBodyOnlyForwardsOneCall(node: ts.FunctionDeclaration | ts.MethodDeclaration | ts.FunctionExpression | ts.ArrowFunction): boolean {
	const body = node.body;
	if (body === undefined || !ts.isBlock(body) || body.statements.length !== 1) {
		return false;
	}
	const statement = body.statements[0];
	return ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression);
}
