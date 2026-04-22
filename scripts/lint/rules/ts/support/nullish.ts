import ts from 'typescript';
import { LintIssue, expressionRootName, pushLintIssue, unwrapExpression } from './ast';
import { isExpressionInScopeFingerprint } from './bindings';
import { isEmptyContainerLiteral, isEmptyStringLiteral, isEqualityOperator, isLookupFallbackExpression, isLuaSourceLookupFallback, isOptionalParameterFallback, isPositiveEqualityOperator, isRuntimeAssetLayerFallback, isSharedConstantFallbackExpression } from './conditions';
import { expressionAccessFingerprint } from './declarations';
import { isNumericLiteralLike, isNumericLiteralText } from './numeric';
import { isAllocationExpression } from './runtime_patterns';
import { nextStatementAfter } from './statements';
import { ExplicitValueCheck, NullishLiteralKind } from './types';

export function nullishLiteralKind(node: ts.Expression): NullishLiteralKind | null {
	if (node.kind === ts.SyntaxKind.NullKeyword) {
		return 'null';
	}
	if (ts.isIdentifier(node) && node.text === 'undefined') {
		return 'undefined';
	}
	return null;
}

export function isNullOrUndefined(node: ts.Expression): boolean {
	return nullishLiteralKind(node) !== null;
}

export function isNullishEqualityOperator(kind: ts.SyntaxKind): boolean {
	return kind === ts.SyntaxKind.EqualsEqualsToken || kind === ts.SyntaxKind.EqualsEqualsEqualsToken;
}

export function isNullishInequalityOperator(kind: ts.SyntaxKind): boolean {
	return kind === ts.SyntaxKind.ExclamationEqualsToken || kind === ts.SyntaxKind.ExclamationEqualsEqualsToken;
}

export function expressionUsesGuardedValue(expression: ts.Expression, guardFingerprint: string): boolean {
	const expressionFingerprint = expressionAccessFingerprint(expression);
	return expressionFingerprint !== null && (
		expressionFingerprint === guardFingerprint
		|| expressionFingerprint.startsWith(`${guardFingerprint}.`)
		|| expressionFingerprint.startsWith(`${guardFingerprint}[`)
	);
}

export function truthyGuardFingerprint(condition: ts.Expression): string | null {
	const unwrapped = unwrapExpression(condition);
	if (ts.isPrefixUnaryExpression(unwrapped) && unwrapped.operator === ts.SyntaxKind.ExclamationToken) {
		return expressionAccessFingerprint(unwrapped.operand);
	}
	return expressionAccessFingerprint(unwrapped);
}

export function nullishGuardFingerprint(condition: ts.Expression): string | null {
	const unwrapped = unwrapExpression(condition);
	if (!ts.isBinaryExpression(unwrapped)) {
		return null;
	}
	if (unwrapped.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
		const left = nullishGuardFingerprint(unwrapped.left);
		const right = nullishGuardFingerprint(unwrapped.right);
		return left !== null && left === right ? left : null;
	}
	if (!isNullishEqualityOperator(unwrapped.operatorToken.kind)) {
		return null;
	}
	if (isNullOrUndefined(unwrapped.left)) {
		return expressionAccessFingerprint(unwrapped.right);
	}
	if (isNullOrUndefined(unwrapped.right)) {
		return expressionAccessFingerprint(unwrapped.left);
	}
	return null;
}

export function undefinedGuardFingerprint(condition: ts.Expression, positive: boolean): string | null {
	const unwrapped = unwrapExpression(condition);
	if (!ts.isBinaryExpression(unwrapped)) {
		return null;
	}
	const operator = unwrapped.operatorToken.kind;
	if (positive ? !isNullishEqualityOperator(operator) : !isNullishInequalityOperator(operator)) {
		return null;
	}
	if (ts.isIdentifier(unwrapped.left) && unwrapped.left.text === 'undefined') {
		return expressionAccessFingerprint(unwrapped.right);
	}
	if (ts.isIdentifier(unwrapped.right) && unwrapped.right.text === 'undefined') {
		return expressionAccessFingerprint(unwrapped.left);
	}
	return null;
}

