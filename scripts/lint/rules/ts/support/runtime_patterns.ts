import { type AnalysisRegion } from '../../../../analysis/lint_suppressions';
import ts from 'typescript';
import { nodeIsInAnalysisRegion } from '../../../../analysis/code_quality/source_scan';
import { expressionRootName, unwrapExpression } from './ast';
import { getCallTargetLeafName } from './calls';
import { BOUNDARY_WRAPPER_NAME_WORDS, DIRECT_MUTATION_METHOD_NAMES } from './declarations';
import { isFunctionExpressionLike } from './functions';
import { isSemanticPredicateFunctionName } from './semantic';

export function isAllocationExpression(node: ts.Expression): boolean {
	const unwrapped = unwrapExpression(node);
	return ts.isObjectLiteralExpression(unwrapped)
		|| ts.isArrayLiteralExpression(unwrapped)
		|| ts.isNewExpression(unwrapped);
}

export function optionalChainBoundaryKind(node: ts.Expression, sourceFile: ts.SourceFile, regions: readonly AnalysisRegion[]): string | null {
	if (nodeIsInAnalysisRegion(sourceFile, regions, 'optional-chain-acceptable', node)) {
		return 'analysis-region';
	}
	const root = expressionRootName(node);
	if (root === 'options' || root === 'opts' || root === 'params') {
		return 'optional-parameter';
	}
	if (root === 'metadata' || root === 'apiMetadata' || root === 'manifest' || root === 'layout' || root === 'specs' || root === 'ram') {
		return 'data-contract';
	}
	if (isMapLookupProjectionOptionalChain(node)) {
		return 'lookup-projection';
	}
	return null;
}

export function isMapLookupProjectionOptionalChain(node: ts.Expression): boolean {
	const unwrapped = unwrapExpression(node);
	if (!ts.isPropertyAccessExpression(unwrapped)) {
		return false;
	}
	const receiver = unwrapExpression(unwrapped.expression);
	if (!ts.isCallExpression(receiver)) {
		return false;
	}
	return getCallTargetLeafName(receiver.expression) === 'get';
}

export function containsClosureExpression(node: ts.Node): boolean {
	let found = false;
	const visit = (current: ts.Node): void => {
		if (found) {
			return;
		}
		if (isFunctionExpressionLike(current)) {
			found = true;
			return;
		}
		ts.forEachChild(current, visit);
	};
	visit(node);
	return found;
}

export function hasPrivateOrProtectedModifier(node: ts.Node): boolean {
	const modifiers = (node as { modifiers?: ts.NodeArray<ts.Modifier> }).modifiers;
	if (!modifiers) {
		return false;
	}
	for (let index = 0; index < modifiers.length; index += 1) {
		const kind = modifiers[index].kind;
		if (kind === ts.SyntaxKind.PrivateKeyword || kind === ts.SyntaxKind.ProtectedKeyword) {
			return true;
		}
	}
	return false;
}

export function isTrivialDelegationCallExpression(callExpression: ts.CallExpression): boolean {
	return !isDirectMutationCallExpression(callExpression) && !containsClosureExpression(callExpression);
}

export function isPrimitivePredicateMethodCall(callExpression: ts.CallExpression): boolean {
	const target = unwrapExpression(callExpression.expression);
	if (!ts.isPropertyAccessExpression(target)) {
		return false;
	}
	switch (target.name.text) {
		case 'startsWith':
		case 'endsWith':
		case 'includes':
		case 'has':
			return true;
		default:
			return false;
	}
}

export function isNamedPrimitivePredicate(functionNode: ts.FunctionDeclaration | ts.MethodDeclaration, callExpression: ts.CallExpression): boolean {
	return isSemanticPredicateFunctionName(functionNode.name?.getText()) && isPrimitivePredicateMethodCall(callExpression);
}

export function isBoundaryStyleWrapperName(name: string): boolean {
	const words = name.match(/[A-Z]?[a-z0-9]+|[A-Z]+(?![a-z0-9])/g);
	if (words === null) {
		return BOUNDARY_WRAPPER_NAME_WORDS.has(name.toLowerCase());
	}
	for (let index = 0; index < words.length; index += 1) {
		if (BOUNDARY_WRAPPER_NAME_WORDS.has(words[index].toLowerCase())) {
			return true;
		}
	}
	return false;
}

export function isDirectMutationReceiver(expression: ts.Expression): boolean {
	let current = expression;
	while (ts.isParenthesizedExpression(current)) {
		current = current.expression;
	}
	if (ts.isIdentifier(current) || current.kind === ts.SyntaxKind.ThisKeyword) {
		return true;
	}
	if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
		return isDirectMutationReceiver(current.expression);
	}
	return false;
}

export function isDirectMutationCallExpression(callExpression: ts.CallExpression): boolean {
	if (!ts.isPropertyAccessExpression(callExpression.expression)) {
		return false;
	}
	if (!DIRECT_MUTATION_METHOD_NAMES.has(callExpression.expression.name.text)) {
		return false;
	}
	return isDirectMutationReceiver(callExpression.expression.expression);
}

export function hasExportModifier(node: ts.Node): boolean {
	const modifiers = (node as { modifiers?: ts.NodeArray<ts.Modifier> }).modifiers;
	if (!modifiers) {
		return false;
	}
	for (let index = 0; index < modifiers.length; index += 1) {
		if (modifiers[index].kind === ts.SyntaxKind.ExportKeyword) {
			return true;
		}
	}
	return false;
}
