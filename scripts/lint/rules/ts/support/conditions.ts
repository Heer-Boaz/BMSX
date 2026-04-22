import ts from 'typescript';
import { LintIssue, unwrapExpression } from './ast';
import { isExpressionInScopeFingerprint } from './bindings';
import { isFunctionLikeWithParameters } from './functions';
import { ExplicitValueCheck } from './types';

export function isBooleanLiteral(node: ts.Expression): boolean | null {
	if (node.kind === ts.SyntaxKind.TrueKeyword) {
		return true;
	}
	if (node.kind === ts.SyntaxKind.FalseKeyword) {
		return false;
	}
	return null;
}

export function isLikelyBooleanName(name: string): boolean {
	return /^(is|has|can|should|would|could|did|does|will|was|were|needs|uses)[A-Z_]/.test(name)
		|| /(Active|Available|Blocked|Checked|Closed|Dirty|Disabled|Done|Empty|Enabled|Handled|Invalid|Loaded|Ok|OK|Open|Pending|Ready|Rejected|Selected|Success|Valid|Visible)$/.test(name)
		|| /^(active|available|blocked|checked|closed|dirty|disabled|done|empty|enabled|handled|invalid|loaded|ok|open|pending|ready|rejected|selected|success|valid|visible)$/.test(name);
}

export function isBooleanProducingOperator(kind: ts.SyntaxKind): boolean {
	return isEqualityOperator(kind)
		|| kind === ts.SyntaxKind.LessThanToken
		|| kind === ts.SyntaxKind.LessThanEqualsToken
		|| kind === ts.SyntaxKind.GreaterThanToken
		|| kind === ts.SyntaxKind.GreaterThanEqualsToken
		|| kind === ts.SyntaxKind.InKeyword
		|| kind === ts.SyntaxKind.InstanceOfKeyword;
}

export function isLikelyBooleanExpression(node: ts.Expression): boolean {
	const expression = unwrapExpression(node);
	if (ts.isIdentifier(expression)) {
		return isLikelyBooleanName(expression.text);
	}
	if (ts.isPropertyAccessExpression(expression)) {
		return isLikelyBooleanName(expression.name.text);
	}
	if (ts.isCallExpression(expression)) {
		const target = expression.expression;
		if (ts.isIdentifier(target)) {
			return isLikelyBooleanName(target.text);
		}
		if (ts.isPropertyAccessExpression(target)) {
			return isLikelyBooleanName(target.name.text);
		}
		return false;
	}
	if (ts.isPrefixUnaryExpression(expression)) {
		return expression.operator === ts.SyntaxKind.ExclamationToken;
	}
	if (ts.isBinaryExpression(expression)) {
		return isBooleanProducingOperator(expression.operatorToken.kind)
			|| expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
			|| expression.operatorToken.kind === ts.SyntaxKind.BarBarToken;
	}
	return false;
}

export function isBooleanLiteralComparisonSmell(node: ts.BinaryExpression, leftBoolean: boolean | null, rightBoolean: boolean | null): boolean {
	const booleanValue = leftBoolean !== null ? leftBoolean : rightBoolean;
	if (booleanValue !== false) {
		return true;
	}
	const subject = leftBoolean !== null ? node.right : node.left;
	return isLikelyBooleanExpression(subject);
}

export function isEmptyStringLiteral(node: ts.Expression): node is ts.StringLiteral {
	return ts.isStringLiteral(node) && node.text === '';
}

export function isStringLiteralLike(node: ts.Expression): boolean {
	return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

export function isPositiveEqualityOperator(kind: ts.SyntaxKind): boolean {
	return kind === ts.SyntaxKind.EqualsEqualsToken || kind === ts.SyntaxKind.EqualsEqualsEqualsToken;
}

export function isEmptyContainerLiteral(node: ts.Expression): boolean {
	const unwrapped = unwrapExpression(node);
	return (ts.isArrayLiteralExpression(unwrapped) && unwrapped.elements.length === 0)
		|| (ts.isObjectLiteralExpression(unwrapped) && unwrapped.properties.length === 0);
}

export function isTypeofFunctionComparison(node: ts.BinaryExpression): boolean {
	if (!isEqualityOperator(node.operatorToken.kind)) {
		return false;
	}
	const left = unwrapExpression(node.left);
	const right = unwrapExpression(node.right);
	return (
		ts.isTypeOfExpression(left)
		&& ts.isStringLiteralLike(right)
		&& right.text === 'function'
	) || (
		ts.isTypeOfExpression(right)
		&& ts.isStringLiteralLike(left)
		&& left.text === 'function'
	);
}

export function isOrderingComparisonOperator(kind: ts.SyntaxKind): boolean {
	return kind === ts.SyntaxKind.GreaterThanToken
		|| kind === ts.SyntaxKind.GreaterThanEqualsToken
		|| kind === ts.SyntaxKind.LessThanToken
		|| kind === ts.SyntaxKind.LessThanEqualsToken;
}

export function isEqualityOperator(kind: ts.SyntaxKind): boolean {
	return kind === ts.SyntaxKind.EqualsEqualsToken
		|| kind === ts.SyntaxKind.EqualsEqualsEqualsToken
		|| kind === ts.SyntaxKind.ExclamationEqualsToken
		|| kind === ts.SyntaxKind.ExclamationEqualsEqualsToken;
}

export function collectStringOrChainSubjects(node: ts.Expression, subjects: string[]): boolean {
	if (ts.isParenthesizedExpression(node)) {
		return collectStringOrChainSubjects(node.expression, subjects);
	}
	if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
		return collectStringOrChainSubjects(node.left, subjects) && collectStringOrChainSubjects(node.right, subjects);
	}
	if (!ts.isBinaryExpression(node) || !isEqualityOperator(node.operatorToken.kind)) {
		return false;
	}
	if (!ts.isStringLiteral(node.left) && !ts.isStringLiteral(node.right)) {
		return false;
	}
	if (ts.isStringLiteral(node.left) && ts.isStringLiteral(node.right)) {
		return false;
	}
	const subject = ts.isStringLiteral(node.left) ? node.right : node.left;
	const subjectKey = isExpressionInScopeFingerprint(subject);
	if (subjectKey === null) {
		return false;
	}
	subjects.push(subjectKey);
	return true;
}