export function strictNullishEqualityGuard(condition: ts.Expression): { kind: NullishLiteralKind; fingerprint: string } | null {
	const unwrapped = unwrapExpression(condition);
	if (!ts.isBinaryExpression(unwrapped) || unwrapped.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken) {
		return null;
	}
	const leftKind = nullishLiteralKind(unwrapped.left);
	const rightKind = nullishLiteralKind(unwrapped.right);
	if (leftKind !== null && rightKind === null) {
		const fingerprint = expressionAccessFingerprint(unwrapped.right);
		return fingerprint === null ? null : { kind: leftKind, fingerprint };
	}
	if (rightKind !== null && leftKind === null) {
		const fingerprint = expressionAccessFingerprint(unwrapped.left);
		return fingerprint === null ? null : { kind: rightKind, fingerprint };
	}
	return null;
}

export function isCrossNullishProjection(condition: ts.Expression, nullishKind: NullishLiteralKind, valueExpression: ts.Expression): boolean {
	const guard = strictNullishEqualityGuard(condition);
	return guard !== null
		&& guard.kind !== nullishKind
		&& expressionUsesGuardedValue(valueExpression, guard.fingerprint);
}

export function isCrossNullishConditionalProjection(node: ts.ConditionalExpression): boolean {
	const trueKind = nullishLiteralKind(node.whenTrue);
	const falseKind = nullishLiteralKind(node.whenFalse);
	if (trueKind === falseKind || (trueKind !== null && falseKind !== null)) {
		return false;
	}
	const nullishKind = trueKind ?? falseKind;
	const valueExpression = trueKind !== null ? node.whenFalse : node.whenTrue;
	return nullishKind !== null && isCrossNullishProjection(node.condition, nullishKind, valueExpression);
}

export function isConditionalNullishNormalization(node: ts.ConditionalExpression): boolean {
	if (isCrossNullishConditionalProjection(node)) {
		return false;
	}
	const trueNullish = isNullOrUndefined(node.whenTrue);
	const falseNullish = isNullOrUndefined(node.whenFalse);
	if (trueNullish === falseNullish) {
		return false;
	}
	const valueExpression = trueNullish ? node.whenFalse : node.whenTrue;
	const nullishGuard = nullishGuardFingerprint(node.condition);
	if (nullishGuard !== null) {
		return expressionUsesGuardedValue(valueExpression, nullishGuard);
	}
	const truthyGuard = truthyGuardFingerprint(node.condition);
	return truthyGuard !== null && expressionUsesGuardedValue(valueExpression, truthyGuard);
}

export function nullishReturnKind(statement: ts.Statement): NullishLiteralKind | null {
	if (ts.isReturnStatement(statement)) {
		return statement.expression === undefined ? null : nullishLiteralKind(statement.expression);
	}
	if (!ts.isBlock(statement) || statement.statements.length !== 1) {
		return null;
	}
	const onlyStatement = statement.statements[0];
	return ts.isReturnStatement(onlyStatement) && onlyStatement.expression !== undefined
		? nullishLiteralKind(onlyStatement.expression)
		: null;
}

export function isNullishReturnStatement(statement: ts.Statement): boolean {
	return nullishReturnKind(statement) !== null;
}

export function lintNullishReturnGuard(node: ts.IfStatement, sourceFile: ts.SourceFile, issues: LintIssue[]): void {
	if (node.elseStatement !== undefined) {
		return;
	}
	const returnedKind = nullishReturnKind(node.thenStatement);
	if (returnedKind === null) {
		return;
	}
	const guardFingerprint = nullishGuardFingerprint(node.expression);
	if (guardFingerprint === null) {
		return;
	}
	const next = nextStatementAfter(node);
	if (next === null || !ts.isReturnStatement(next) || next.expression === undefined) {
		return;
	}
	if (!expressionUsesGuardedValue(next.expression, guardFingerprint)) {
		return;
	}
	if (isCrossNullishProjection(node.expression, returnedKind, next.expression)) {
		return;
	}
	pushLintIssue(
		issues,
		sourceFile,
		node,
		'nullish_return_guard_pattern',
		'Nullish guard that only returns null/undefined before returning the guarded value is forbidden. Keep the compact expression form instead of expanding it into a branch.',
	);
}

