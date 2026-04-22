import { defineLintRule } from '../../rule';
import ts from 'typescript';
import { LintIssue, getPropertyName, pushLintIssue } from '../ts/support/ast';

export const thinLintReportWrapperPatternRule = defineLintRule('code_quality', 'thin_lint_report_wrapper_pattern');

export function lintThinLintReportWrapperPattern(
	node: ts.FunctionDeclaration | ts.MethodDeclaration | ts.FunctionExpression | ts.ArrowFunction,
	sourceFile: ts.SourceFile,
	issues: LintIssue[],
): void {
	const name = functionLikeName(node);
	if (name === null || !/^report[A-Z]/.test(name) || !functionBodyOnlyPushesIssue(node)) {
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

function functionLikeName(node: ts.FunctionDeclaration | ts.MethodDeclaration | ts.FunctionExpression | ts.ArrowFunction): string | null {
	if (node.name !== undefined) {
		return getPropertyName(node.name);
	}
	const parent = node.parent;
	if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
		return parent.name.text;
	}
	if (ts.isPropertyAssignment(parent)) {
		return getPropertyName(parent.name);
	}
	return null;
}

function functionBodyOnlyPushesIssue(node: ts.FunctionDeclaration | ts.MethodDeclaration | ts.FunctionExpression | ts.ArrowFunction): boolean {
	const body = node.body;
	if (body === undefined || !ts.isBlock(body) || body.statements.length !== 1) {
		return false;
	}
	const statement = body.statements[0];
	if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) {
		return false;
	}
	return isIssuePushCall(statement.expression);
}

function isIssuePushCall(call: ts.CallExpression): boolean {
	const expression = call.expression;
	if (ts.isIdentifier(expression)) {
		switch (expression.text) {
			case 'pushLintIssue':
			case 'pushIssue':
			case 'pushLuaLintIssue':
				return true;
			default:
				return false;
		}
	}
	if (ts.isPropertyAccessExpression(expression)) {
		return expression.name.text === 'push';
	}
	return false;
}
