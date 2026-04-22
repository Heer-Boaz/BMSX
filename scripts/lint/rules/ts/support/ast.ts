import { noteQualityLedger, type QualityLedger } from '../../../../analysis/quality_ledger';
import { type LintRuleName } from '../../../rule';
import ts from 'typescript';
import { getCallTargetLeafName, getExpressionText, unwrapExpression } from '../../../../../src/bmsx/language/ts/ast/expressions';
import { isAssignmentOperator } from '../../../../../src/bmsx/language/ts/ast/operators';
import { falseLiteralComparison } from './conditions';
import { expressionAccessFingerprint, isIgnoredMethod } from './declarations';
import { nullishLiteralComparison } from './nullish';
import { binaryParentAndSibling } from './statements';
import { LintBinding } from './types';

export type LintIssue = {
	kind: LintRuleName;
	file: string;
	line: number;
	column: number;
	name: string;
	message: string;
};

export type RepeatedExpressionInfo = {
	line: number;
	column: number;
	count: number;
	sampleText: string;
};

export const NORMALIZED_BODY_MIN_LENGTH = 120;

export const REPEATED_EXPRESSION_PAIR_MIN_LENGTH = 48;

export const REPEATED_STATEMENT_SEQUENCE_MIN_COUNT = 4;

export const REPEATED_STATEMENT_SEQUENCE_MIN_TEXT_LENGTH = 140;

export const LOCAL_CONST_PATTERN_ENABLED = true;

export function pushLintIssue(
	issues: LintIssue[],
	sourceFile: ts.SourceFile,
	node: ts.Node,
	kind: LintRuleName,
	message: string,
	name = kind,
): void {
	const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
	issues.push({
		kind,
		file: sourceFile.fileName,
		line: position.line + 1,
		column: position.character + 1,
		name,
		message,
	});
}

