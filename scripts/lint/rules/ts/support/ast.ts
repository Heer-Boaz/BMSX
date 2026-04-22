import ts from 'typescript';
import { isTsAssignmentOperator } from './bindings';
import { falseLiteralComparison } from './conditions';
import { expressionAccessFingerprint } from './declarations';
import { nullishLiteralComparison } from './nullish';
import { binaryParentAndSibling } from './statements';
import { LintBinding } from './types';

export const NORMALIZED_BODY_MIN_LENGTH = 120;

export const COMPACT_SAMPLE_TEXT_LENGTH = 180;

export const LOCAL_CONST_PATTERN_ENABLED = true;

export function getPropertyName(node: ts.PropertyName | ts.Expression): string | null {
	if (ts.isIdentifier(node)) return node.text;
	if (ts.isStringLiteral(node)) return node.text;
	if (ts.isNumericLiteral(node)) return node.text;
	if (ts.isComputedPropertyName(node)) return null;
	if (ts.isPrivateIdentifier(node)) return node.text;
	if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
	return null;
}

export function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
	const modifiers = (node as { modifiers?: ts.NodeArray<ts.Modifier> }).modifiers;
	if (modifiers === undefined) {
		return false;
	}
	for (let i = 0; i < modifiers.length; i += 1) {
		if (modifiers[i].kind === kind) {
			return true;
		}
	}
	return false;
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

export function getExpressionText(node: ts.Expression, aliases?: Map<string, string>): string | null {
	if (node.kind === ts.SyntaxKind.ThisKeyword) {
		return 'this';
	}
	if (ts.isIdentifier(node)) {
		const alias = aliases?.get(node.text);
		return alias ?? node.text;
	}
	if (ts.isPropertyAccessExpression(node)) {
		const left = getExpressionText(node.expression, aliases);
		if (left === null) {
			return null;
		}
		return `${left}.${node.name.text}`;
	}
	return null;
}

export function getCallExpressionTarget(node: ts.Expression): string | null {
	let current: ts.Expression = node;
	while (true) {
		if (ts.isParenthesizedExpression(current)) {
			current = current.expression;
			continue;
		}
		if (ts.isAsExpression(current)) {
			current = current.expression;
			continue;
		}
		const isTypeAssertion = (ts as unknown as { isTypeAssertionExpression?: (node: ts.Node) => node is ts.TypeAssertion })
			.isTypeAssertionExpression;
		if (isTypeAssertion !== undefined && isTypeAssertion(current)) {
			current = current.expression;
			continue;
		}
		if (ts.isNonNullExpression(current)) {
			current = current.expression;
			continue;
		}
		break;
	}
	if (!ts.isCallExpression(current)) {
		return null;
	}
	return getExpressionText(current.expression);
}

export function isVariableImportExportName(node: ts.Node): boolean {
	if (
		ts.isImportClause(node) ||
		ts.isNamespaceImport(node) ||
		ts.isImportSpecifier(node) ||
		ts.isExportSpecifier(node) ||
		ts.isImportEqualsDeclaration(node)
	) {
		return true;
	}
	return false;
}

export function shouldIgnoreLintName(name: string): boolean {
	return name.length === 0 || name === '_' || name.startsWith('_');
}

export function getSingleReturnExpression(statement: ts.Statement): ts.Expression | null {
	if (ts.isReturnStatement(statement)) {
		return statement.expression ?? null;
	}
	if (!ts.isBlock(statement) || statement.statements.length !== 1) {
		return null;
	}
	const onlyStatement = statement.statements[0];
	if (!ts.isReturnStatement(onlyStatement)) {
		return null;
	}
	return onlyStatement.expression ?? null;
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
		if (ts.isBinaryExpression(current) && isTsAssignmentOperator(current.operatorToken.kind)) {
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

export function unwrapExpression(node: ts.Expression): ts.Expression {
	let current = node;
	while (true) {
		if (ts.isParenthesizedExpression(current)) {
			current = current.expression;
			continue;
		}
		if (ts.isAsExpression(current)) {
			current = current.expression;
			continue;
		}
		const isTypeAssertion = (ts as unknown as { isTypeAssertionExpression?: (node: ts.Node) => node is ts.TypeAssertion })
			.isTypeAssertionExpression;
		if (isTypeAssertion !== undefined && isTypeAssertion(current)) {
			current = current.expression;
			continue;
		}
		if (ts.isNonNullExpression(current)) {
			current = current.expression;
			continue;
		}
		return current;
	}
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

export function expressionRootName(node: ts.Expression): string | null {
	const current = unwrapExpression(node);
	if (ts.isIdentifier(current)) {
		return current.text;
	}
	if (current.kind === ts.SyntaxKind.ThisKeyword) {
		return 'this';
	}
	if (ts.isPropertyAccessExpression(current)) {
		return expressionRootName(current.expression);
	}
	if (ts.isElementAccessExpression(current)) {
		return expressionRootName(current.expression);
	}
	if (ts.isCallExpression(current)) {
		return expressionRootName(current.expression);
	}
	return null;
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

export function compactSampleText(text: string): string {
	if (text.length <= COMPACT_SAMPLE_TEXT_LENGTH) {
		return text;
	}
	return `${text.slice(0, COMPACT_SAMPLE_TEXT_LENGTH - 3)}...`;
}

export function isExpressionChildOfLargerExpression(node: ts.Expression, parent: ts.Node | undefined): boolean {
	if (parent === undefined) {
		return false;
	}
	let child: ts.Node = node;
	while (
		ts.isParenthesizedExpression(parent)
		|| ts.isAsExpression(parent)
		|| ts.isNonNullExpression(parent)
		|| ((ts as unknown as { isTypeAssertionExpression?: (node: ts.Node) => node is ts.TypeAssertion }).isTypeAssertionExpression?.(parent) ?? false)
	) {
		child = parent;
		parent = parent.parent;
		if (parent === undefined) {
			return false;
		}
	}
	if (ts.isPropertyAccessExpression(parent) && parent.expression === child) {
		return true;
	}
	if (ts.isElementAccessExpression(parent) && parent.expression === child) {
		return true;
	}
	if (ts.isCallExpression(parent) && parent.expression === child) {
		return true;
	}
	if (ts.isNewExpression(parent) && parent.expression === child) {
		return true;
	}
	if (
		ts.isBinaryExpression(parent)
		&& (parent.left === child || parent.right === child)
		&& !isTsAssignmentOperator(parent.operatorToken.kind)
	) {
		return true;
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
