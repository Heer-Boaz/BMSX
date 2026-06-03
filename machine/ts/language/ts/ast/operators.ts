import ts from 'typescript';

export function isPositiveEqualityOperator(kind: ts.SyntaxKind): boolean {
	return kind === ts.SyntaxKind.EqualsEqualsToken || kind === ts.SyntaxKind.EqualsEqualsEqualsToken;
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

export function isBooleanProducingOperator(kind: ts.SyntaxKind): boolean {
	return isEqualityOperator(kind)
		|| kind === ts.SyntaxKind.LessThanToken
		|| kind === ts.SyntaxKind.LessThanEqualsToken
		|| kind === ts.SyntaxKind.GreaterThanToken
		|| kind === ts.SyntaxKind.GreaterThanEqualsToken
		|| kind === ts.SyntaxKind.InKeyword
		|| kind === ts.SyntaxKind.InstanceOfKeyword;
}

export function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
	return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

export function isNullishEqualityOperator(kind: ts.SyntaxKind): boolean {
	return kind === ts.SyntaxKind.EqualsEqualsToken || kind === ts.SyntaxKind.EqualsEqualsEqualsToken;
}

export function isNullishInequalityOperator(kind: ts.SyntaxKind): boolean {
	return kind === ts.SyntaxKind.ExclamationEqualsToken || kind === ts.SyntaxKind.ExclamationEqualsEqualsToken;
}
