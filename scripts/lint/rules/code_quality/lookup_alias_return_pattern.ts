import { defineLintRule } from '../../rule';
import { type TsLintIssue as LintIssue, pushTsLintIssue } from '../../ts_rule';
import ts from 'typescript';
import { unwrapExpression } from '../ts/support/ast';
import { isLookupCallExpression } from '../ts/support/calls';
import { expressionAccessFingerprint } from '../ts/support/declarations';
import { isNullishReturnStatement } from '../ts/support/nullish';
import { nextStatementAfter, previousStatementBefore } from '../ts/support/statements';

export const lookupAliasReturnPatternRule = defineLintRule('code_quality', 'lookup_alias_return_pattern');

export function lintLookupAliasOptionalChain(node: ts.Statement, sourceFile: ts.SourceFile, issues: LintIssue[]): void {
	const previous = previousStatementBefore(node);
	if (previous === null || !ts.isVariableStatement(previous)) {
		return;
	}
	const declarations = previous.declarationList.declarations;
	if (declarations.length !== 1) {
		return;
	}
	const declaration = declarations[0];
	if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined || !isLookupCallExpression(declaration.initializer)) {
		return;
	}
	const declarationFingerprint = `id:${declaration.name.text}`;
	if (ts.isIfStatement(node)) {
		if (node.elseStatement !== undefined || !isNullishReturnStatement(node.thenStatement)) {
			return;
		}
		const guardExpression = unwrapExpression(node.expression);
		if (!ts.isPrefixUnaryExpression(guardExpression) || guardExpression.operator !== ts.SyntaxKind.ExclamationToken) {
			return;
		}
		const guardFingerprintText = expressionAccessFingerprint(guardExpression.operand);
		if (guardFingerprintText !== declarationFingerprint) {
			return;
		}
		const next = nextStatementAfter(node);
		if (next === null || !ts.isReturnStatement(next) || next.expression === undefined) {
			return;
		}
		const returnedFingerprint = expressionAccessFingerprint(next.expression);
		if (
			returnedFingerprint === null
			|| returnedFingerprint === declarationFingerprint
			|| (
				!returnedFingerprint.startsWith(`${declarationFingerprint}.`)
				&& !returnedFingerprint.startsWith(`${declarationFingerprint}[`)
			)
		) {
			return;
		}
		pushTsLintIssue(
			issues,
			sourceFile,
			node,
			lookupAliasReturnPatternRule.name,
			'Temporary lookup alias is forbidden. Inline the lookup expression directly and use optional chaining on it instead.',
		);
		return;
	}
	if (!ts.isReturnStatement(node) || node.expression === undefined) {
		return;
	}
	const returnedFingerprint = expressionAccessFingerprint(node.expression);
	if (
		returnedFingerprint === null
		|| returnedFingerprint === declarationFingerprint
		|| (
			!returnedFingerprint.startsWith(`${declarationFingerprint}.`)
			&& !returnedFingerprint.startsWith(`${declarationFingerprint}[`)
		)
	) {
		return;
	}
	pushTsLintIssue(
		issues,
		sourceFile,
		node,
		lookupAliasReturnPatternRule.name,
		'Temporary lookup alias is forbidden. Inline the lookup expression directly and use optional chaining on it instead.',
	);
}