export function nodeStartLine(sourceFile: ts.SourceFile, node: ts.Node): number {
	return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

export function getExtendsExpression(node: ts.ClassDeclaration, importAliases: Map<string, string>): string | null {
	const heritage = node.heritageClauses;
	if (heritage === undefined) {
		return null;
	}
	for (let i = 0; i < heritage.length; i += 1) {
		const clause = heritage[i];
		if (clause.token !== ts.SyntaxKind.ExtendsKeyword) {
			continue;
		}
		const types = clause.types;
		for (let j = 0; j < types.length; j += 1) {
			const expr = types[j].expression;
			const text = getExpressionText(expr, importAliases);
			if (text !== null) {
				return text;
			}
		}
	}
	return null;
}

export function shouldIgnoreLintName(name: string): boolean {
	return name.length === 0 || name === '_' || name.startsWith('_');
}

export function getSingleReturnExpression(statement: ts.Statement): ts.Expression | null {
	if (ts.isReturnStatement(statement)) {
		return statement.expression === undefined ? null : statement.expression;
	}
	if (!ts.isBlock(statement) || statement.statements.length !== 1) {
		return null;
	}
	const onlyStatement = statement.statements[0];
	if (!ts.isReturnStatement(onlyStatement)) {
		return null;
	}
	return onlyStatement.expression === undefined ? null : onlyStatement.expression;
}

export function functionBodyContainsLazyInitAssignment(root: ts.Node, targetFingerprint: string): boolean {
	let found = false;
	const visit = (current: ts.Node): void => {
		if (found) {
			return;
		}
		if (current !== root && ts.isFunctionLike(current)) {
			return;
		}
		if (ts.isBinaryExpression(current) && isAssignmentOperator(current.operatorToken.kind)) {
			const assignmentTarget = expressionAccessFingerprint(current.left);
			if (assignmentTarget === targetFingerprint) {
				const assignedValue = unwrapExpression(current.right);
				if (
					ts.isCallExpression(assignedValue)
					|| ts.isNewExpression(assignedValue)
					|| ts.isObjectLiteralExpression(assignedValue)
					|| ts.isArrayLiteralExpression(assignedValue)
				) {
					found = true;
					return;
				}
			}
		}
		ts.forEachChild(current, visit);
	};
	visit(root);
	return found;
}

export function isSimpleAliasExpression(node: ts.Expression | undefined): boolean {
	if (node === undefined) {
		return false;
	}
	const unwrapped = unwrapExpression(node);
	return ts.isIdentifier(unwrapped);
}

export function splitIdentifierWords(text: string): string[] {
	const words = text.match(/[A-Z]?[a-z0-9]+|[A-Z]+(?![a-z0-9])/g);
	return words === null ? [text.toLowerCase()] : words.map(word => word.toLowerCase());
}

export function getActiveBinding(scopes: Array<Map<string, LintBinding[]>>, name: string): LintBinding | null {
	for (let index = scopes.length - 1; index >= 0; index -= 1) {
		const scope = scopes[index];
		const bindings = scope.get(name);
		if (bindings === undefined || bindings.length === 0) {
			continue;
		}
		return bindings[bindings.length - 1];
	}
	return null;
}

export function lintCatchClausePatterns(node: ts.CatchClause, sourceFile: ts.SourceFile, issues: LintIssue[], ledger: QualityLedger): void {
	const statements = node.block.statements;
	if (statements.length === 0) {
		pushLintIssue(
			issues,
			sourceFile,
			node,
			'empty_catch_pattern',
			'Empty catch block is forbidden. Catch only when you can handle or rethrow the error.',
		);
		return;
	}
	const declaration = node.variableDeclaration;
	if (declaration !== undefined && ts.isIdentifier(declaration.name) && statements.length === 1) {
		const onlyStatement = statements[0];
		if (
			ts.isThrowStatement(onlyStatement)
			&& onlyStatement.expression !== undefined
			&& ts.isIdentifier(onlyStatement.expression)
			&& onlyStatement.expression.text === declaration.name.text
		) {
			pushLintIssue(
				issues,
				sourceFile,
				node,
				'useless_catch_pattern',
				'Catch clause only rethrows the caught error. Remove the wrapper and let the exception propagate.',
			);
			return;
		}
	}
	for (let index = 0; index < statements.length; index += 1) {
		const statement = statements[index];
		if (!ts.isReturnStatement(statement)) {
			continue;
		}
		if (catchBlockHandlesAsyncError(node)) {
			noteQualityLedger(ledger, 'allowed_catch_async_fault_boundary');
		} else if (catchBlockReportsCaughtError(node)) {
			noteQualityLedger(ledger, 'allowed_catch_reported_fallback');
		} else {
			pushLintIssue(
				issues,
				sourceFile,
				node,
				'silent_catch_fallback_pattern',
				'Catch clause swallows the error and returns a fallback. Trust the caller/callee or propagate the failure.',
			);
			return;
		}
	}
}

export function expressionReferencesAnyName(node: ts.Node, names: ReadonlySet<string>): boolean {
	let references = false;
	const visit = (current: ts.Node): void => {
		if (references) {
			return;
		}
		if (ts.isIdentifier(current) && names.has(current.text)) {
			references = true;
			return;
		}
		ts.forEachChild(current, visit);
	};
	visit(node);
	return references;
}

export function isErrorReportingTarget(target: string | null): boolean {
	if (target === null) {
		return false;
	}
	if (target === 'console.error' || target === 'console.warn') {
		return true;
	}
	const dot = target.lastIndexOf('.');
	const leaf = dot === -1 ? target : target.slice(dot + 1);
	return /^(report|show|emit|record|log)[A-Za-z0-9]*Error$/.test(leaf)
		|| /^(warn|report|show|emit|record|log)[A-Za-z0-9]*Warning$/.test(leaf);
}

export function collectCatchReportValueNames(node: ts.CatchClause, caughtName: string | null): Set<string> {
	const names = new Set<string>();
	if (caughtName !== null) {
		names.add(caughtName);
	}
	const visit = (current: ts.Node): void => {
		if (
			ts.isVariableDeclaration(current)
			&& ts.isIdentifier(current.name)
			&& current.initializer !== undefined
			&& expressionReferencesAnyName(current.initializer, names)
		) {
			names.add(current.name.text);
		}
		ts.forEachChild(current, visit);
	};
	visit(node.block);
	return names;
}

export function catchBlockReportsCaughtError(node: ts.CatchClause): boolean {
	const declaration = node.variableDeclaration;
	const caughtName = declaration !== undefined && ts.isIdentifier(declaration.name) ? declaration.name.text : null;
	const reportValueNames = collectCatchReportValueNames(node, caughtName);
	let reports = false;
	const visit = (current: ts.Node): void => {
		if (reports) {
			return;
		}
		if (ts.isCallExpression(current)) {
			const target = getExpressionText(current.expression);
			if (isErrorReportingTarget(target) && current.arguments.some(arg => expressionReferencesAnyName(arg, reportValueNames))) {
				reports = true;
				return;
			}
		}
		ts.forEachChild(current, visit);
	};
	visit(node.block);
	return reports;
}

export function catchBlockHandlesAsyncError(node: ts.CatchClause): boolean {
	const declaration = node.variableDeclaration;
	const caughtName = declaration !== undefined && ts.isIdentifier(declaration.name) ? declaration.name.text : null;
	let handles = false;
	const visit = (current: ts.Node): void => {
		if (handles) {
			return;
		}
		if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
			const left = getExpressionText(current.left);
			const right = getExpressionText(current.right);
			if (left !== null && left.endsWith('.fault') && (caughtName === null || right === caughtName)) {
				handles = true;
				return;
			}
		}
		if (ts.isCallExpression(current)) {
			const target = getCallTargetLeafName(current.expression);
			if (target !== null && /^finish[A-Za-z0-9]*Error$/.test(target)) {
				handles = true;
				return;
			}
		}
		ts.forEachChild(current, visit);
	};
	visit(node.block);
	return handles;
}