export function stringSwitchComparisonSubject(node: ts.Expression): string | null {
	const unwrapped = unwrapExpression(node);
	if (!ts.isBinaryExpression(unwrapped) || unwrapped.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken) {
		return null;
	}
	const leftIsString = isStringLiteralLike(unwrapped.left);
	const rightIsString = isStringLiteralLike(unwrapped.right);
	if (leftIsString === rightIsString) {
		return null;
	}
	const subject = leftIsString ? unwrapped.right : unwrapped.left;
	return isExpressionInScopeFingerprint(subject);
}

export function lintStringSwitchChain(node: ts.IfStatement, sourceFile: ts.SourceFile, issues: LintIssue[]): void {
	const parent = node.parent;
	if (ts.isIfStatement(parent) && parent.elseStatement === node) {
		return;
	}
	const subjects: string[] = [];
	let current: ts.IfStatement | undefined = node;
	while (current !== undefined) {
		const subject = stringSwitchComparisonSubject(current.expression);
		if (subject === null) {
			return;
		}
		subjects.push(subject);
		const elseStatement = current.elseStatement;
		if (elseStatement === undefined || !ts.isIfStatement(elseStatement)) {
			break;
		}
		current = elseStatement;
	}
	if (subjects.length < 3) {
		return;
	}
	const first = subjects[0];
	for (let index = 1; index < subjects.length; index += 1) {
		if (subjects[index] !== first) {
			return;
		}
	}
	const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
	issues.push({
		kind: 'string_switch_chain_pattern',
		file: sourceFile.fileName,
		line: position.line + 1,
		column: position.character + 1,
		name: 'string_switch_chain_pattern',
		message: 'Multiple string comparisons against the same expression are forbidden. Use `switch`-statement or lookup table instead.',
	});
}

export function falseLiteralComparison(node: ts.Expression): ExplicitValueCheck | null {
	const unwrapped = unwrapExpression(node);
	if (!ts.isBinaryExpression(unwrapped)) {
		return null;
	}
	const operatorKind = unwrapped.operatorToken.kind;
	if (!isEqualityOperator(operatorKind)) {
		return null;
	}
	const leftBoolean = isBooleanLiteral(unwrapped.left);
	const rightBoolean = isBooleanLiteral(unwrapped.right);
	const leftHasBoolean = leftBoolean !== null;
	const rightHasBoolean = rightBoolean !== null;
	if (leftHasBoolean === rightHasBoolean) {
		return null;
	}
	if (leftHasBoolean) {
		if (leftBoolean) {
			return null;
		}
		const subject = isExpressionInScopeFingerprint(unwrapped.right);
		if (subject === null) {
			return null;
		}
		return {
			subject,
			isPositive: isPositiveEqualityOperator(operatorKind),
		};
	}
	if (rightBoolean) {
		return null;
	}
	const subject = isExpressionInScopeFingerprint(unwrapped.left);
	if (subject === null) {
		return null;
	}
	return {
		subject,
		isPositive: isPositiveEqualityOperator(operatorKind),
	};
}

export function isLookupFallbackExpression(node: ts.Expression): boolean {
	const unwrapped = unwrapExpression(node);
	if (ts.isElementAccessExpression(unwrapped)) {
		return true;
	}
	if (!ts.isCallExpression(unwrapped)) {
		return false;
	}
	const target = unwrapExpression(unwrapped.expression);
	return ts.isPropertyAccessExpression(target) && target.name.text === 'get';
}

export function isSharedConstantFallbackExpression(node: ts.Expression): boolean {
	const unwrapped = unwrapExpression(node);
	return ts.isIdentifier(unwrapped) && /^[A-Z][A-Z0-9_]*$/.test(unwrapped.text);
}

export function isOptionalParameterFallback(node: ts.BinaryExpression): boolean {
	const left = unwrapExpression(node.left);
	if (!ts.isIdentifier(left)) {
		return false;
	}
	let current: ts.Node | undefined = node.parent;
	while (current !== undefined) {
		if (isFunctionLikeWithParameters(current)) {
			for (let index = 0; index < current.parameters.length; index += 1) {
				const parameter = current.parameters[index];
				if (ts.isIdentifier(parameter.name) && parameter.name.text === left.text) {
					return parameter.questionToken !== undefined || parameter.initializer !== undefined;
				}
			}
		}
		current = current.parent;
	}
	return false;
}