export function nullishLiteralComparison(node: ts.Expression): ExplicitValueCheck | null {
	const unwrapped = unwrapExpression(node);
	if (!ts.isBinaryExpression(unwrapped)) {
		return null;
	}
	const operatorKind = unwrapped.operatorToken.kind;
	if (!isEqualityOperator(operatorKind)) {
		return null;
	}
	let subject: string | null = null;
	if (isNullOrUndefined(unwrapped.left)) {
		subject = isExpressionInScopeFingerprint(unwrapped.right);
	} else if (isNullOrUndefined(unwrapped.right)) {
		subject = isExpressionInScopeFingerprint(unwrapped.left);
	}
	if (subject === null) {
		return null;
	}
	return {
		subject,
		isPositive: isPositiveEqualityOperator(operatorKind),
	};
}

export function nullishZeroOperandFingerprint(node: ts.Expression): string | null {
	const unwrapped = unwrapExpression(node);
	if (!ts.isBinaryExpression(unwrapped) || unwrapped.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionToken) {
		return null;
	}
	if (!isNumericLiteralText(unwrapped.right, '0')) {
		return null;
	}
	return expressionAccessFingerprint(unwrapped.left);
}

export function isNullishCounterIncrement(node: ts.BinaryExpression): boolean {
	if (node.operatorToken.kind !== ts.SyntaxKind.EqualsToken) {
		return false;
	}
	const target = expressionAccessFingerprint(node.left);
	if (target === null) {
		return false;
	}
	const rhs = unwrapExpression(node.right);
	if (!ts.isBinaryExpression(rhs) || rhs.operatorToken.kind !== ts.SyntaxKind.PlusToken) {
		return false;
	}
	const leftCounter = nullishZeroOperandFingerprint(rhs.left);
	const rightCounter = nullishZeroOperandFingerprint(rhs.right);
	return (leftCounter === target && isNumericLiteralText(rhs.right, '1'))
		|| (rightCounter === target && isNumericLiteralText(rhs.left, '1'));
}

export function nullishFallbackLedgerKind(node: ts.BinaryExpression): string {
	if (isAllocationExpression(node.right)) {
		return 'allocation';
	}
	if (isEmptyContainerLiteral(node.right)) {
		return 'empty_container';
	}
	if (isEmptyStringLiteral(unwrapExpression(node.right))) {
		return 'empty_string';
	}
	if (isNullOrUndefined(node.right)) {
		return 'nullish';
	}
	if (isOptionalParameterFallback(node)) {
		return 'optional_parameter_default';
	}
	if (isLuaSourceLookupFallback(node)) {
		return 'lua_source_lookup';
	}
	if (isRuntimeAssetLayerFallback(node)) {
		return 'runtime_asset_layer';
	}
	const root = expressionRootName(node.left);
	if (root === 'options' || root === 'opts' || root === 'params') {
		return 'option_default';
	}
	if (root === 'manifest' || root === 'specs' || root === 'layout' || root === 'memorySpecs' || root === 'engineMemorySpecs') {
		return 'data_default';
	}
	if (root === 'metadata' || root === 'engineMetadata' || root === 'cartMetadata' || root === 'runtime') {
		return 'metadata_default';
	}
	const right = unwrapExpression(node.right);
	if (ts.isIdentifier(right) && right.text.startsWith('EMPTY_')) {
		return 'shared_empty';
	}
	if (isLookupFallbackExpression(node.left) || isLookupFallbackExpression(right)) {
		return 'lookup_default';
	}
	if (isSharedConstantFallbackExpression(right)) {
		return 'shared_constant';
	}
	if (ts.isCallExpression(right)) {
		return 'lazy_call';
	}
	if (isNumericLiteralLike(right)) {
		return 'numeric_literal';
	}
	if (ts.isStringLiteral(right)) {
		return 'string_literal';
	}
	if (right.kind === ts.SyntaxKind.TrueKeyword || right.kind === ts.SyntaxKind.FalseKeyword) {
		return 'boolean_literal';
	}
	return 'other';
}