export function functionUsageExpressionName(node: ts.Expression): string | null {
	const unwrapped = unwrapExpression(node);
	if (ts.isIdentifier(unwrapped)) {
		return unwrapped.text;
	}
	if (unwrapped.kind === ts.SyntaxKind.ThisKeyword) {
		return 'this';
	}
	if (ts.isPropertyAccessExpression(unwrapped)) {
		const base = functionUsageExpressionName(unwrapped.expression);
		return base === null ? null : `${base}.${unwrapped.name.text}`;
	}
	if (ts.isElementAccessExpression(unwrapped)) {
		const base = functionUsageExpressionName(unwrapped.expression);
		if (base === null) {
			return null;
		}
		if (ts.isStringLiteral(unwrapped.argumentExpression) || ts.isNumericLiteral(unwrapped.argumentExpression)) {
			return `${base}.${unwrapped.argumentExpression.text}`;
		}
	}
	return null;
}

export function usageCountForNames(names: readonly string[], counts: ReadonlyMap<string, number>): number {
	let total = 0;
	const visited = new Set<string>();
	for (let index = 0; index < names.length; index += 1) {
		const name = names[index];
		if (visited.has(name)) {
			continue;
		}
		visited.add(name);
		total += counts.get(name) ?? 0;
	}
	return total;
}

export function isInsideConstructor(node: ts.Node): boolean {
	let current: ts.Node | undefined = node;
	while (current !== undefined) {
		if (ts.isConstructorDeclaration(current)) {
			return true;
		}
		if (ts.isFunctionLike(current) || ts.isSourceFile(current)) {
			return false;
		}
		current = current.parent;
	}
	return false;
}

export function isExplicitNonJsTruthinessPair(node: ts.BinaryExpression): boolean {
	const falseCheck = falseLiteralComparison(node);
	if (falseCheck === null) {
		return false;
	}
	const context = binaryParentAndSibling(node);
	if (context === null) {
		return false;
	}
	const nullishCheck = nullishLiteralComparison(context.sibling);
	if (nullishCheck === null || nullishCheck.subject !== falseCheck.subject || nullishCheck.isPositive !== falseCheck.isPositive) {
		return false;
	}
	const pairOperatorKind = context.parent.operatorToken.kind;
	if (falseCheck.isPositive) {
		return pairOperatorKind === ts.SyntaxKind.BarBarToken;
	}
	return pairOperatorKind === ts.SyntaxKind.AmpersandAmpersandToken;
}
