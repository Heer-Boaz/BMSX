import ts from 'typescript';
import { isAssignmentOperator } from './operators';

function isTypeAssertionExpression(node: ts.Node): node is ts.TypeAssertion {
	const predicate = (ts as unknown as { isTypeAssertionExpression?: (node: ts.Node) => node is ts.TypeAssertion })
		.isTypeAssertionExpression;
	return predicate !== undefined && predicate(node);
}

export function getPropertyName(node: ts.PropertyName | ts.Expression): string | null {
	if (ts.isIdentifier(node)) return node.text;
	if (ts.isStringLiteral(node)) return node.text;
	if (ts.isNumericLiteral(node)) return node.text;
	if (ts.isComputedPropertyName(node)) return null;
	if (ts.isPrivateIdentifier(node)) return node.text;
	if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
	return null;
}

export function getPropertyAccessName(node: ts.Expression): string | null {
	const expression = unwrapExpression(node);
	return ts.isPropertyAccessExpression(expression) ? expression.name.text : null;
}

export function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
	const modifiers = (node as { modifiers?: ts.NodeArray<ts.Modifier> }).modifiers;
	if (modifiers === undefined) {
		return false;
	}
	for (let index = 0; index < modifiers.length; index += 1) {
		if (modifiers[index].kind === kind) {
			return true;
		}
	}
	return false;
}

export function hasExportModifier(node: ts.Node): boolean {
	return hasModifier(node, ts.SyntaxKind.ExportKeyword);
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
		if (isTypeAssertionExpression(current)) {
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
	const current = unwrapExpression(node);
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

export function isLookupCallExpression(node: ts.Expression): boolean {
	const unwrapped = unwrapExpression(node);
	return ts.isCallExpression(unwrapped)
		&& ts.isPropertyAccessExpression(unwrapped.expression)
		&& unwrapped.expression.name.text === 'get';
}

export function getCallTargetLeafName(expression: ts.Expression): string | null {
	const unwrapped = unwrapExpression(expression);
	if (ts.isIdentifier(unwrapped)) {
		return unwrapped.text;
	}
	if (ts.isPropertyAccessExpression(unwrapped)) {
		return unwrapped.name.text;
	}
	if (ts.isElementAccessExpression(unwrapped)) {
		const argument = unwrapExpression(unwrapped.argumentExpression);
		if (ts.isStringLiteralLike(argument)) {
			return argument.text;
		}
	}
	return getExpressionText(unwrapped);
}

export function hasQuestionDotToken(node: ts.Node): boolean {
	return (node as { questionDotToken?: ts.QuestionDotToken }).questionDotToken !== undefined;
}

export function callTargetText(node: ts.CallExpression | ts.NewExpression): string | null {
	return node.expression ? getExpressionText(node.expression) : null;
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

export function isExpressionChildOfLargerExpression(node: ts.Expression, parent: ts.Node | undefined): boolean {
	if (parent === undefined) {
		return false;
	}
	let child: ts.Node = node;
	while (
		ts.isParenthesizedExpression(parent)
		|| ts.isAsExpression(parent)
		|| ts.isNonNullExpression(parent)
		|| isTypeAssertionExpression(parent)
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
		&& !isAssignmentOperator(parent.operatorToken.kind)
	) {
		return true;
	}
	return false;
}

export function containsDescendantCallExpression(node: ts.Node, predicate: (call: ts.CallExpression) => boolean): boolean {
	let found = false;
	const visit = (current: ts.Node): void => {
		if (found) {
			return;
		}
		if (ts.isCallExpression(current) && predicate(current)) {
			found = true;
			return;
		}
		ts.forEachChild(current, visit);
	};
	ts.forEachChild(node, visit);
	return found;
}

export function expressionContainsPropertyAccess(node: ts.Expression, predicate: (access: ts.PropertyAccessExpression) => boolean): boolean {
	let found = false;
	const visit = (current: ts.Node): void => {
		if (found) {
			return;
		}
		if (ts.isPropertyAccessExpression(current) && predicate(current)) {
			found = true;
			return;
		}
		ts.forEachChild(current, visit);
	};
	visit(node);
	return found;
}

export function parentChainContainsCallExpression(parent: ts.Node | undefined, predicate: (call: ts.CallExpression) => boolean): boolean {
	let current = parent;
	while (
		current !== undefined
		&& (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isNonNullExpression(current) || isTypeAssertionExpression(current))
	) {
		current = current.parent;
	}
	while (current !== undefined) {
		if (ts.isCallExpression(current) && predicate(current)) {
			return true;
		}
		current = current.parent;
	}
	return false;
}
