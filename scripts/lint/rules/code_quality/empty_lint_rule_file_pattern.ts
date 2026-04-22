import { defineLintRule } from '../../rule';
import ts from 'typescript';
import { LintIssue, pushLintIssue } from '../ts/support/ast';

export const emptyLintRuleFilePatternRule = defineLintRule('code_quality', 'empty_lint_rule_file_pattern');

export function lintEmptyLintRuleFilePattern(sourceFile: ts.SourceFile, issues: LintIssue[]): void {
	if (!containsDefineLintRuleCall(sourceFile) || sourceFileContains(sourceFile, isFunctionWithRealImplementation)) {
		return;
	}
	pushLintIssue(
		issues,
		sourceFile,
		sourceFile,
		emptyLintRuleFilePatternRule.name,
		'Lint rule file has no real implementation. A rule file must own detection logic, not just define metadata, exports, or message helpers.',
	);
}

function containsDefineLintRuleCall(sourceFile: ts.SourceFile): boolean {
	return sourceFileContains(sourceFile, node =>
		ts.isCallExpression(node)
		&& ts.isIdentifier(node.expression)
		&& node.expression.text === 'defineLintRule',
	);
}

function sourceFileContains(sourceFile: ts.SourceFile, predicate: (node: ts.Node) => boolean): boolean {
	let found = false;
	const visit = (node: ts.Node): void => {
		if (found) {
			return;
		}
		if (predicate(node)) {
			found = true;
			return;
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return found;
}

function isFunctionWithRealImplementation(node: ts.Node): boolean {
	if (!ts.isFunctionDeclaration(node) && !ts.isMethodDeclaration(node) && !ts.isFunctionExpression(node) && !ts.isArrowFunction(node)) {
		return false;
	}
	const body = node.body;
	if (body === undefined || !ts.isBlock(body)) {
		return false;
	}
	return !isMessageOnlyFunction(body) && !isUnconditionalIssuePushFunction(body);
}

function isMessageOnlyFunction(body: ts.Block): boolean {
	if (body.statements.length !== 1) {
		return false;
	}
	const statement = body.statements[0];
	return ts.isReturnStatement(statement)
		&& statement.expression !== undefined
		&& (ts.isStringLiteralLike(statement.expression) || ts.isTemplateExpression(statement.expression));
}

function isUnconditionalIssuePushFunction(body: ts.Block): boolean {
	if (body.statements.length !== 1) {
		return false;
	}
	const statement = body.statements[0];
	return ts.isExpressionStatement(statement)
		&& ts.isCallExpression(statement.expression)
		&& isIssuePushCall(statement.expression);
}

function isIssuePushCall(call: ts.CallExpression): boolean {
	const expression = call.expression;
	if (ts.isIdentifier(expression)) {
		switch (expression.text) {
			case 'pushLintIssue':
			case 'pushTsLintIssue':
			case 'pushLuaLintIssue':
			case 'pushIssue':
				return true;
			default:
				return false;
		}
	}
	return ts.isPropertyAccessExpression(expression) && expression.name.text === 'push';
}
